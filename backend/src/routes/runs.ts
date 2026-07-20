import { Hono } from 'hono';
import type { AppEnvironment } from '../types';
import { runRequestSchema, runTransitionSchema, saveRunSchema } from '../domain/api-schemas';
import { readJson, ok } from '../lib/http';
import { canonicalJson, newId, sha256Hex } from '../lib/crypto';
import { nowIso, parseJson } from '../lib/db';
import { ApiError, isD1Constraint, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { rateLimit } from '../middleware/rate-limit';

interface RunRow {
  id: string;
  strategy_version_id: string | null;
  basket_id: string | null;
  dataset_id: string | null;
  state: string;
  adapter: string;
  configuration_json: string;
  manifest_json: string | null;
  summary_json: string | null;
  quality_grade: string | null;
  credit_cost: number;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function mapRun(row: RunRow) {
  return {
    id: row.id,
    strategyVersionId: row.strategy_version_id,
    basketId: row.basket_id,
    datasetId: row.dataset_id,
    state: row.state,
    adapter: row.adapter,
    configuration: parseJson<unknown>(row.configuration_json),
    manifest: row.manifest_json ? parseJson<unknown>(row.manifest_json) : null,
    summary: row.summary_json ? parseJson<unknown>(row.summary_json) : null,
    qualityGrade: row.quality_grade,
    creditCost: row.credit_cost,
    errorCode: row.error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

async function assertRunResources(
  db: D1Database,
  userId: string,
  input: {
    strategyVersionId?: string | undefined;
    basketId?: string | undefined;
    datasetId: string;
  },
): Promise<void> {
  const dataset = await db
    .prepare('SELECT id FROM datasets WHERE id = ? AND active = 1')
    .bind(input.datasetId)
    .first();
  if (!dataset)
    throw new ApiError(404, 'DATASET_NOT_FOUND', 'The selected dataset is unavailable.');
  if (input.strategyVersionId) {
    const strategy = await db
      .prepare(
        `SELECT v.id FROM strategy_versions v JOIN strategies s ON s.id = v.strategy_id
       WHERE v.id = ? AND s.user_id = ? AND s.deleted_at IS NULL`,
      )
      .bind(input.strategyVersionId, userId)
      .first();
    if (!strategy) throw notFound('Strategy version');
  } else {
    const basket = await db
      .prepare('SELECT id FROM baskets WHERE id = ? AND user_id = ?')
      .bind(input.basketId, userId)
      .first();
    if (!basket) throw notFound('Basket');
  }
  const entitlement = await db
    .prepare(
      `SELECT id FROM entitlements WHERE user_id = ? AND feature = 'research.backtest' AND starts_at <= ?
     AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
    )
    .bind(userId, nowIso(), nowIso())
    .first();
  if (!entitlement)
    throw new ApiError(403, 'ENTITLEMENT_REQUIRED', 'Backtesting is not enabled for this account.');
}

async function estimateRun(
  db: D1Database,
  input: {
    strategyVersionId?: string | undefined;
    basketId?: string | undefined;
    datasetId: string;
  },
) {
  let legCount = 2;
  let strategyCount = 1;
  if (input.strategyVersionId) {
    const row = await db
      .prepare('SELECT configuration_json FROM strategy_versions WHERE id = ?')
      .bind(input.strategyVersionId)
      .first<{ configuration_json: string }>();
    const configuration = row
      ? parseJson<{ legs?: unknown[]; dateRange?: { from?: string; to?: string } }>(
          row.configuration_json,
        )
      : {};
    legCount = Array.isArray(configuration.legs) ? configuration.legs.length : 2;
  } else {
    const row = await db
      .prepare('SELECT COUNT(*) AS count FROM basket_items WHERE basket_id = ? AND selected = 1')
      .bind(input.basketId)
      .first<{ count: number }>();
    strategyCount = row?.count ?? 0;
    legCount = strategyCount * 2;
  }
  const partitions = await db
    .prepare(
      'SELECT COUNT(*) AS count, COALESCE(SUM(byte_size), 0) AS bytes FROM dataset_partitions WHERE dataset_id = ?',
    )
    .bind(input.datasetId)
    .first<{ count: number; bytes: number }>();
  const estimatedSeconds = Math.max(
    1,
    Math.ceil((partitions?.count ?? 0) * Math.max(1, legCount) * 0.012),
  );
  return {
    executionAdapter: 'browser_worker',
    strategyCount,
    legCount,
    partitionCount: partitions?.count ?? 0,
    downloadBytesUpperBound: partitions?.bytes ?? 0,
    estimatedSeconds,
    creditCost: 1,
  };
}

export const runRoutes = new Hono<AppEnvironment>();

runRoutes.post(
  '/estimate',
  rateLimit({ scope: 'run_estimate', limit: 60, windowSeconds: 60, identify: 'user' }),
  async (context) => {
    const user = context.get('user');
    const input = runRequestSchema.parse(await readJson(context, 256_000));
    await assertRunResources(context.env.DB, user.id, input);
    return ok(context, await estimateRun(context.env.DB, input));
  },
);

runRoutes.post(
  '/',
  rateLimit({ scope: 'run_create', limit: 20, windowSeconds: 60, identify: 'user' }),
  async (context) => {
    const user = context.get('user');
    const idempotencyKey = context.req.header('idempotency-key');
    if (!idempotencyKey || !/^[A-Za-z0-9._:-]{16,128}$/u.test(idempotencyKey)) {
      throw new ApiError(
        400,
        'IDEMPOTENCY_KEY_REQUIRED',
        'A valid Idempotency-Key header is required.',
      );
    }
    const input = runRequestSchema.parse(await readJson(context, 256_000));
    await assertRunResources(context.env.DB, user.id, input);
    const requestJson = canonicalJson(input);
    const requestHash = await sha256Hex(requestJson);
    const existing = await context.env.DB.prepare(
      `SELECT request_hash, resource_id FROM idempotency_records
     WHERE user_id = ? AND scope = 'run.create' AND idempotency_key = ? AND expires_at > ?`,
    )
      .bind(user.id, idempotencyKey, nowIso())
      .first<{ request_hash: string; resource_id: string }>();
    if (existing) {
      if (existing.request_hash !== requestHash)
        throw new ApiError(
          409,
          'IDEMPOTENCY_CONFLICT',
          'This idempotency key was used with a different request.',
        );
      const run = await context.env.DB.prepare(
        `SELECT id, strategy_version_id, basket_id, dataset_id, state, adapter, configuration_json, manifest_json,
              summary_json, quality_grade, credit_cost, error_code, created_at, updated_at, completed_at
       FROM backtest_runs WHERE id = ? AND user_id = ?`,
      )
        .bind(existing.resource_id, user.id)
        .first<RunRow>();
      if (!run)
        throw new ApiError(
          409,
          'IDEMPOTENCY_RESOURCE_MISSING',
          'The original idempotent resource is unavailable.',
        );
      return ok(context, mapRun(run));
    }

    const estimate = await estimateRun(context.env.DB, input);
    const runId = newId('run');
    const now = nowIso();
    try {
      await context.env.DB.batch([
        context.env.DB.prepare(
          `INSERT INTO credit_ledger(id, user_id, amount, kind, reference_type, reference_id, reason, created_at)
         VALUES (?, ?, ?, 'debit', 'backtest_run', ?, 'Backtest run', ?)`,
        ).bind(newId('crd'), user.id, -estimate.creditCost, runId, now),
        context.env.DB.prepare(
          `INSERT INTO backtest_runs(id, user_id, strategy_version_id, basket_id, dataset_id, state, adapter, request_hash,
                                   configuration_json, credit_cost, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'validated', 'browser_worker', ?, ?, ?, ?, ?)`,
        ).bind(
          runId,
          user.id,
          input.strategyVersionId ?? null,
          input.basketId ?? null,
          input.datasetId,
          requestHash,
          requestJson,
          estimate.creditCost,
          now,
          now,
        ),
        context.env.DB.prepare(
          `INSERT INTO idempotency_records(id, user_id, scope, idempotency_key, request_hash, resource_type, resource_id, created_at, expires_at)
         VALUES (?, ?, 'run.create', ?, ?, 'backtest_run', ?, ?, ?)`,
        ).bind(
          newId('idem'),
          user.id,
          idempotencyKey,
          requestHash,
          runId,
          now,
          new Date(Date.now() + 86_400_000).toISOString(),
        ),
      ]);
    } catch (error) {
      if (isD1Constraint(error, 'INSUFFICIENT_CREDITS'))
        throw new ApiError(
          402,
          'INSUFFICIENT_CREDITS',
          'There are not enough credits to start this run.',
        );
      const raced = await context.env.DB.prepare(
        `SELECT request_hash, resource_id FROM idempotency_records WHERE user_id = ? AND scope = 'run.create' AND idempotency_key = ?`,
      )
        .bind(user.id, idempotencyKey)
        .first<{ request_hash: string; resource_id: string }>();
      if (raced?.request_hash === requestHash)
        return ok(context, { id: raced.resource_id, state: 'validated', replayed: true });
      throw error;
    }
    await audit(context, {
      action: 'run.created',
      resourceType: 'backtest_run',
      resourceId: runId,
      actorUserId: user.id,
      metadata: { creditCost: estimate.creditCost, adapter: 'browser_worker' },
    });
    return ok(context, { id: runId, state: 'validated', estimate }, 201);
  },
);

runRoutes.get('/', async (context) => {
  const user = context.get('user');
  const { results } = await context.env.DB.prepare(
    `SELECT id, strategy_version_id, basket_id, dataset_id, state, adapter, configuration_json, manifest_json,
            summary_json, quality_grade, credit_cost, error_code, created_at, updated_at, completed_at
     FROM backtest_runs WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(user.id)
    .all<RunRow>();
  return ok(context, { items: results.map(mapRun) });
});

runRoutes.get('/:id', async (context) => {
  const user = context.get('user');
  const run = await context.env.DB.prepare(
    `SELECT id, strategy_version_id, basket_id, dataset_id, state, adapter, configuration_json, manifest_json,
            summary_json, quality_grade, credit_cost, error_code, created_at, updated_at, completed_at
     FROM backtest_runs WHERE id = ? AND user_id = ?`,
  )
    .bind(context.req.param('id'), user.id)
    .first<RunRow>();
  if (!run) throw notFound('Run');
  return ok(context, mapRun(run));
});

runRoutes.post('/:id/transition', async (context) => {
  const user = context.get('user');
  const input = runTransitionSchema.parse(await readJson(context, 16_384));
  const allowedPrevious: Record<typeof input.state, string> = {
    preparing_data: 'validated',
    running: 'preparing_data',
    aggregating: 'running',
  };
  const result = await context.env.DB.prepare(
    'UPDATE backtest_runs SET state = ?, updated_at = ? WHERE id = ? AND user_id = ? AND state = ?',
  )
    .bind(input.state, nowIso(), context.req.param('id'), user.id, allowedPrevious[input.state])
    .run();
  if (result.meta.changes === 0)
    throw new ApiError(409, 'RUN_STATE_CONFLICT', 'The run is not in the expected prior state.');
  return ok(context, { id: context.req.param('id'), state: input.state });
});

runRoutes.post('/:id/cancel', async (context) => {
  const user = context.get('user');
  const now = nowIso();
  const result = await context.env.DB.prepare(
    `UPDATE backtest_runs SET state = 'cancelled', updated_at = ?, completed_at = ?
     WHERE id = ? AND user_id = ? AND state IN ('draft', 'validated', 'preparing_data', 'running', 'aggregating')`,
  )
    .bind(now, now, context.req.param('id'), user.id)
    .run();
  if (result.meta.changes === 0)
    throw new ApiError(409, 'RUN_NOT_CANCELLABLE', 'The run is already terminal or unavailable.');
  await audit(context, {
    action: 'run.cancelled',
    resourceType: 'backtest_run',
    resourceId: context.req.param('id'),
    actorUserId: user.id,
  });
  return ok(context, { id: context.req.param('id'), state: 'cancelled' });
});

runRoutes.post('/:id/save', async (context) => {
  const user = context.get('user');
  const maxBytes = Math.min(
    10_000_000,
    Math.max(100_000, Number(context.env.MAX_RESULT_BYTES) || 5_242_880),
  );
  const input = saveRunSchema.parse(await readJson(context, maxBytes));
  const run = await context.env.DB.prepare(
    `SELECT id, state, dataset_id, result_object_key FROM backtest_runs WHERE id = ? AND user_id = ?`,
  )
    .bind(context.req.param('id'), user.id)
    .first<{ id: string; state: string; dataset_id: string; result_object_key: string | null }>();
  if (!run) throw notFound('Run');
  if (run.result_object_key || run.state === 'completed')
    throw new ApiError(409, 'RUN_ALREADY_SAVED', 'The completed run is immutable.');
  if (!['validated', 'preparing_data', 'running', 'aggregating'].includes(run.state))
    throw new ApiError(409, 'RUN_STATE_CONFLICT', 'Only an active run can be completed.');
  if (input.manifest.datasetId !== run.dataset_id)
    throw new ApiError(
      400,
      'RUN_MANIFEST_MISMATCH',
      'The manifest dataset does not match the run.',
    );
  const resultJson = canonicalJson(input);
  const resultHash = await sha256Hex(resultJson);
  const objectKey = `users/${user.id}/runs/${run.id}/${resultHash}.json`;
  await context.env.OBJECTS.put(objectKey, resultJson, {
    httpMetadata: {
      contentType: 'application/json',
      cacheControl: 'private, max-age=31536000, immutable',
    },
    customMetadata: { sha256: resultHash, runId: run.id },
    onlyIf: { etagDoesNotMatch: '*' },
  });
  const now = nowIso();
  const updated = await context.env.DB.prepare(
    `UPDATE backtest_runs SET state = 'completed', manifest_json = ?, summary_json = ?, result_object_key = ?,
                              result_sha256 = ?, quality_grade = ?, updated_at = ?, completed_at = ?
     WHERE id = ? AND user_id = ? AND state <> 'completed' AND result_object_key IS NULL`,
  )
    .bind(
      canonicalJson(input.manifest),
      canonicalJson(input.summary),
      objectKey,
      resultHash,
      input.qualityGrade,
      now,
      now,
      run.id,
      user.id,
    )
    .run();
  if (updated.meta.changes === 0) {
    await context.env.OBJECTS.delete(objectKey);
    throw new ApiError(409, 'RUN_STATE_CONFLICT', 'The run was completed concurrently.');
  }
  await audit(context, {
    action: 'run.completed',
    resourceType: 'backtest_run',
    resourceId: run.id,
    actorUserId: user.id,
    metadata: { resultHash, qualityGrade: input.qualityGrade },
  });
  return ok(context, { id: run.id, state: 'completed', resultHash });
});
