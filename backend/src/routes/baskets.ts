import { Hono } from 'hono';
import type { AppEnvironment } from '../types';
import {
  createBasketSchema,
  createFolderSchema,
  mergeBasketSchema,
  patchBasketSchema,
} from '../domain/api-schemas';
import { readJson, ok } from '../lib/http';
import { canonicalJson, newId } from '../lib/crypto';
import { nowIso, parseJson } from '../lib/db';
import { ApiError, notFound } from '../lib/errors';
import { audit } from '../lib/audit';

interface BasketRow {
  id: string;
  folder_id: string | null;
  name: string;
  notes: string | null;
  common_config_json: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapBasket(row: BasketRow) {
  return {
    id: row.id,
    folderId: row.folder_id,
    name: row.name,
    notes: row.notes,
    commonConfig: parseJson<unknown>(row.common_config_json),
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function basketItemLimit(db: D1Database, userId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT value_json FROM entitlements WHERE user_id = ? AND feature = 'research.backtest'
     AND starts_at <= ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY starts_at DESC LIMIT 1`,
    )
    .bind(userId, nowIso(), nowIso())
    .first<{ value_json: string }>();
  const value = row
    ? parseJson<{ maxBasketStrategies?: unknown }>(row.value_json).maxBasketStrategies
    : undefined;
  return typeof value === 'number' && Number.isSafeInteger(value)
    ? Math.min(100, Math.max(1, value))
    : 20;
}

async function assertFolder(
  db: D1Database,
  folderId: string | null | undefined,
  userId: string,
): Promise<void> {
  if (!folderId) return;
  const row = await db
    .prepare('SELECT id FROM folders WHERE id = ? AND user_id = ?')
    .bind(folderId, userId)
    .first();
  if (!row) throw notFound('Folder');
}

export const folderRoutes = new Hono<AppEnvironment>();

folderRoutes.get('/', async (context) => {
  const user = context.get('user');
  const { results } = await context.env.DB.prepare(
    `SELECT f.id, f.name, f.created_at, f.updated_at, COUNT(b.id) AS basket_count
     FROM folders f LEFT JOIN baskets b ON b.folder_id = f.id AND b.archived_at IS NULL
     WHERE f.user_id = ? GROUP BY f.id ORDER BY f.name`,
  )
    .bind(user.id)
    .all();
  return ok(context, { items: results });
});

folderRoutes.post('/', async (context) => {
  const user = context.get('user');
  const input = createFolderSchema.parse(await readJson(context, 16_384));
  const id = newId('fld');
  const now = nowIso();
  await context.env.DB.prepare(
    'INSERT INTO folders(id, user_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
  )
    .bind(id, user.id, input.name, now, now)
    .run();
  await audit(context, {
    action: 'folder.created',
    resourceType: 'folder',
    resourceId: id,
    actorUserId: user.id,
  });
  return ok(context, { id }, 201);
});

folderRoutes.delete('/:id', async (context) => {
  const user = context.get('user');
  const result = await context.env.DB.prepare('DELETE FROM folders WHERE id = ? AND user_id = ?')
    .bind(context.req.param('id'), user.id)
    .run();
  if (result.meta.changes === 0) throw notFound('Folder');
  await audit(context, {
    action: 'folder.deleted',
    resourceType: 'folder',
    resourceId: context.req.param('id'),
    actorUserId: user.id,
  });
  return context.body(null, 204);
});

export const basketRoutes = new Hono<AppEnvironment>();

basketRoutes.get('/', async (context) => {
  const user = context.get('user');
  const { results } = await context.env.DB.prepare(
    `SELECT id, folder_id, name, notes, common_config_json, archived_at, created_at, updated_at
     FROM baskets WHERE user_id = ? AND (? = 1 OR archived_at IS NULL) ORDER BY updated_at DESC LIMIT 100`,
  )
    .bind(user.id, context.req.query('archived') === 'true' ? 1 : 0)
    .all<BasketRow>();
  return ok(context, { items: results.map(mapBasket) });
});

basketRoutes.post('/', async (context) => {
  const user = context.get('user');
  const input = createBasketSchema.parse(await readJson(context));
  const limit = await basketItemLimit(context.env.DB, user.id);
  if (input.items.length > limit)
    throw new ApiError(
      403,
      'ENTITLEMENT_LIMIT_EXCEEDED',
      `This account may add at most ${limit} strategies to a basket.`,
    );
  await assertFolder(context.env.DB, input.folderId, user.id);
  if (input.items.length > 0) {
    const placeholders = input.items.map(() => '?').join(',');
    const owned = await context.env.DB.prepare(
      `SELECT COUNT(*) AS count FROM strategy_versions v JOIN strategies s ON s.id = v.strategy_id
       WHERE v.id IN (${placeholders}) AND s.user_id = ? AND s.deleted_at IS NULL`,
    )
      .bind(...input.items.map((item) => item.strategyVersionId), user.id)
      .first<{ count: number }>();
    if ((owned?.count ?? 0) !== new Set(input.items.map((item) => item.strategyVersionId)).size)
      throw new ApiError(
        400,
        'STRATEGY_VERSION_INVALID',
        'One or more strategy versions are unavailable.',
      );
  }
  const id = newId('bsk');
  const now = nowIso();
  const statements = [
    context.env.DB.prepare(
      `INSERT INTO baskets(id, user_id, folder_id, name, notes, common_config_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      user.id,
      input.folderId ?? null,
      input.name,
      input.notes ?? null,
      canonicalJson(input.commonConfig),
      now,
      now,
    ),
    ...input.items.map((item, index) =>
      context.env.DB.prepare(
        `INSERT INTO basket_items(id, basket_id, strategy_version_id, position, multiplier, selected, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        newId('bsi'),
        id,
        item.strategyVersionId,
        index,
        item.multiplier,
        item.selected ? 1 : 0,
        item.notes ?? null,
        now,
        now,
      ),
    ),
  ];
  await context.env.DB.batch(statements);
  await audit(context, {
    action: 'basket.created',
    resourceType: 'basket',
    resourceId: id,
    actorUserId: user.id,
    metadata: { itemCount: input.items.length },
  });
  return ok(context, { id }, 201);
});

basketRoutes.get('/:id', async (context) => {
  const user = context.get('user');
  const basket = await context.env.DB.prepare(
    `SELECT id, folder_id, name, notes, common_config_json, archived_at, created_at, updated_at
     FROM baskets WHERE id = ? AND user_id = ?`,
  )
    .bind(context.req.param('id'), user.id)
    .first<BasketRow>();
  if (!basket) throw notFound('Basket');
  const { results } = await context.env.DB.prepare(
    `SELECT i.id, i.strategy_version_id, i.position, i.multiplier, i.selected, i.notes,
            s.id AS strategy_id, s.name AS strategy_name, v.version, v.config_hash
     FROM basket_items i JOIN strategy_versions v ON v.id = i.strategy_version_id JOIN strategies s ON s.id = v.strategy_id
     WHERE i.basket_id = ? ORDER BY i.position`,
  )
    .bind(basket.id)
    .all();
  return ok(context, { ...mapBasket(basket), items: results });
});

basketRoutes.patch('/:id', async (context) => {
  const user = context.get('user');
  const input = patchBasketSchema.parse(await readJson(context, 128_000));
  const existing = await context.env.DB.prepare(
    'SELECT folder_id, name, notes, common_config_json, archived_at FROM baskets WHERE id = ? AND user_id = ?',
  )
    .bind(context.req.param('id'), user.id)
    .first<{
      folder_id: string | null;
      name: string;
      notes: string | null;
      common_config_json: string;
      archived_at: string | null;
    }>();
  if (!existing) throw notFound('Basket');
  await assertFolder(context.env.DB, input.folderId, user.id);
  await context.env.DB.prepare(
    `UPDATE baskets SET folder_id = ?, name = ?, notes = ?, common_config_json = ?, archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?`,
  )
    .bind(
      input.folderId === undefined ? existing.folder_id : input.folderId,
      input.name ?? existing.name,
      input.notes === undefined ? existing.notes : input.notes,
      input.commonConfig === undefined
        ? existing.common_config_json
        : canonicalJson(input.commonConfig),
      input.archived === undefined ? existing.archived_at : input.archived ? nowIso() : null,
      nowIso(),
      context.req.param('id'),
      user.id,
    )
    .run();
  await audit(context, {
    action: 'basket.updated',
    resourceType: 'basket',
    resourceId: context.req.param('id'),
    actorUserId: user.id,
    metadata: { fields: Object.keys(input) },
  });
  return ok(context, { updated: true });
});

basketRoutes.post('/:id/merge', async (context) => {
  const user = context.get('user');
  const input = mergeBasketSchema.parse(await readJson(context, 16_384));
  if (input.sourceBasketId === context.req.param('id'))
    throw new ApiError(400, 'BASKET_MERGE_SELF', 'A basket cannot be merged into itself.');
  const baskets = await context.env.DB.prepare(
    'SELECT COUNT(*) AS count FROM baskets WHERE id IN (?, ?) AND user_id = ?',
  )
    .bind(context.req.param('id'), input.sourceBasketId, user.id)
    .first<{ count: number }>();
  if (baskets?.count !== 2) throw notFound('Basket');
  const limit = await basketItemLimit(context.env.DB, user.id);
  const counts = await context.env.DB.prepare(
    `SELECT COUNT(DISTINCT strategy_version_id) AS count FROM basket_items WHERE basket_id IN (?, ?)`,
  )
    .bind(context.req.param('id'), input.sourceBasketId)
    .first<{ count: number }>();
  if ((counts?.count ?? 0) > limit)
    throw new ApiError(
      403,
      'ENTITLEMENT_LIMIT_EXCEEDED',
      `The merged basket would exceed the ${limit}-strategy limit.`,
    );
  const now = nowIso();
  await context.env.DB.prepare(
    `INSERT OR IGNORE INTO basket_items(id, basket_id, strategy_version_id, position, multiplier, selected, notes, created_at, updated_at)
     SELECT 'bsi_' || lower(hex(randomblob(16))), ?, source.strategy_version_id,
            (SELECT COALESCE(MAX(position), -1) + 1 FROM basket_items WHERE basket_id = ?),
            source.multiplier, source.selected, source.notes, ?, ?
     FROM basket_items source WHERE source.basket_id = ? ORDER BY source.position`,
  )
    .bind(context.req.param('id'), context.req.param('id'), now, now, input.sourceBasketId)
    .run();
  await context.env.DB.prepare('UPDATE baskets SET updated_at = ? WHERE id = ?')
    .bind(now, context.req.param('id'))
    .run();
  await audit(context, {
    action: 'basket.merged',
    resourceType: 'basket',
    resourceId: context.req.param('id'),
    actorUserId: user.id,
    metadata: { sourceBasketId: input.sourceBasketId },
  });
  return ok(context, { merged: true });
});

basketRoutes.delete('/:id', async (context) => {
  const user = context.get('user');
  const result = await context.env.DB.prepare('DELETE FROM baskets WHERE id = ? AND user_id = ?')
    .bind(context.req.param('id'), user.id)
    .run();
  if (result.meta.changes === 0) throw notFound('Basket');
  await audit(context, {
    action: 'basket.deleted',
    resourceType: 'basket',
    resourceId: context.req.param('id'),
    actorUserId: user.id,
  });
  return context.body(null, 204);
});
