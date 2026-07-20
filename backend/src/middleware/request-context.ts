import { createMiddleware } from 'hono/factory';
import type { AppEnvironment } from '../types';

export const requestContext = createMiddleware<AppEnvironment>(async (context, next) => {
  const supplied = context.req.header('x-request-id');
  const requestId =
    supplied && /^[A-Za-z0-9_-]{8,80}$/u.test(supplied) ? supplied : crypto.randomUUID();
  context.set('requestId', requestId);
  const startedAt = Date.now();
  await next();
  context.header('x-request-id', requestId);
  context.header('server-timing', `total;dur=${Date.now() - startedAt}`);
});
