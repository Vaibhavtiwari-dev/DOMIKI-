import { createMiddleware } from 'hono/factory';
import type { AppEnvironment } from '../types';
import { ApiError } from '../lib/errors';
import { clientIp } from '../lib/http';
import { redactIp, sha256Hex } from '../lib/crypto';

interface RateLimitOptions {
  scope: string;
  limit: number;
  windowSeconds: number;
  identify?: 'ip' | 'user';
}

export function rateLimit(options: RateLimitOptions) {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const identity =
      options.identify === 'user'
        ? context.get('user').id
        : (redactIp(clientIp(context)) ?? 'unknown');
    const key = await sha256Hex(`${options.scope}:${identity}`);
    const epochSeconds = Math.floor(Date.now() / 1000);
    const windowStart = Math.floor(epochSeconds / options.windowSeconds) * options.windowSeconds;
    const result = await context.env.DB.prepare(
      `INSERT INTO rate_limit_windows(key, window_start, count, expires_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
      .bind(key, windowStart, windowStart + options.windowSeconds * 2)
      .first<{ count: number }>();

    const remaining = Math.max(0, options.limit - (result?.count ?? options.limit + 1));
    context.header('ratelimit-limit', String(options.limit));
    context.header('ratelimit-remaining', String(remaining));
    context.header('ratelimit-reset', String(windowStart + options.windowSeconds));
    if ((result?.count ?? options.limit + 1) > options.limit) {
      context.header('retry-after', String(windowStart + options.windowSeconds - epochSeconds));
      throw new ApiError(429, 'RATE_LIMITED', 'Too many requests. Try again later.', true);
    }
    await next();
  });
}
