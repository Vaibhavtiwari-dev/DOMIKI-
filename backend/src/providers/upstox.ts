import { z } from 'zod';
import type {
  Candle,
  MarketDataProvider,
  MarketQuote,
  MarketSymbol,
  OptionChainStrike,
  OptionGreeks,
  OptionMarketData,
} from '../domain/market-data.js';
import { MARKET_INSTRUMENTS } from '../domain/market-data.js';
import { ApiError } from '../lib/errors.js';

const candleSchema = z.tuple([
  z.string().datetime({ offset: true }),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
  z.number(),
]);

const candleResponseSchema = z.object({
  status: z.literal('success'),
  data: z.object({ candles: z.array(candleSchema) }),
});

const quoteEntrySchema = z.object({
  last_price: z.number(),
  instrument_token: z.string(),
  ltq: z.number().optional().default(0),
  volume: z.number().optional().default(0),
  cp: z.number().optional().default(0),
});

const quoteResponseSchema = z.object({
  status: z.literal('success'),
  data: z.record(z.string(), quoteEntrySchema),
});

const feedAuthorizeResponseSchema = z.object({
  status: z.literal('success'),
  data: z.object({ authorized_redirect_uri: z.string().url().startsWith('wss://') }),
});

const nullableNumber = z.number().nullable().optional();
const optionSideSchema = z
  .object({
    instrument_key: z.string(),
    market_data: z
      .object({
        ltp: nullableNumber,
        volume: nullableNumber,
        oi: nullableNumber,
        close_price: nullableNumber,
        bid_price: nullableNumber,
        bid_qty: nullableNumber,
        ask_price: nullableNumber,
        ask_qty: nullableNumber,
      })
      .passthrough(),
    option_greeks: z
      .object({
        delta: nullableNumber,
        gamma: nullableNumber,
        theta: nullableNumber,
        vega: nullableNumber,
        iv: nullableNumber,
      })
      .passthrough(),
  })
  .nullable();

const optionChainResponseSchema = z.object({
  status: z.literal('success'),
  data: z.array(
    z.object({
      expiry: z.string(),
      pcr: nullableNumber,
      strike_price: z.number(),
      underlying_spot_price: z.number(),
      call_options: optionSideSchema.optional(),
      put_options: optionSideSchema.optional(),
    }),
  ),
});

function numberOrZero(value: number | null | undefined): number {
  return value ?? 0;
}

