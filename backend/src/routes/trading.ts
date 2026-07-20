import { Hono } from 'hono';
import type { AppEnvironment } from '../types';
import { createPortfolioSchema, createTradeGroupSchema } from '../domain/api-schemas';
import { readJson, ok } from '../lib/http';
import { canonicalJson, newId, sha256Hex } from '../lib/crypto';
import { nowIso, parseJson } from '../lib/db';
import { ApiError, notFound } from '../lib/errors';
import { audit } from '../lib/audit';
import { rateLimit } from '../middleware/rate-limit';

interface DraftOrder {
  clientOrderId: string;
  instrumentKey: string;
  side: 'buy' | 'sell';
  quantity: number;
  orderType: 'market' | 'limit';
  limitPricePaise?: number;
  referencePricePaise: number;
}

export const portfolioRoutes = new Hono<AppEnvironment>();

portfolioRoutes.get('/', async (context) => {
  const user = context.get('user');
  const { results } = await context.env.DB.prepare(
    `SELECT id, name, base_currency, starting_capital_paise, status, created_at, updated_at
     FROM paper_portfolios WHERE user_id = ? ORDER BY updated_at DESC`,
  )
    .bind(user.id)
    .all();
  return ok(context, { items: results });
});

portfolioRoutes.post('/', async (context) => {
  const user = context.get('user');
  const input = createPortfolioSchema.parse(await readJson(context, 32_768));
  const id = newId('prt');
  const now = nowIso();
  await context.env.DB.prepare(
    `INSERT INTO paper_portfolios(id, user_id, name, starting_capital_paise, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, user.id, input.name, input.startingCapitalPaise, now, now)
    .run();
  await audit(context, {
    action: 'portfolio.created',
    resourceType: 'paper_portfolio',
    resourceId: id,
    actorUserId: user.id,
  });
  return ok(context, { id, mode: 'paper' }, 201);
});

portfolioRoutes.delete('/:id', async (context) => {
  const user = context.get('user');
  const open = await context.env.DB.prepare(
    `SELECT id FROM trade_groups WHERE portfolio_id = ? AND user_id = ? AND status IN ('entry_pending', 'open', 'exit_pending', 'partial') LIMIT 1`,
  )
    .bind(context.req.param('id'), user.id)
    .first();
  if (open)
    throw new ApiError(
      409,
      'PORTFOLIO_HAS_OPEN_TRADES',
      'Close or cancel open trades before archiving this portfolio.',
    );
  const result = await context.env.DB.prepare(
    `UPDATE paper_portfolios SET status = 'archived', updated_at = ? WHERE id = ? AND user_id = ?`,
  )
    .bind(nowIso(), context.req.param('id'), user.id)
    .run();
  if (result.meta.changes === 0) throw notFound('Portfolio');
  return context.body(null, 204);
});

export const brokerRoutes = new Hono<AppEnvironment>();

brokerRoutes.get('/', (context) =>
  ok(context, {
    adapters: [
      { id: 'paper', name: 'Dokimi Paper Broker', modes: ['paper'], status: 'available' },
      {
        id: 'live',
        name: 'Live broker',
        modes: ['live'],
        status: 'release_gated',
        reason: 'Broker selection, threat model, and regulatory approval are pending.',
      },
    ],
  }),
);

brokerRoutes.post('/:broker/authorize', async (context) => {
  const user = context.get('user');
  const broker = context.req.param('broker');
  if (broker !== 'paper') {
    throw new ApiError(
      503,
      'BROKER_ADAPTER_UNCONFIGURED',
      'No approved live broker adapter is configured.',
    );
  }
  const existing = await context.env.DB.prepare(
    `SELECT id FROM broker_connections WHERE user_id = ? AND broker = 'paper' AND mode = 'paper'`,
  )
    .bind(user.id)
    .first<{ id: string }>();
  if (existing)
    return ok(context, { id: existing.id, broker: 'paper', mode: 'paper', status: 'active' });
  const id = newId('brc');
  const now = nowIso();
  await context.env.DB.prepare(
    `INSERT INTO broker_connections(id, user_id, broker, mode, status, created_at, updated_at)
     VALUES (?, ?, 'paper', 'paper', 'active', ?, ?)`,
  )
    .bind(id, user.id, now, now)
    .run();
  await audit(context, {
    action: 'broker.connected',
    resourceType: 'broker_connection',
    resourceId: id,
    actorUserId: user.id,
    metadata: { broker: 'paper', mode: 'paper' },
  });
  return ok(context, { id, broker: 'paper', mode: 'paper', status: 'active' }, 201);
});

brokerRoutes.delete('/connections/:id', async (context) => {
  const user = context.get('user');
  const result = await context.env.DB.prepare(
    `UPDATE broker_connections SET status = 'revoked', revoked_at = ?, updated_at = ?
     WHERE id = ? AND user_id = ? AND status <> 'revoked'`,
  )
    .bind(nowIso(), nowIso(), context.req.param('id'), user.id)
    .run();
  if (result.meta.changes === 0) throw notFound('Broker connection');
  await audit(context, {
    action: 'broker.disconnected',
    resourceType: 'broker_connection',
    resourceId: context.req.param('id'),
    actorUserId: user.id,
  });
  return context.body(null, 204);
});

export const tradeRoutes = new Hono<AppEnvironment>();

tradeRoutes.post('/', async (context) => {
  const user = context.get('user');
  const input = createTradeGroupSchema.parse(await readJson(context, 128_000));
  if (input.mode === 'live') {
    throw new ApiError(
      503,
      'LIVE_TRADING_RELEASE_GATED',
      'Live trading is disabled until a broker adapter and regulatory release gate are approved.',
    );
  }
  if (!input.portfolioId)
    throw new ApiError(400, 'PORTFOLIO_REQUIRED', 'Paper trades require a paper portfolio.');
  const portfolio = await context.env.DB.prepare(
    `SELECT id FROM paper_portfolios WHERE id = ? AND user_id = ? AND status = 'active'`,
  )
    .bind(input.portfolioId, user.id)
    .first();
  if (!portfolio) throw notFound('Portfolio');
  const quoteAge = Date.now() - new Date(input.quoteAsOf).getTime();
  if (quoteAge < 0 || quoteAge > 5 * 60 * 1000)
    throw new ApiError(
      400,
      'QUOTE_STALE',
      'Paper order quotes must be no more than five minutes old.',
    );
  const id = newId('trg');
  const now = nowIso();
  await context.env.DB.prepare(
    `INSERT INTO trade_groups(id, user_id, portfolio_id, mode, status, symbol, draft_orders_json,
                              quote_as_of, confirmation_expires_at, created_at, updated_at)
     VALUES (?, ?, ?, 'paper', 'draft', ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id,
      user.id,
      input.portfolioId,
      input.symbol,
      canonicalJson(input.orders),
      input.quoteAsOf,
      new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      now,
      now,
    )
    .run();
  await audit(context, {
    action: 'trade_group.created',
    resourceType: 'trade_group',
    resourceId: id,
    actorUserId: user.id,
    metadata: { mode: 'paper', orderCount: input.orders.length },
  });
  return ok(
    context,
    {
      id,
      mode: 'paper',
      status: 'draft',
      confirmationExpiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    },
    201,
  );
});

async function confirmPaper(
  context: Parameters<typeof ok>[0],
  phase: 'entry' | 'exit',
): Promise<Response> {
  const user = context.get('user');
  const idempotencyKey = context.req.header('idempotency-key');
  if (!idempotencyKey || !/^[A-Za-z0-9._:-]{16,128}$/u.test(idempotencyKey))
    throw new ApiError(
      400,
      'IDEMPOTENCY_KEY_REQUIRED',
      'A valid Idempotency-Key header is required.',
    );
  const tradeGroupId = context.req.param('id');
  const scope = `trade.${phase}`;
  const requestHash = await sha256Hex(`${tradeGroupId}:${phase}`);
  const replay = await context.env.DB.prepare(
    `SELECT request_hash, resource_id FROM idempotency_records WHERE user_id = ? AND scope = ? AND idempotency_key = ?`,
  )
    .bind(user.id, scope, idempotencyKey)
    .first<{ request_hash: string; resource_id: string }>();
  if (replay) {
    if (replay.request_hash !== requestHash)
      throw new ApiError(
        409,
        'IDEMPOTENCY_CONFLICT',
        'This idempotency key was used for a different command.',
      );
    return ok(context, { id: replay.resource_id, replayed: true });
  }
  const group = await context.env.DB.prepare(
    `SELECT id, mode, status, draft_orders_json, confirmation_expires_at FROM trade_groups WHERE id = ? AND user_id = ?`,
  )
    .bind(tradeGroupId, user.id)
    .first<{
      id: string;
      mode: 'paper' | 'live';
      status: string;
      draft_orders_json: string;
      confirmation_expires_at: string;
    }>();
  if (!group) throw notFound('Trade group');
  if (group.mode !== 'paper')
    throw new ApiError(503, 'LIVE_TRADING_RELEASE_GATED', 'Live execution is unavailable.');
  const expectedStatus = phase === 'entry' ? 'draft' : 'open';
  if (group.status !== expectedStatus)
    throw new ApiError(
      409,
      'TRADE_STATE_CONFLICT',
      `The trade group must be ${expectedStatus} before ${phase}.`,
    );
  if (phase === 'entry' && group.confirmation_expires_at <= nowIso())
    throw new ApiError(
      409,
      'CONFIRMATION_EXPIRED',
      'The confirmation quote has expired; refresh prices and try again.',
    );
  const draftOrders = parseJson<DraftOrder[]>(group.draft_orders_json);
  const now = nowIso();
  const terminalStatus = phase === 'entry' ? 'open' : 'closed';
  const statements: D1PreparedStatement[] = [];
  for (const draft of draftOrders) {
    const orderId = newId('ord');
    const side = phase === 'entry' ? draft.side : draft.side === 'buy' ? 'sell' : 'buy';
    const executionPrice =
      draft.orderType === 'limit'
        ? (draft.limitPricePaise ?? draft.referencePricePaise)
        : draft.referencePricePaise;
    const order = { ...draft, side, phase };
    statements.push(
      context.env.DB.prepare(
        `INSERT INTO orders(id, trade_group_id, client_order_id, status, request_json, response_json, created_at, updated_at)
         VALUES (?, ?, ?, 'filled', ?, '{"paper":true}', ?, ?)`,
      ).bind(orderId, group.id, `${phase}:${draft.clientOrderId}`, canonicalJson(order), now, now),
      context.env.DB.prepare(
        `INSERT INTO fills(id, order_id, provider_fill_id, quantity, price_paise, fees_paise, filled_at)
         VALUES (?, ?, ?, ?, ?, 0, ?)`,
      ).bind(newId('fil'), orderId, `paper:${orderId}`, draft.quantity, executionPrice, now),
    );
  }
  statements.push(
    context.env.DB.prepare(
      'UPDATE trade_groups SET status = ?, updated_at = ? WHERE id = ? AND user_id = ? AND status = ?',
    ).bind(terminalStatus, now, group.id, user.id, expectedStatus),
    context.env.DB.prepare(
      `INSERT INTO idempotency_records(id, user_id, scope, idempotency_key, request_hash, resource_type, resource_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, 'trade_group', ?, ?, ?)`,
    ).bind(
      newId('idem'),
      user.id,
      scope,
      idempotencyKey,
      requestHash,
      group.id,
      now,
      new Date(Date.now() + 7 * 86_400_000).toISOString(),
    ),
  );
  await context.env.DB.batch(statements);
  await audit(context, {
    action: `paper_trade.${phase}_confirmed`,
    resourceType: 'trade_group',
    resourceId: group.id,
    actorUserId: user.id,
    metadata: { orderCount: draftOrders.length },
  });
  return ok(context, { id: group.id, status: terminalStatus, filledOrders: draftOrders.length });
}

tradeRoutes.post(
  '/:id/confirm-entry',
  rateLimit({ scope: 'trade_entry', limit: 10, windowSeconds: 60, identify: 'user' }),
  (context) => confirmPaper(context, 'entry'),
);
tradeRoutes.post(
  '/:id/confirm-exit',
  rateLimit({ scope: 'trade_exit', limit: 10, windowSeconds: 60, identify: 'user' }),
  (context) => confirmPaper(context, 'exit'),
);

tradeRoutes.get('/:id', async (context) => {
  const user = context.get('user');
  const group = await context.env.DB.prepare(
    `SELECT id, portfolio_id, mode, status, symbol, quote_as_of, confirmation_expires_at, created_at, updated_at
     FROM trade_groups WHERE id = ? AND user_id = ?`,
  )
    .bind(context.req.param('id'), user.id)
    .first();
  if (!group) throw notFound('Trade group');
  const { results } = await context.env.DB.prepare(
    `SELECT o.id, o.client_order_id, o.status, o.request_json, o.created_at,
            f.quantity, f.price_paise, f.fees_paise, f.filled_at
     FROM orders o LEFT JOIN fills f ON f.order_id = o.id WHERE o.trade_group_id = ? ORDER BY o.created_at`,
  )
    .bind(context.req.param('id'))
    .all();
  return ok(context, { ...group, orders: results });
});
