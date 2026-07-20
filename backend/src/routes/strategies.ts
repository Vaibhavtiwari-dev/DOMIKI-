import { Hono } from 'hono';
import type { AppEnvironment } from '../types';
import {
  createShareSchema,
  createStrategySchema,
  createVersionSchema,
  patchStrategySchema,
} from '../domain/api-schemas';
import { readJson, ok } from '../lib/http';
import { canonicalJson, hmacSha256, newId, randomToken, sha256Hex } from '../lib/crypto';
import { nowIso, parseJson } from '../lib/db';
import { ApiError, isD1Constraint, notFound } from '../lib/errors';
import { audit } from '../lib/audit';

interface StrategyRow {
  id: string;
  name: string;
  description: string | null;
  latest_version: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  version_id?: string;
  schema_version?: string;
  config_hash?: string;
  configuration_json?: string;
}

function mapStrategy(row: StrategyRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    latestVersion: row.latest_version,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.version_id
      ? {
          version: {
            id: row.version_id,
            number: row.latest_version,
            schemaVersion: row.schema_version,
            configHash: row.config_hash,
            configuration: parseJson<unknown>(row.configuration_json ?? '{}'),
          },
        }
      : {}),
  };
}

export const strategyRoutes = new Hono<AppEnvironment>();

strategyRoutes.get('/', async (context) => {
  const user = context.get('user');
  const limit = Math.min(100, Math.max(1, Number(context.req.query('limit') ?? 25)));
  if (!Number.isInteger(limit))
    throw new ApiError(400, 'VALIDATION_FAILED', 'limit must be an integer.');
  const includeArchived = context.req.query('archived') === 'true';
  const { results } = await context.env.DB.prepare(
    `SELECT id, name, description, latest_version, archived_at, created_at, updated_at
     FROM strategies WHERE user_id = ? AND deleted_at IS NULL AND (? = 1 OR archived_at IS NULL)
     ORDER BY updated_at DESC, id DESC LIMIT ?`,
  )
    .bind(user.id, includeArchived ? 1 : 0, limit)
    .all<StrategyRow>();
  return ok(context, { items: results.map(mapStrategy) });
});

