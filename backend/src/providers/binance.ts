import { z } from 'zod';
import type { Candle } from '../domain/market-data.js';
import { ApiError } from '../lib/errors.js';
import type { CryptoQuote } from './bybit.js';
import { parseProviderJson } from '../lib/provider-response.js';

const numberFromString = z.coerce.number().finite();
const klineSchema = z
  .tuple([
    z.number(),
    numberFromString,
    numberFromString,
    numberFromString,
    numberFromString,
    numberFromString,
  ])
  .rest(z.unknown());
const tickerSchema = z.object({
  symbol: z.string(),
  lastPrice: numberFromString,
  prevClosePrice: numberFromString,
  volume: numberFromString,
  closeTime: z.number(),
});

export class BinancePublicMarketDataProvider {
  readonly id = 'binance-public';

  constructor(
    private readonly baseUrls = ['https://api.binance.com', 'https://api.binance.us'],
    private readonly request: typeof fetch = fetch,
  ) {}

  private async get(path: string): Promise<Response> {
    let rejectedStatus: number | undefined;
    for (const baseUrl of this.baseUrls) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await this.request.call(globalThis, `${baseUrl}${path}`, {
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        });
        if (response.ok) return response;
        rejectedStatus = response.status;
      } catch {
        // Try the next official public endpoint.
      } finally {
        clearTimeout(timeout);
      }
    }
    if (rejectedStatus === undefined) {
      throw new ApiError(
        503,
        'CRYPTO_PROVIDER_UNAVAILABLE',
        'The backup crypto market-data provider is unavailable.',
        true,
      );
    }
    throw new ApiError(
      502,
      'CRYPTO_PROVIDER_ERROR',
      'The backup crypto market-data provider rejected the request.',
      rejectedStatus >= 500,
      { providerStatus: rejectedStatus },
    );
  }

  async getCandles(symbol: 'SOLUSDT', intervalMinutes: number): Promise<Candle[]> {
    const query = new URLSearchParams({
      symbol,
      interval: `${intervalMinutes}m`,
      limit: '200',
    });
    return (
      await parseProviderJson(
        await this.get(`/api/v3/klines?${query.toString()}`),
        z.array(klineSchema),
        4_000_000,
      )
    ).map(([timestamp, open, high, low, close, volume]) => ({
      timestamp: new Date(timestamp).toISOString(),
      open,
      high,
      low,
      close,
      volume,
      openInterest: 0,
    }));
  }

  async getQuote(symbol: 'SOLUSDT'): Promise<CryptoQuote> {
    const query = new URLSearchParams({ symbol });
    const quote = await parseProviderJson(
      await this.get(`/api/v3/ticker/24hr?${query.toString()}`),
      tickerSchema,
    );
    return {
      symbol: quote.symbol,
      lastPrice: quote.lastPrice,
      previousClose: quote.prevClosePrice,
      volume: quote.volume,
      asOf: new Date(quote.closeTime).toISOString(),
    };
  }
}
