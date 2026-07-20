import { z } from 'zod';
import type { Candle } from '../domain/market-data.js';
import { ApiError } from '../lib/errors.js';

const numericString = z.coerce.number().finite();
const klineSchema = z.tuple([
  numericString,
  numericString,
  numericString,
  numericString,
  numericString,
  numericString,
  numericString,
]);

const klineResponseSchema = z.object({
  retCode: z.number(),
  retMsg: z.string(),
  time: z.number(),
  result: z.object({ list: z.array(klineSchema) }),
});

const tickerResponseSchema = z.object({
  retCode: z.number(),
  retMsg: z.string(),
  time: z.number(),
  result: z.object({
    list: z.array(
      z.object({
        symbol: z.string(),
        lastPrice: numericString,
        prevPrice24h: numericString,
        volume24h: numericString,
      }),
    ),
  }),
});

export interface CryptoQuote {
  symbol: string;
  lastPrice: number;
  previousClose: number;
  volume: number;
  asOf: string;
}

export class BybitPublicMarketDataProvider {
  readonly id = 'bybit-public';

  constructor(
    private readonly baseUrl = 'https://api.bybit.com',
    private readonly request: typeof fetch = fetch,
  ) {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' && url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      throw new ApiError(
        500,
        'CRYPTO_PROVIDER_MISCONFIGURED',
        'The crypto market-data provider URL must use HTTPS.',
      );
    }
  }

  private async get(path: string): Promise<unknown> {
    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      response = await this.request.call(globalThis, `${this.baseUrl}${path}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch {
      throw new ApiError(
        503,
        'CRYPTO_PROVIDER_UNAVAILABLE',
        'The public crypto market-data provider is unavailable.',
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new ApiError(
        502,
        'CRYPTO_PROVIDER_ERROR',
        'The public crypto market-data provider rejected the request.',
        response.status >= 500,
        { providerStatus: response.status },
      );
    }
    return response.json();
  }

  async getCandles(symbol: 'SOLUSDT', intervalMinutes: number): Promise<Candle[]> {
    const query = new URLSearchParams({
      category: 'spot',
      symbol,
      interval: String(intervalMinutes),
      limit: '200',
    });
    const parsed = klineResponseSchema.parse(
      await this.get(`/v5/market/kline?${query.toString()}`),
    );
    if (parsed.retCode !== 0) {
      throw new ApiError(502, 'CRYPTO_PROVIDER_ERROR', 'The crypto candle request failed.');
    }
    return parsed.result.list
      .map(([timestamp, open, high, low, close, volume]) => ({
        timestamp: new Date(timestamp).toISOString(),
        open,
        high,
        low,
        close,
        volume,
        openInterest: 0,
      }))
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  }

  async getQuote(symbol: 'SOLUSDT'): Promise<CryptoQuote> {
    const query = new URLSearchParams({ category: 'spot', symbol });
    const parsed = tickerResponseSchema.parse(
      await this.get(`/v5/market/tickers?${query.toString()}`),
    );
    if (parsed.retCode !== 0) {
      throw new ApiError(502, 'CRYPTO_PROVIDER_ERROR', 'The crypto ticker request failed.');
    }
    const quote = parsed.result.list[0];
    if (!quote) {
      throw new ApiError(502, 'CRYPTO_QUOTE_EMPTY', 'The provider returned no crypto quote.');
    }
    return {
      symbol: quote.symbol,
      lastPrice: quote.lastPrice,
      previousClose: quote.prevPrice24h,
      volume: quote.volume24h,
      asOf: new Date(parsed.time).toISOString(),
    };
  }
}
