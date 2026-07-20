import { Hono } from 'hono';
import type { AppEnvironment } from '../types';
import {
  loginSchema,
  resetConfirmSchema,
  resetRequestSchema,
  signUpSchema,
} from '../domain/api-schemas';
import { readJson, ok } from '../lib/http';
import { ApiError, isD1Constraint } from '../lib/errors';
import { hashPassword, hmacSha256, newId, randomToken, verifyPassword } from '../lib/crypto';
import { nowIso } from '../lib/db';
import { audit } from '../lib/audit';
import { clearSessionCookies, requireAuth, setSessionCookies } from '../middleware/auth';
import { rateLimit } from '../middleware/rate-limit';

interface UserRow {
  id: string;
  phone_e164: string | null;
  email: string | null;
  password_hash: string;
  phone_verified_at: string | null;
  role: 'user' | 'operator' | 'admin';
  display_name: string | null;
  timezone: string;
  locale: string;
}

function sessionTtl(value: string): number {
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 3600 && seconds <= 31_536_000
    ? seconds
    : 2_592_000;
}

function publicUser(user: UserRow) {
  return {
    id: user.id,
    phone: user.phone_e164,
    email: user.email,
    phoneVerified: user.phone_verified_at !== null,
    role: user.role,
    displayName: user.display_name,
    timezone: user.timezone,
    locale: user.locale,
  };
}

async function createSession(context: Parameters<typeof ok>[0], userId: string): Promise<void> {
  const token = randomToken();
  const csrfToken = randomToken();
  const ttl = sessionTtl(context.env.SESSION_TTL_SECONDS);
  const now = nowIso();
  await context.env.DB.prepare(
    `INSERT INTO sessions(id, user_id, token_hash, csrf_hash, user_agent, ip_prefix, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
  )
    .bind(
      newId('ses'),
      userId,
      await hmacSha256(context.env.SESSION_SIGNING_SECRET, token),
      await hmacSha256(context.env.SESSION_SIGNING_SECRET, csrfToken),
      (context.req.header('user-agent') ?? '').slice(0, 500) || null,
      now,
      now,
      new Date(Date.now() + ttl * 1000).toISOString(),
    )
    .run();
  setSessionCookies(context, token, csrfToken, ttl);
}

export const authRoutes = new Hono<AppEnvironment>();

authRoutes.post(
  '/signup',
  rateLimit({ scope: 'auth_signup', limit: 5, windowSeconds: 3600 }),
  async (context) => {
    const input = signUpSchema.parse(await readJson(context, 16_384));
    const now = nowIso();
    const userId = newId('usr');
    const referralCode = userId.slice(-10).toUpperCase();
    const referrer = input.referralCode
      ? await context.env.DB.prepare(
          'SELECT id FROM users WHERE referral_code = ? AND deleted_at IS NULL',
        )
          .bind(input.referralCode.toUpperCase())
          .first<{ id: string }>()
      : null;
    if (input.referralCode && !referrer) {
      throw new ApiError(400, 'REFERRAL_CODE_INVALID', 'The referral code is invalid.');
    }

    const user: UserRow = {
      id: userId,
      phone_e164: input.phone ?? null,
      email: input.email ?? null,
      password_hash: await hashPassword(input.password),
      phone_verified_at: null,
      role: 'user',
      display_name: null,
      timezone: 'Asia/Kolkata',
      locale: 'en-IN',
    };

    try {
      const statements = [
        context.env.DB.prepare(
          `INSERT INTO users(id, phone_e164, email, password_hash, referral_code, referred_by_user_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          userId,
          input.phone ?? null,
          input.email ?? null,
          user.password_hash,
          referralCode,
          referrer?.id ?? null,
          now,
          now,
        ),
        context.env.DB.prepare(
          `INSERT INTO credit_ledger(id, user_id, amount, kind, reference_type, reference_id, reason, created_at)
         VALUES (?, ?, 10, 'signup', 'user', ?, 'Private alpha sign-up grant', ?)`,
        ).bind(newId('crd'), userId, userId, now),
        context.env.DB.prepare(
          `INSERT INTO entitlements(id, user_id, feature, value_json, source, starts_at, created_at)
         VALUES (?, ?, 'research.backtest', '{"enabled":true,"maxLegs":20,"rollingDays":365}', 'signup', ?, ?)`,
        ).bind(newId('ent'), userId, now, now),
        context.env.DB.prepare(
          `INSERT INTO entitlements(id, user_id, feature, value_json, source, starts_at, created_at)
         VALUES (?, ?, 'research.analytics', '{"enabled":true}', 'signup', ?, ?)`,
        ).bind(newId('ent'), userId, now, now),
      ];
      if (referrer) {
        statements.push(
          context.env.DB.prepare(
            `INSERT INTO credit_ledger(id, user_id, amount, kind, reference_type, reference_id, reason, created_at)
           VALUES (?, ?, 2, 'referral', 'referred_user', ?, 'Referral reward', ?)`,
          ).bind(newId('crd'), referrer.id, userId, now),
        );
      }
      await context.env.DB.batch(statements);
    } catch (error) {
      if (isD1Constraint(error, 'users.phone_e164') || isD1Constraint(error, 'users.email')) {
        throw new ApiError(
          409,
          'IDENTITY_ALREADY_REGISTERED',
          'An account already exists for this identity.',
        );
      }
      throw error;
    }

    await createSession(context, userId);
    await audit(context, {
      action: 'auth.signup',
      resourceType: 'user',
      resourceId: userId,
      actorUserId: userId,
    });
    return ok(context, { user: publicUser(user) }, 201);
  },
);

