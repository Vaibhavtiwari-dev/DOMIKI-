import { Hono } from 'hono';
import type { AppEnvironment } from '../types';
import { updateProfileSchema } from '../domain/api-schemas';
import { readJson, ok } from '../lib/http';
import { canonicalJson } from '../lib/crypto';
import { nowIso, parseJson } from '../lib/db';
import { audit } from '../lib/audit';
import { ApiError } from '../lib/errors';

export const meRoutes = new Hono<AppEnvironment>();

meRoutes.get('/', async (context) => {
  const auth = context.get('user');
  const user = await context.env.DB.prepare(
    `SELECT id, phone_e164, email, phone_verified_at, role, display_name, invoice_name, timezone, locale,
            preferences_json, referral_code, created_at
     FROM users WHERE id = ? AND deleted_at IS NULL`,
  )
    .bind(auth.id)
    .first<{
      id: string;
      phone_e164: string | null;
      email: string | null;
      phone_verified_at: string | null;
      role: string;
      display_name: string | null;
      invoice_name: string | null;
      timezone: string;
      locale: string;
      preferences_json: string;
      referral_code: string;
      created_at: string;
    }>();
  if (!user) throw new ApiError(401, 'SESSION_INVALID', 'The account is no longer available.');
  return ok(context, {
    id: user.id,
    phone: user.phone_e164,
    email: user.email,
    phoneVerified: user.phone_verified_at !== null,
    role: user.role,
    displayName: user.display_name,
    invoiceName: user.invoice_name,
    timezone: user.timezone,
    locale: user.locale,
    preferences: parseJson<Record<string, unknown>>(user.preferences_json),
    referralCode: user.referral_code,
    createdAt: user.created_at,
  });
});

meRoutes.patch('/', async (context) => {
  const auth = context.get('user');
  const input = updateProfileSchema.parse(await readJson(context, 64_000));
  const existing = await context.env.DB.prepare(
    'SELECT display_name, invoice_name, timezone, locale, preferences_json FROM users WHERE id = ?',
  )
    .bind(auth.id)
    .first<{
      display_name: string | null;
      invoice_name: string | null;
      timezone: string;
      locale: string;
      preferences_json: string;
    }>();
  if (!existing) throw new ApiError(404, 'NOT_FOUND', 'User was not found.');
  await context.env.DB.prepare(
    `UPDATE users SET display_name = ?, invoice_name = ?, timezone = ?, locale = ?, preferences_json = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(
      input.displayName === undefined ? existing.display_name : input.displayName,
      input.invoiceName === undefined ? existing.invoice_name : input.invoiceName,
      input.timezone ?? existing.timezone,
      input.locale ?? existing.locale,
      input.preferences === undefined
        ? existing.preferences_json
        : canonicalJson(input.preferences),
      nowIso(),
      auth.id,
    )
    .run();
  await audit(context, {
    action: 'user.profile_updated',
    resourceType: 'user',
    resourceId: auth.id,
    actorUserId: auth.id,
    metadata: { fields: Object.keys(input) },
  });
  return ok(context, { updated: true });
});

meRoutes.get('/sessions', async (context) => {
  const auth = context.get('user');
  const { results } = await context.env.DB.prepare(
    `SELECT id, user_agent, created_at, last_seen_at, expires_at
     FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC`,
  )
    .bind(auth.id, nowIso())
    .all<{
      id: string;
      user_agent: string | null;
      created_at: string;
      last_seen_at: string;
      expires_at: string;
    }>();
  return ok(
    context,
    results.map((session) => ({ ...session, current: session.id === auth.sessionId })),
  );
});

meRoutes.delete('/sessions/:id', async (context) => {
  const auth = context.get('user');
  await context.env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
  )
    .bind(nowIso(), context.req.param('id'), auth.id)
    .run();
  await audit(context, {
    action: 'session.revoked',
    resourceType: 'session',
    resourceId: context.req.param('id'),
    actorUserId: auth.id,
  });
  return context.body(null, 204);
});

meRoutes.get('/entitlements', async (context) => {
  const user = context.get('user');
  const now = nowIso();
  const [entitlements, balance] = await Promise.all([
    context.env.DB.prepare(
      `SELECT feature, value_json, source, starts_at, expires_at FROM entitlements
       WHERE user_id = ? AND starts_at <= ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY feature, starts_at DESC`,
    )
      .bind(user.id, now, now)
      .all<{
        feature: string;
        value_json: string;
        source: string;
        starts_at: string;
        expires_at: string | null;
      }>(),
    context.env.DB.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS balance FROM credit_ledger
       WHERE user_id = ? AND (expires_at IS NULL OR expires_at > ?)`,
    )
      .bind(user.id, now)
      .first<{ balance: number }>(),
  ]);
  return ok(context, {
    credits: balance?.balance ?? 0,
    entitlements: entitlements.results.map((item) => ({
      feature: item.feature,
      value: parseJson<unknown>(item.value_json),
      source: item.source,
      startsAt: item.starts_at,
      expiresAt: item.expires_at,
    })),
  });
});