strategyRoutes.post('/', async (context) => {
  const user = context.get('user');
  const input = createStrategySchema.parse(await readJson(context));
  const now = nowIso();
  const strategyId = newId('str');
  const versionId = newId('stv');
  const configuration = canonicalJson(input.configuration);
  const configHash = await sha256Hex(configuration);
  await context.env.DB.batch([
    context.env.DB.prepare(
      `INSERT INTO strategies(id, user_id, name, description, latest_version, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    ).bind(strategyId, user.id, input.name, input.description ?? null, now, now),
    context.env.DB.prepare(
      `INSERT INTO strategy_versions(id, strategy_id, version, schema_version, config_hash, configuration_json, created_by_user_id, created_at)
       VALUES (?, ?, 1, ?, ?, ?, ?, ?)`,
    ).bind(
      versionId,
      strategyId,
      input.configuration.schemaVersion,
      configHash,
      configuration,
      user.id,
      now,
    ),
  ]);
  await audit(context, {
    action: 'strategy.created',
    resourceType: 'strategy',
    resourceId: strategyId,
    actorUserId: user.id,
    metadata: { versionId, configHash },
  });
  return ok(context, { id: strategyId, versionId, version: 1, configHash }, 201);
});

strategyRoutes.get('/:id', async (context) => {
  const user = context.get('user');
  const row = await context.env.DB.prepare(
    `SELECT s.id, s.name, s.description, s.latest_version, s.archived_at, s.created_at, s.updated_at,
            v.id AS version_id, v.schema_version, v.config_hash, v.configuration_json
     FROM strategies s JOIN strategy_versions v ON v.strategy_id = s.id AND v.version = s.latest_version
     WHERE s.id = ? AND s.user_id = ? AND s.deleted_at IS NULL`,
  )
    .bind(context.req.param('id'), user.id)
    .first<StrategyRow>();
  if (!row) throw notFound('Strategy');
  const versions = await context.env.DB.prepare(
    `SELECT id, version, schema_version, config_hash, created_at FROM strategy_versions
     WHERE strategy_id = ? ORDER BY version DESC`,
  )
    .bind(row.id)
    .all<{
      id: string;
      version: number;
      schema_version: string;
      config_hash: string;
      created_at: string;
    }>();
  return ok(context, { ...mapStrategy(row), versions: versions.results });
});

strategyRoutes.patch('/:id', async (context) => {
  const user = context.get('user');
  const input = patchStrategySchema.parse(await readJson(context, 64_000));
  const existing = await context.env.DB.prepare(
    'SELECT name, description, archived_at FROM strategies WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
  )
    .bind(context.req.param('id'), user.id)
    .first<{ name: string; description: string | null; archived_at: string | null }>();
  if (!existing) throw notFound('Strategy');
  await context.env.DB.prepare(
    'UPDATE strategies SET name = ?, description = ?, archived_at = ?, updated_at = ? WHERE id = ? AND user_id = ?',
  )
    .bind(
      input.name ?? existing.name,
      input.description === undefined ? existing.description : input.description,
      input.archived === undefined ? existing.archived_at : input.archived ? nowIso() : null,
      nowIso(),
      context.req.param('id'),
      user.id,
    )
    .run();
  await audit(context, {
    action: 'strategy.updated',
    resourceType: 'strategy',
    resourceId: context.req.param('id'),
    actorUserId: user.id,
    metadata: { fields: Object.keys(input) },
  });
  return ok(context, { updated: true });
});

strategyRoutes.delete('/:id', async (context) => {
  const user = context.get('user');
  const result = await context.env.DB.prepare(
    'UPDATE strategies SET deleted_at = ?, archived_at = COALESCE(archived_at, ?), updated_at = ? WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
  )
    .bind(nowIso(), nowIso(), nowIso(), context.req.param('id'), user.id)
    .run();
  if (result.meta.changes === 0) throw notFound('Strategy');
  await audit(context, {
    action: 'strategy.deleted',
    resourceType: 'strategy',
    resourceId: context.req.param('id'),
    actorUserId: user.id,
  });
  return context.body(null, 204);
});

strategyRoutes.post('/:id/versions', async (context) => {
  const user = context.get('user');
  const input = createVersionSchema.parse(await readJson(context));
  const strategy = await context.env.DB.prepare(
    'SELECT latest_version FROM strategies WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
  )
    .bind(context.req.param('id'), user.id)
    .first<{ latest_version: number }>();
  if (!strategy) throw notFound('Strategy');
  const version = strategy.latest_version + 1;
  const versionId = newId('stv');
  const configuration = canonicalJson(input.configuration);
  const configHash = await sha256Hex(configuration);
  const now = nowIso();
  try {
    await context.env.DB.batch([
      context.env.DB.prepare(
        `INSERT INTO strategy_versions(id, strategy_id, version, schema_version, config_hash, configuration_json, created_by_user_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        versionId,
        context.req.param('id'),
        version,
        input.configuration.schemaVersion,
        configHash,
        configuration,
        user.id,
        now,
      ),
      context.env.DB.prepare(
        'UPDATE strategies SET latest_version = ?, updated_at = ? WHERE id = ? AND user_id = ? AND latest_version = ?',
      ).bind(version, now, context.req.param('id'), user.id, strategy.latest_version),
    ]);
  } catch (error) {
    if (isD1Constraint(error, 'strategy_versions.strategy_id, strategy_versions.config_hash')) {
      throw new ApiError(
        409,
        'STRATEGY_VERSION_UNCHANGED',
        'This exact strategy configuration already exists.',
      );
    }
    throw error;
  }
  await audit(context, {
    action: 'strategy.version_created',
    resourceType: 'strategy_version',
    resourceId: versionId,
    actorUserId: user.id,
    metadata: { strategyId: context.req.param('id'), version, configHash },
  });
  return ok(context, { id: versionId, version, configHash }, 201);
});