function mapCandles(response: z.infer<typeof candleResponseSchema>): Candle[] {
  return response.data.candles
    .map(([timestamp, open, high, low, close, volume, openInterest]) => ({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
      openInterest,
    }))
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function mapMarketData(
  value: z.infer<typeof optionSideSchema>,
): { instrumentKey: string; market: OptionMarketData; greeks: OptionGreeks } | null {
  if (!value) return null;
  return {
    instrumentKey: value.instrument_key,
    market: {
      ltp: numberOrZero(value.market_data.ltp),
      volume: numberOrZero(value.market_data.volume),
      openInterest: numberOrZero(value.market_data.oi),
      closePrice: numberOrZero(value.market_data.close_price),
      bidPrice: numberOrZero(value.market_data.bid_price),
      bidQuantity: numberOrZero(value.market_data.bid_qty),
      askPrice: numberOrZero(value.market_data.ask_price),
      askQuantity: numberOrZero(value.market_data.ask_qty),
    },
    greeks: {
      delta: numberOrZero(value.option_greeks.delta),
      gamma: numberOrZero(value.option_greeks.gamma),
      theta: numberOrZero(value.option_greeks.theta),
      vega: numberOrZero(value.option_greeks.vega),
      impliedVolatility: numberOrZero(value.option_greeks.iv),
    },
  };
}

export class UpstoxMarketDataProvider implements MarketDataProvider {
  readonly id = 'upstox';

  constructor(
    private readonly token: string,
    private readonly baseUrl = 'https://api.upstox.com',
    private readonly request: typeof fetch = fetch,
  ) {
    if (!token)
      throw new ApiError(
        503,
        'MARKET_DATA_TOKEN_REQUIRED',
        'The Upstox Analytics Token is not configured.',
      );
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new ApiError(
        500,
        'MARKET_DATA_PROVIDER_MISCONFIGURED',
        'The market-data provider URL must use HTTPS.',
      );
    }
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      response = await this.request.call(globalThis, `${this.baseUrl}${path}`, {
        headers: { Accept: 'application/json', Authorization: `Bearer ${this.token}` },
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        503,
        'MARKET_DATA_PROVIDER_UNAVAILABLE',
        'The live market-data provider is unavailable.',
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        503,
        'MARKET_DATA_TOKEN_INVALID',
        'The Upstox Analytics Token is invalid or expired.',
      );
    }
    if (!response.ok) {
      throw new ApiError(
        502,
        'MARKET_DATA_PROVIDER_ERROR',
        'The live market-data provider rejected the request.',
        response.status >= 500,
        { providerStatus: response.status },
      );
    }
    return response.json();
  }

  async getQuote(symbol: MarketSymbol): Promise<MarketQuote> {
    const instrumentKey = MARKET_INSTRUMENTS[symbol];
    const query = new URLSearchParams({ instrument_key: instrumentKey });
    const parsed = quoteResponseSchema.parse(
      await this.get(`/v3/market-quote/ltp?${query.toString()}`),
    );
    const quote = Object.values(parsed.data)[0];
    if (!quote)
      throw new ApiError(
        502,
        'MARKET_QUOTE_EMPTY',
        'The provider returned no quote for this instrument.',
      );
    return {
      instrumentKey: quote.instrument_token,
      symbol,
      lastPrice: quote.last_price,
      previousClose: quote.cp,
      lastTradedQuantity: quote.ltq,
      volume: quote.volume,
      asOf: new Date().toISOString(),
    };
  }

  async getMarketDataFeedAuthorizeUrl(): Promise<string> {
    const parsed = feedAuthorizeResponseSchema.parse(
      await this.get('/v3/feed/market-data-feed/authorize'),
    );
    return parsed.data.authorized_redirect_uri;
  }

  async getIntradayCandles(symbol: MarketSymbol, intervalMinutes: number): Promise<Candle[]> {
    const instrumentKey = encodeURIComponent(MARKET_INSTRUMENTS[symbol]);
    const parsed = candleResponseSchema.parse(
      await this.get(`/v3/historical-candle/intraday/${instrumentKey}/minutes/${intervalMinutes}`),
    );
    return mapCandles(parsed);
  }

  async getHistoricalCandles(
    symbol: MarketSymbol,
    intervalMinutes: number,
    from: string,
    to: string,
  ): Promise<Candle[]> {
    const instrumentKey = encodeURIComponent(MARKET_INSTRUMENTS[symbol]);
    const parsed = candleResponseSchema.parse(
      await this.get(
        `/v3/historical-candle/${instrumentKey}/minutes/${intervalMinutes}/${to}/${from}`,
      ),
    );
    return mapCandles(parsed);
  }

  async getOptionChain(symbol: MarketSymbol, expiryDate: string): Promise<OptionChainStrike[]> {
    const query = new URLSearchParams({
      instrument_key: MARKET_INSTRUMENTS[symbol],
      expiry_date: expiryDate,
    });
    const parsed = optionChainResponseSchema.parse(
      await this.get(`/v2/option/chain?${query.toString()}`),
    );
    return parsed.data.map((strike) => ({
      expiry: strike.expiry,
      strikePrice: strike.strike_price,
      underlyingSpotPrice: strike.underlying_spot_price,
      pcr: strike.pcr ?? null,
      call: mapMarketData(strike.call_options ?? null),
      put: mapMarketData(strike.put_options ?? null),
    }));
  }
}
