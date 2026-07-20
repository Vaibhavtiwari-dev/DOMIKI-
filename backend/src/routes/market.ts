import { Hono } from 'hono';
import type { AppEnvironment } from '../types';
import { ApiError } from '../lib/errors';
import { ok } from '../lib/http';
import { createMarketDataProvider } from '../providers/factory';
import { MARKET_INSTRUMENTS, type MarketSymbol } from '../domain/market-data';
import { calculateIndicators, DEFAULT_INDICATOR_PARAMETERS } from '../services/indicators';

export const marketRoutes = new Hono<AppEnvironment>();

function supportedSymbol(value: string | undefined): value is MarketSymbol {
  return value !== undefined && value in MARKET_INSTRUMENTS;
}

marketRoutes.get('/status', (context) =>
  ok(context, {
    provider: 'upstox',
    state: context.env.UPSTOX_ANALYTICS_TOKEN ? 'connected' : 'configuration_required',
    marketTimezone: 'Asia/Kolkata',
    instruments: Object.keys(MARKET_INSTRUMENTS),
    readOnly: true,
  }),
);

marketRoutes.get('/option-chain', async (context) => {
  const symbol = context.req.query('symbol');
  const expiry = context.req.query('expiry');
  if (!supportedSymbol(symbol) || !expiry || !/^\d{4}-\d{2}-\d{2}$/u.test(expiry)) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'A supported symbol and YYYY-MM-DD expiry are required.',
    );
  }
  const provider = createMarketDataProvider(context.env);
  return ok(context, {
    provider: provider.id,
    strikes: await provider.getOptionChain(symbol, expiry),
  });
});

marketRoutes.get('/quotes', async (context) => {
  const symbol = context.req.query('symbol');
  if (!supportedSymbol(symbol)) {
    throw new ApiError(400, 'VALIDATION_FAILED', 'A supported symbol is required.');
  }
  const provider = createMarketDataProvider(context.env);
  return ok(context, await provider.getQuote(symbol));
});

marketRoutes.get('/analysis', async (context) => {
  const symbol = context.req.query('symbol');
  const interval = Number(context.req.query('interval') ?? '5');
  if (!supportedSymbol(symbol) || !Number.isInteger(interval) || interval < 1 || interval > 300) {
    throw new ApiError(
      400,
      'VALIDATION_FAILED',
      'A supported symbol and interval from 1 to 300 are required.',
    );
  }
  const provider = createMarketDataProvider(context.env);
  const candles = await provider.getIntradayCandles(symbol, interval);
  return ok(context, {
    provider: provider.id,
    symbol,
    intervalMinutes: interval,
    candles,
    indicators: calculateIndicators(candles),
    parameters: DEFAULT_INDICATOR_PARAMETERS,
  });
});
