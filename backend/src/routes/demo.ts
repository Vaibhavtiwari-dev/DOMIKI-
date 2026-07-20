import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnvironment } from '../types.js';
import { strategyConfigurationSchema } from '../domain/strategy-schema.js';
import { demoStrategy, runSyntheticDemo } from '../domain/demo-engine.js';
import { readJson, ok } from '../lib/http.js';
import { createMarketDataProvider } from '../providers/factory.js';
import { BybitPublicMarketDataProvider } from '../providers/bybit.js';
import { BinancePublicMarketDataProvider } from '../providers/binance.js';
import { UpstoxMarketDataProvider } from '../providers/upstox.js';
import { calculateIndicators, DEFAULT_INDICATOR_PARAMETERS } from '../services/indicators.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { generateModeledMarketAnalysis } from '../services/modeled-market.js';
import { MARKET_INSTRUMENTS } from '../domain/market-data.js';

const demoRunSchema = z.object({ configuration: strategyConfigurationSchema }).strict();
const marketSymbolSchema = z.enum([
  'NIFTY',
  'BANKNIFTY',
  'FINNIFTY',
  'MIDCPNIFTY',
  'INDIAVIX',
  'SENSEX',
  'BANKEX',
]);
const historicalQuerySchema = z
  .object({
    symbol: marketSymbolSchema.default('NIFTY'),
    interval: z.coerce.number().int().min(1).max(300).default(5),
    from: z.string().date().optional(),
    to: z.string().date().optional(),
  })
  .refine(
    (value) => (value.from === undefined) === (value.to === undefined),
    'from and to must be supplied together.',
  )
  .refine(
    (value) => !value.from || !value.to || value.from <= value.to,
    'from must not be after to.',
  );

export const demoRoutes = new Hono<AppEnvironment>();

demoRoutes.get('/', (context) =>
  ok(context, {
    name: 'Project Dokimi API',
    mode: 'showcase_mvp',
    capabilities: [
      'versioned_strategy_schema',
      'deterministic_synthetic_backtest',
      'run_reproducibility_manifest',
      'paper_portfolio_and_orders',
      'dataset_manifest_boundary',
    ],
    deferred: ['licensed_market_data', 'live_broker_execution', 'payments'],
  }),
);

demoRoutes.get('/strategy', (context) => ok(context, demoStrategy));

demoRoutes.post('/backtest', async (context) => {
  const input = demoRunSchema.parse(await readJson(context, 256_000));
  return ok(context, await runSyntheticDemo(input.configuration));
});

demoRoutes.get('/market/status', (context) =>
  ok(context, {
    provider: 'upstox',
    configured: Boolean(context.env.UPSTOX_ANALYTICS_TOKEN),
    accessMode: 'read_only_analytics_token',
    source: 'exchange-backed broker feed',
    instruments: marketSymbolSchema.options,
    capabilities: [
      'live_quote',
      'websocket_stream',
      'intraday_candles',
      'historical_candles',
      'option_chain',
      'greeks',
    ],
    indicators: ['SMA', 'EMA', 'RSI', 'MACD', 'Bollinger Bands', 'ATR', 'VWAP', 'Supertrend'],
  }),
);

demoRoutes.get(
  '/market/stream-url',
  rateLimit({ scope: 'demo_market_stream_url', limit: 10, windowSeconds: 60 }),
  async (context) => {
    const input = z.object({ symbol: marketSymbolSchema }).parse(context.req.query());
    const provider = new UpstoxMarketDataProvider(
      context.env.UPSTOX_ANALYTICS_TOKEN ?? '',
      context.env.UPSTOX_API_BASE_URL ?? 'https://api.upstox.com',
    );
    return ok(context, {
      url: await provider.getMarketDataFeedAuthorizeUrl(),
      instrumentKey: MARKET_INSTRUMENTS[input.symbol],
    });
  },
);

demoRoutes.get(
  '/crypto/analysis',
  rateLimit({ scope: 'demo_crypto_analysis', limit: 30, windowSeconds: 60 }),
  async (context) => {
    const query = z
      .object({
        symbol: z.literal('SOLUSDT').default('SOLUSDT'),
        interval: z.coerce
          .number()
          .int()
          .refine((value) => [1, 3, 5, 15, 30].includes(value)),
      })
      .parse(context.req.query());
    const providers = [new BybitPublicMarketDataProvider(), new BinancePublicMarketDataProvider()];
    let lastError: unknown;
    for (const provider of providers) {
      try {
        const [quote, candles] = await Promise.all([
          provider.getQuote(query.symbol),
          provider.getCandles(query.symbol, query.interval),
        ]);
        const indicators = calculateIndicators(candles);
        return ok(context, {
          provider: provider.id,
          source: 'live',
          market: 'crypto_spot',
          symbol: query.symbol,
          intervalMinutes: query.interval,
          quote,
          candles,
          indicators,
          latest: indicators.at(-1) ?? null,
          freshness: {
            quoteReceivedAt: quote.asOf,
            latestCandleAt: candles.at(-1)?.timestamp ?? null,
          },
          parameters: DEFAULT_INDICATOR_PARAMETERS,
        });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  },
);

demoRoutes.get(
  '/market/analysis',
  rateLimit({ scope: 'demo_market_analysis', limit: 30, windowSeconds: 60 }),
  async (context) => {
    const query = historicalQuerySchema.parse(context.req.query());
    const provider = createMarketDataProvider(context.env);
    const [quote, candles] = await Promise.all([
      provider.getQuote(query.symbol),
      query.from && query.to
        ? provider.getHistoricalCandles(query.symbol, query.interval, query.from, query.to)
        : provider.getIntradayCandles(query.symbol, query.interval),
    ]);
    const indicators = calculateIndicators(candles);
    return ok(context, {
      provider: provider.id,
      source: 'live',
      symbol: query.symbol,
      intervalMinutes: query.interval,
      quote,
      candles,
      indicators,
      latest: indicators.at(-1) ?? null,
      freshness: {
        quoteReceivedAt: quote.asOf,
        latestCandleAt: candles.at(-1)?.timestamp ?? null,
      },
      parameters: DEFAULT_INDICATOR_PARAMETERS,
    });
  },
);

demoRoutes.get(
  '/market/modeled-analysis',
  rateLimit({ scope: 'demo_modeled_market_analysis', limit: 60, windowSeconds: 60 }),
  (context) => {
    const query = z
      .object({
        symbol: marketSymbolSchema.default('NIFTY'),
        interval: z.coerce
          .number()
          .int()
          .refine((value) => [1, 3, 5, 15, 30].includes(value)),
      })
      .parse(context.req.query());
    return ok(context, generateModeledMarketAnalysis(query.symbol, query.interval));
  },
);

demoRoutes.get(
  '/market/option-chain',
  rateLimit({ scope: 'demo_option_chain', limit: 20, windowSeconds: 60 }),
  async (context) => {
    const input = z
      .object({ symbol: marketSymbolSchema.default('NIFTY'), expiry: z.string().date() })
      .parse(context.req.query());
    const provider = createMarketDataProvider(context.env);
    return ok(context, {
      provider: provider.id,
      source: 'live',
      symbol: input.symbol,
      expiry: input.expiry,
      receivedAt: new Date().toISOString(),
      strikes: await provider.getOptionChain(input.symbol, input.expiry),
    });
  },
);
