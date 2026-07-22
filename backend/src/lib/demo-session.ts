import { getCookie, setCookie } from 'hono/cookie';
import type { Context, MiddlewareHandler } from 'hono';
import type { AppEnvironment } from '../types.js';
import { ApiError } from './errors.js';
import { constantTimeEqual, hmacSha256 } from './crypto.js';

const COOKIE_NAME = 'dokimi_demo_session';
const MAX_AGE_SECONDS = 12 * 60 * 60;
const encoder = new TextEncoder();

function signingSecret(context: Context<AppEnvironment>): string {
  const secret = context.env.SESSION_SIGNING_SECRET;
  if (!secret || secret.length < 32) {
    throw new ApiError(
      503,
      'SESSION_CONFIGURATION_REQUIRED',
      'Demo sessions are unavailable until the server signing secret is configured.',
    );
  }
  return secret;
}

export async function startDemoSession(context: Context<AppEnvironment>): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const payload = `${issuedAt}.${nonce}`;
  const signature = await hmacSha256(signingSecret(context), payload);
  const token = `${payload}.${signature}`;
  setCookie(context, COOKIE_NAME, token, {
    httpOnly: true,
    secure: context.env.APP_ENV !== 'development',
    sameSite: 'Strict',
    path: '/',
    maxAge: MAX_AGE_SECONDS,
  });
  return new Date((issuedAt + MAX_AGE_SECONDS) * 1000).toISOString();
}

export function endDemoSession(context: Context<AppEnvironment>): void {
  setCookie(context, COOKIE_NAME, '', {
    httpOnly: true,
    secure: context.env.APP_ENV !== 'development',
    sameSite: 'Strict',
    path: '/',
    maxAge: 0,
  });
}

export async function hasValidDemoSession(context: Context<AppEnvironment>): Promise<boolean> {
  const token = getCookie(context, COOKIE_NAME);
  if (!token || token.length > 256) return false;
  const [issuedAtText, nonce, providedSignature, ...extra] = token.split('.');
  if (!issuedAtText || !nonce || !providedSignature || extra.length > 0) return false;
  const issuedAt = Number(issuedAtText);
  if (!Number.isInteger(issuedAt) || nonce.length > 64) return false;
  const now = Math.floor(Date.now() / 1000);
  if (issuedAt > now + 60 || issuedAt + MAX_AGE_SECONDS < now) return false;
  const expected = await hmacSha256(signingSecret(context), `${issuedAtText}.${nonce}`);
  return constantTimeEqual(encoder.encode(expected), encoder.encode(providedSignature));
}

export const requireDemoSession: MiddlewareHandler<AppEnvironment> = async (context, next) => {
  if (!(await hasValidDemoSession(context))) {
    throw new ApiError(401, 'DEMO_SESSION_REQUIRED', 'Initialize a research session to continue.');
  }
  await next();
};
