import { Hono } from 'hono';
import type { AppEnvironment, Bindings } from './types';
import { requestContext } from './middleware/request-context';
import { security } from './middleware/security';
import { requireAuth } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { meRoutes } from './routes/me';
import { strategyRoutes, publicShareRoutes } from './routes/strategies';
import { basketRoutes, folderRoutes } from './routes/baskets';
import { runRoutes } from './routes/runs';
import { datasetRoutes, partitionRoutes } from './routes/datasets';
import { marketRoutes } from './routes/market';
import { brokerRoutes, portfolioRoutes, tradeRoutes } from './routes/trading';
import { demoRoutes } from './routes/demo';
import { ApiError, toApiError } from './lib/errors';
import { ok } from './lib/http';

export const app = new Hono<AppEnvironment>();

app.use('*', requestContext);
app.use('*', security);

app.get('/health/live', (context) => ok(context, { status: 'ok' }));
app.get('/health/ready', async (context) => {
  await context.env.DB.prepare('SELECT 1').first();
  return ok(context, { status: 'ready', storage: 'connected' });
});

app.route('/v1/demo', demoRoutes);
app.route('/v1/auth', authRoutes);
app.route('/v1/shares', publicShareRoutes);
app.route('/v1/partitions', partitionRoutes);

const authenticated = new Hono<AppEnvironment>();
authenticated.use('*', requireAuth);
authenticated.route('/me', meRoutes);
authenticated.route('/strategies', strategyRoutes);
authenticated.route('/folders', folderRoutes);
authenticated.route('/baskets', basketRoutes);
authenticated.route('/runs', runRoutes);
authenticated.route('/datasets', datasetRoutes);
authenticated.route('/market', marketRoutes);
authenticated.route('/brokers', brokerRoutes);
authenticated.route('/portfolios', portfolioRoutes);
authenticated.route('/trade-groups', tradeRoutes);
app.route('/v1', authenticated);

app.notFound(() => {
  throw new ApiError(404, 'ROUTE_NOT_FOUND', 'The requested API route does not exist.');
});

app.onError((error, context) => {
  let apiError: ApiError;
  if (error.name === 'PayloadTooLarge') {
    apiError = new ApiError(413, 'PAYLOAD_TOO_LARGE', 'The request body is too large.');
  } else if (error.name === 'UnsupportedMediaType') {
    apiError = new ApiError(
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'Content-Type must be application/json.',
    );
  } else {
    apiError = toApiError(error);
  }
  if (apiError.status >= 500) {
    console.error(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level: 'error',
        message: 'request_failed',
        traceId: context.get('requestId'),
        method: context.req.method,
        path: new URL(context.req.url).pathname,
        code: apiError.code,
        error: error instanceof Error ? error.message : 'unknown',
      }),
    );
  }
  return context.json(
    {
      error: {
        code: apiError.code,
        message: apiError.message,
        retryable: apiError.retryable,
        ...(apiError.details === undefined ? {} : { details: apiError.details }),
        traceId: context.get('requestId'),
      },
    },
    apiError.status as 400,
  );
});

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Bindings): Promise<void> {
    const epochSeconds = Math.floor(Date.now() / 1000);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM rate_limit_windows WHERE expires_at < ?').bind(epochSeconds),
      env.DB.prepare('DELETE FROM idempotency_records WHERE expires_at < ?').bind(
        new Date().toISOString(),
      ),
      env.DB.prepare('DELETE FROM password_reset_tokens WHERE expires_at < ?').bind(
        new Date().toISOString(),
      ),
    ]);
  },
};