strategyRoutes.post('/:id/share', async (context) => {
  const user = context.get('user');
  const input = createShareSchema.parse(await readJson(context, 16_384));
  const strategy = await context.env.DB.prepare(
    `SELECT v.id AS version_id FROM strategies s JOIN strategy_versions v ON v.strategy_id = s.id AND v.version = s.latest_version
     WHERE s.id = ? AND s.user_id = ? AND s.deleted_at IS NULL`,
  )
    .bind(context.req.param('id'), user.id)
    .first<{ version_id: string }>();
  if (!strategy) throw notFound('Strategy');
  if (input.expiresAt && input.expiresAt <= nowIso())
    throw new ApiError(400, 'VALIDATION_FAILED', 'expiresAt must be in the future.');
  const token = randomToken(32);
  const linkId = newId('shr');
  await context.env.DB.prepare(
    `INSERT INTO share_links(id, user_id, resource_type, resource_id, token_hash, expires_at, created_at)
     VALUES (?, ?, 'strategy_version', ?, ?, ?, ?)`,
  )
    .bind(
      linkId,
      user.id,
      strategy.version_id,
      await hmacSha256(context.env.SESSION_SIGNING_SECRET, token),
      input.expiresAt ?? null,
      nowIso(),
    )
    .run();
  await audit(context, {
    action: 'share.created',
    resourceType: 'share_link',
    resourceId: linkId,
    actorUserId: user.id,
    metadata: { strategyVersionId: strategy.version_id },
  });
  return ok(
    context,
    {
      id: linkId,
      url: `${context.env.API_BASE_URL}/v1/shares/${token}`,
      expiresAt: input.expiresAt ?? null,
    },
    201,
  );
});

strategyRoutes.delete('/shares/:shareId', async (context) => {
  const user = context.get('user');
  await context.env.DB.prepare(
    'UPDATE share_links SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
  )
    .bind(nowIso(), context.req.param('shareId'), user.id)
    .run();
  await audit(context, {
    action: 'share.revoked',
    resourceType: 'share_link',
    resourceId: context.req.param('shareId'),
    actorUserId: user.id,
  });
  return context.body(null, 204);
});

export const publicShareRoutes = new Hono<AppEnvironment>();

publicShareRoutes.get('/:token', async (context) => {
  const token = context.req.param('token');
  if (token.length < 32 || token.length > 256) throw notFound('Share');
  const row = await context.env.DB.prepare(
    `SELECT s.name, s.description, v.id AS version_id, v.version, v.schema_version, v.config_hash, v.configuration_json, l.expires_at
     FROM share_links l JOIN strategy_versions v ON l.resource_type = 'strategy_version' AND v.id = l.resource_id
     JOIN strategies s ON s.id = v.strategy_id
     WHERE l.token_hash = ? AND l.revoked_at IS NULL AND (l.expires_at IS NULL OR l.expires_at > ?) AND s.deleted_at IS NULL`,
  )
    .bind(await hmacSha256(context.env.SESSION_SIGNING_SECRET, token), nowIso())
    .first<{
      name: string;
      description: string | null;
      version_id: string;
      version: number;
      schema_version: string;
      config_hash: string;
      configuration_json: string;
      expires_at: string | null;
    }>();
  if (!row) throw notFound('Share');
  context.header('cache-control', 'private, max-age=60');
  return ok(context, {
    type: 'strategy_version',
    name: row.name,
    description: row.description,
    version: {
      id: row.version_id,
      number: row.version,
      schemaVersion: row.schema_version,
      configHash: row.config_hash,
      configuration: parseJson<unknown>(row.configuration_json),
    },
    expiresAt: row.expires_at,
  });
});
