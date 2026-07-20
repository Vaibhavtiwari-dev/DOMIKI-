import { Hono } from 'hono';
import type { AppEnvironment } from '../types';
import { manifestRequestSchema } from '../domain/api-schemas';
import { readJson, ok } from '../lib/http';
import { hmacSha256, verifyHmac } from '../lib/crypto';
import { nowIso, parseJson } from '../lib/db';
import { ApiError, notFound } from '../lib/errors';

interface DatasetRow {
  id: string;
  name: string;
  version: string;
  source_type: string;
  rights_json: string;
  quality_grade: string;
  instrument_master_version: string;
  calendar_version: string;
  published_at: string | null;
}

async function canAccessDataset(
  db: D1Database,
  userId: string,
  dataset: DatasetRow,
): Promise<boolean> {
  if (dataset.source_type === 'synthetic' || dataset.source_type === 'sample') return true;
  const rights = parseJson<{ entitlementFeature?: unknown }>(dataset.rights_json);
  if (typeof rights.entitlementFeature !== 'string') return false;
  const row = await db
    .prepare(
      `SELECT id FROM entitlements WHERE user_id = ? AND feature = ? AND starts_at <= ?
     AND (expires_at IS NULL OR expires_at > ?) LIMIT 1`,
    )
    .bind(userId, rights.entitlementFeature, nowIso(), nowIso())
    .first();
  return row !== null;
}

export const datasetRoutes = new Hono<AppEnvironment>();

datasetRoutes.get('/', async (context) => {
  const user = context.get('user');
  const { results } = await context.env.DB.prepare(
    `SELECT id, name, version, source_type, rights_json, quality_grade, instrument_master_version,
            calendar_version, published_at FROM datasets WHERE active = 1 ORDER BY published_at DESC`,
  ).all<DatasetRow>();
  const accessible = [];
  for (const dataset of results) {
    if (await canAccessDataset(context.env.DB, user.id, dataset)) {
      accessible.push({
        id: dataset.id,
        name: dataset.name,
        version: dataset.version,
        sourceType: dataset.source_type,
        qualityGrade: dataset.quality_grade,
        instrumentMasterVersion: dataset.instrument_master_version,
        calendarVersion: dataset.calendar_version,
        publishedAt: dataset.published_at,
      });
    }
  }
  return ok(context, { items: accessible });
});

datasetRoutes.post('/:id/manifest', async (context) => {
  const user = context.get('user');
  const input = manifestRequestSchema.parse(await readJson(context, 32_768));
  const dataset = await context.env.DB.prepare(
    `SELECT id, name, version, source_type, rights_json, quality_grade, instrument_master_version,
            calendar_version, published_at FROM datasets WHERE id = ? AND active = 1`,
  )
    .bind(context.req.param('id'))
    .first<DatasetRow>();
  if (!dataset || !(await canAccessDataset(context.env.DB, user.id, dataset)))
    throw notFound('Dataset');
  const { results } = await context.env.DB.prepare(
    `SELECT id, trade_date, sha256, byte_size, row_count, quality_grade, metadata_json
     FROM dataset_partitions WHERE dataset_id = ? AND symbol = ? AND trade_date BETWEEN ? AND ?
     ORDER BY trade_date`,
  )
    .bind(dataset.id, input.symbol, input.from, input.to)
    .all<{
      id: string;
      trade_date: string;
      sha256: string;
      byte_size: number;
      row_count: number;
      quality_grade: string;
      metadata_json: string;
    }>();
  const expiresAt = Math.floor(Date.now() / 1000) + 300;
  const partitions = await Promise.all(
    results.map(async (partition) => {
      const payload = `${user.id}:${partition.id}:${expiresAt}`;
      const signature = await hmacSha256(context.env.DATASET_SIGNING_SECRET, payload);
      const query = new URLSearchParams({ uid: user.id, exp: String(expiresAt), sig: signature });
      return {
        id: partition.id,
        tradeDate: partition.trade_date,
        sha256: partition.sha256,
        byteSize: partition.byte_size,
        rowCount: partition.row_count,
        qualityGrade: partition.quality_grade,
        metadata: parseJson<unknown>(partition.metadata_json),
        url: `${context.env.API_BASE_URL}/v1/partitions/${partition.id}?${query.toString()}`,
      };
    }),
  );
  return ok(context, {
    dataset: {
      id: dataset.id,
      version: dataset.version,
      qualityGrade: dataset.quality_grade,
      instrumentMasterVersion: dataset.instrument_master_version,
      calendarVersion: dataset.calendar_version,
    },
    query: input,
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    partitions,
  });
});

export const partitionRoutes = new Hono<AppEnvironment>();

partitionRoutes.get('/:id', async (context) => {
  const partitionId = context.req.param('id');
  const userId = context.req.query('uid');
  const expiry = Number(context.req.query('exp'));
  const signature = context.req.query('sig');
  if (
    !userId ||
    !signature ||
    !Number.isSafeInteger(expiry) ||
    expiry < Math.floor(Date.now() / 1000) ||
    expiry > Math.floor(Date.now() / 1000) + 600
  ) {
    throw new ApiError(403, 'SIGNED_URL_INVALID', 'The partition URL is invalid or expired.');
  }
  if (
    !(await verifyHmac(
      context.env.DATASET_SIGNING_SECRET,
      `${userId}:${partitionId}:${expiry}`,
      signature,
    ))
  ) {
    throw new ApiError(403, 'SIGNED_URL_INVALID', 'The partition URL is invalid or expired.');
  }
  const partition = await context.env.DB.prepare(
    `SELECT p.object_key, p.sha256, p.byte_size FROM dataset_partitions p
     JOIN datasets d ON d.id = p.dataset_id WHERE p.id = ? AND d.active = 1`,
  )
    .bind(partitionId)
    .first<{ object_key: string; sha256: string; byte_size: number }>();
  if (!partition) throw notFound('Partition');
  const object = await context.env.OBJECTS.get(partition.object_key, {
    range: context.req.raw.headers,
  });
  if (!object)
    throw new ApiError(
      503,
      'DATA_PARTITION_UNAVAILABLE',
      'The partition object is temporarily unavailable.',
      true,
      { partitionId },
    );
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('x-content-sha256', partition.sha256);
  headers.set('accept-ranges', 'bytes');
  headers.set('cache-control', 'private, max-age=300');
  if ('range' in object) {
    const range = object.range;
    if ('offset' in range && 'length' in range) {
      const { offset, length } = range;
      headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${partition.byte_size}`);
      headers.set('content-length', String(length));
      return new Response(object.body, { status: 206, headers });
    }
  }
  headers.set('content-length', String(partition.byte_size));
  return new Response(object.body, { status: 200, headers });
});
