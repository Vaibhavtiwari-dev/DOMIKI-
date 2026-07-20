import { createMiddleware } from 'hono/factory';
import type { AppEnvironment } from '../types';
import { ApiError } from '../lib/errors';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function allowedOrigins(value: string): Set<string> {
  return new Set(
    value
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

export const security = createMiddleware<AppEnvironment>(async (context, next) => {
  const origins = allowedOrigins(context.env.ALLOWED_ORIGINS);
  const origin = context.req.header('origin');

  if (origin && !origins.has(origin)) {
    throw new ApiError(403, 'ORIGIN_NOT_ALLOWED', 'The request origin is not allowed.');
  }
  if (
    UNSAFE_METHODS.has(context.req.method) &&
    origin === undefined &&
    context.env.APP_ENV === 'production'
  ) {
    throw new ApiError(403, 'ORIGIN_REQUIRED', 'A valid Origin header is required.');
  }

  if (context.req.method === 'OPTIONS') {
    if (!origin) throw new ApiError(400, 'ORIGIN_REQUIRED', 'An Origin header is required.');
    context.header('access-control-allow-origin', origin);
    context.header('access-control-allow-credentials', 'true');
    context.header('access-control-allow-methods', 'GET,HEAD,POST,PATCH,DELETE,OPTIONS');
    context.header(
      'access-control-allow-headers',
      'Content-Type,Idempotency-Key,X-CSRF-Token,X-Request-ID',
    );
    context.header('access-control-max-age', '600');
    context.header('vary', 'Origin');
    return context.body(null, 204);
  }

  await next();

  if (origin) {
    context.header('access-control-allow-origin', origin);
    context.header('access-control-allow-credentials', 'true');
    context.header('vary', 'Origin');
  }
  context.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
  context.header('cross-origin-opener-policy', 'same-origin');
  context.header('cross-origin-resource-policy', 'same-site');
  context.header('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  context.header('referrer-policy', 'no-referrer');
  context.header('strict-transport-security', 'max-age=63072000; includeSubDomains; preload');
  context.header('x-content-type-options', 'nosniff');
  context.header('x-frame-options', 'DENY');
  context.header('cache-control', context.res.headers.get('cache-control') ?? 'no-store');
});