authRoutes.post(
  '/login',
  rateLimit({ scope: 'auth_login', limit: 10, windowSeconds: 900 }),
  async (context) => {
    const input = loginSchema.parse(await readJson(context, 16_384));
    const user = await context.env.DB.prepare(
      `SELECT id, phone_e164, email, password_hash, phone_verified_at, role, display_name, timezone, locale
     FROM users WHERE ${input.email ? 'email = ? COLLATE NOCASE' : 'phone_e164 = ?'} AND deleted_at IS NULL`,
    )
      .bind(input.email ?? input.phone)
      .first<UserRow>();
    const passwordValid = user
      ? await verifyPassword(input.password, user.password_hash)
      : (await hashPassword(input.password), false);
    if (!user || !passwordValid) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'The phone number or password is incorrect.');
    }
    if (
      context.env.PHONE_VERIFICATION_REQUIRED === 'true' &&
      user.phone_e164 &&
      !user.phone_verified_at
    ) {
      throw new ApiError(403, 'PHONE_VERIFICATION_REQUIRED', 'Phone verification is required.');
    }
    await createSession(context, user.id);
    await audit(context, { action: 'auth.login', resourceType: 'session', actorUserId: user.id });
    return ok(context, { user: publicUser(user) });
  },
);

authRoutes.post('/logout', requireAuth, async (context) => {
  const user = context.get('user');
  await context.env.DB.prepare(
    'UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  )
    .bind(nowIso(), user.sessionId)
    .run();
  clearSessionCookies(context);
  await audit(context, {
    action: 'auth.logout',
    resourceType: 'session',
    resourceId: user.sessionId,
    actorUserId: user.id,
  });
  return context.body(null, 204);
});

authRoutes.post(
  '/password-reset/request',
  rateLimit({ scope: 'password_reset', limit: 3, windowSeconds: 3600 }),
  async (context) => {
    const input = resetRequestSchema.parse(await readJson(context, 16_384));
    const user = await context.env.DB.prepare(
      `SELECT id FROM users WHERE ${input.email ? 'email = ? COLLATE NOCASE' : 'phone_e164 = ?'} AND deleted_at IS NULL`,
    )
      .bind(input.email ?? input.phone)
      .first<{ id: string }>();
    if (user && context.env.PASSWORD_RESET_WEBHOOK_URL) {
      const token = randomToken(48);
      const now = nowIso();
      await context.env.DB.prepare(
        `INSERT INTO password_reset_tokens(id, user_id, token_hash, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      )
        .bind(
          newId('rst'),
          user.id,
          await hmacSha256(context.env.SESSION_SIGNING_SECRET, token),
          new Date(Date.now() + 15 * 60 * 1000).toISOString(),
          now,
        )
        .run();
      const webhook = new URL(context.env.PASSWORD_RESET_WEBHOOK_URL);
      if (webhook.protocol !== 'https:')
        throw new ApiError(
          500,
          'SERVER_MISCONFIGURED',
          'Password reset delivery is misconfigured.',
        );
      const response = await fetch(webhook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ userId: user.id, resetToken: token, expiresInSeconds: 900 }),
      });
      if (!response.ok)
        throw new ApiError(
          503,
          'NOTIFICATION_UNAVAILABLE',
          'Password reset delivery is temporarily unavailable.',
          true,
        );
    }
    return ok(context, { accepted: true });
  },
);

authRoutes.post(
  '/password-reset/confirm',
  rateLimit({ scope: 'password_reset_confirm', limit: 5, windowSeconds: 3600 }),
  async (context) => {
    const input = resetConfirmSchema.parse(await readJson(context, 16_384));
    const hash = await hmacSha256(context.env.SESSION_SIGNING_SECRET, input.token);
    const reset = await context.env.DB.prepare(
      'SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?',
    )
      .bind(hash, nowIso())
      .first<{ id: string; user_id: string }>();
    if (!reset)
      throw new ApiError(400, 'RESET_TOKEN_INVALID', 'The reset token is invalid or expired.');
    const now = nowIso();
    await context.env.DB.batch([
      context.env.DB.prepare(
        'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
      ).bind(await hashPassword(input.password), now, reset.user_id),
      context.env.DB.prepare(
        'UPDATE password_reset_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL',
      ).bind(now, reset.id),
      context.env.DB.prepare(
        'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      ).bind(now, reset.user_id),
    ]);
    await audit(context, {
      action: 'auth.password_reset',
      resourceType: 'user',
      resourceId: reset.user_id,
      actorUserId: reset.user_id,
    });
    return ok(context, { reset: true });
  },
);
