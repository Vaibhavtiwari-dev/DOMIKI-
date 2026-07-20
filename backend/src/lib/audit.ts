import type { Context } from 'hono';
import type { AppEnvironment } from '../types';
import { canonicalJson, newId, redactIp } from './crypto';
import { clientIp } from './http';
import { nowIso } from './db';

export async function audit(
  context: Context<AppEnvironment>,
  input: {
    action: string;
    resourceType: string;
    resourceId?: string;
    actorUserId?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await context.env.DB.prepare(
    `INSERT INTO audit_events
      (id, actor_user_id, action, resource_type, resource_id, trace_id, ip_prefix, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      newId('aud'),
      input.actorUserId ?? null,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      context.get('requestId'),
      redactIp(clientIp(context)),
      canonicalJson(input.metadata ?? {}),
      nowIso(),
    )
    .run();
}
