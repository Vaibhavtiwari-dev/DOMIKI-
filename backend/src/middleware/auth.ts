import { getCookie, setCookie } from 'hono/cookie';
import { createMiddleware } from 'hono/factory';
import type { Context } from 'hono';
import type { AppEnvironment, AuthUser } from '../types';
import { ApiError, forbidden } from '../lib/errors';
import { constantTimeEqual, hmacSha256 } from '../lib/crypto';

const encoder = new TextEncoder();
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function sessionCookieName(context: Context<AppEnvironment>): string {
  return context.env.APP_ENV === 'production' ? '__Host-dokimi_session' : 'dokimi_session';
}

export function setSessionCookies(
  context: Context<AppEnvironment>,
  sessionToken: string,
  csrfToken: string,
  maxAge: number,
): void {
  const secure = context.env.APP_ENV !== 'development';
  setCookie(context, sessionCookieName(context), sessionToken, {
    httpOnly: true,
    secure,
    sameSite: 'Strict',
    path: '/',
    maxAge,
  });
  setCookie(context, 'dokimi_csrf', csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'Strict',
    path: '/',
    maxAge,
  });
}

export function clearSessionCookies(context: Context<AppEnvironment>): void {
  setSessionCookies(context, '', '', 0);
}

function bearerToken(context: Context<AppEnvironment>): string | undefined {
  const authorization = context.req.header('authorization');
  if (!authorization?.startsWith('Bearer ')) return undefined;
  return authorization.slice('Bearer '.length);
}

export const requireAuth = createMiddleware<AppEnvironment>(async (context, next) => {
  const token = getCookie(context, sessionCookieName(context)) ?? bearerToken(context);
  if (!token || token.length < 32 || token.length > 256) {
    throw new ApiError(401, 'AUTHENTICATION_REQUIRED', 'Authentication is required.');
  }
  const tokenHash = await hmacSha256(context.env.SESSION_SIGNING_SECRET, token);
  const row = await context.env.DB.prepare(
    `SELECT s.id AS session_id, s.csrf_hash, s.last_seen_at, u.id, u.phone_e164, u.email, u.role
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.deleted_at IS NULL`,
  )
    .bind(tokenHash, new Date().toISOString())
    .first<{
      session_id: string;
      csrf_hash: string;
      last_seen_at: string;
      id: string;
      phone_e164: string | null;
      email: string | null;
      role: AuthUser['role'];
    }>();
  if (!row) throw new ApiError(401, 'SESSION_INVALID', 'The session is invalid or expired.');

  if (UNSAFE_METHODS.has(context.req.method) && bearerToken(context) === undefined) {
    const cookieCsrf = getCookie(context, 'dokimi_csrf');
    const headerCsrf = context.req.header('x-csrf-token');
    if (
      !cookieCsrf ||
      !headerCsrf ||
      !constantTimeEqual(encoder.encode(cookieCsrf), encoder.encode(headerCsrf))
    ) {
      throw new ApiError(403, 'CSRF_VALIDATION_FAILED', 'CSRF validation failed.');
    }
    const csrfHash = await hmacSha256(context.env.SESSION_SIGNING_SECRET, headerCsrf);
    if (!constantTimeEqual(encoder.encode(csrfHash), encoder.encode(row.csrf_hash))) {
      throw new ApiError(403, 'CSRF_VALIDATION_FAILED', 'CSRF validation failed.');
    }
  }

  context.set('user', {
    id: row.id,
    phoneE164: row.phone_e164,
    email: row.email,
    role: row.role,
    sessionId: row.session_id,
    csrfHash: row.csrf_hash,
  });

  if (Date.now() - new Date(row.last_seen_at).getTime() > 15 * 60 * 1000) {
    context.executionCtx.waitUntil(
      context.env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?')
        .bind(new Date().toISOString(), row.session_id)
        .run(),
    );
  }
  await next();
});

export const requireOperator = createMiddleware<AppEnvironment>(async (context, next) => {
  const user = context.get('user');
  if (user.role !== 'operator' && user.role !== 'admin') throw forbidden();
  const apiKey = context.req.header('x-operator-key');
  const expected = context.env.OPERATOR_API_KEY;
  if (
    !apiKey ||
    !expected ||
    !constantTimeEqual(encoder.encode(apiKey), encoder.encode(expected))
  ) {
    throw forbidden();
  }
  await next();
});
