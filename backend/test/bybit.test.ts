import { describe, expect, it, vi } from 'vitest';
import { BybitPublicMarketDataProvider } from '../src/providers/bybit';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Bybit public market-data provider', () => {
  it('maps and sorts public SOL spot candles without credentials', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          time: 1_785_000_000_000,
          result: {
            list: [
              ['1785000300000', '80', '83', '79', '82', '1200', '97000'],
              ['1785000000000', '78', '81', '77', '80', '1000', '79000'],
            ],
          },
        }),
      ),
    );
    const provider = new BybitPublicMarketDataProvider('https://api.bybit.test', request);

    const candles = await provider.getCandles('SOLUSDT', 5);

    expect(candles.map((candle) => candle.close)).toEqual([80, 82]);
    expect(candles[0]?.openInterest).toBe(0);
    expect(request).toHaveBeenCalledWith(
      'https://api.bybit.test/v5/market/kline?category=spot&symbol=SOLUSDT&interval=5&limit=200',
      expect.objectContaining({ headers: { Accept: 'application/json' } }),
    );
  });

  it('maps the public ticker snapshot', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          time: 1_785_000_000_000,
          result: {
            list: [
              {
                symbol: 'SOLUSDT',
                lastPrice: '82.25',
                prevPrice24h: '79.50',
                volume24h: '245000.75',
              },
            ],
          },
        }),
      ),
    );
    const provider = new BybitPublicMarketDataProvider('https://api.bybit.test', request);

    await expect(provider.getQuote('SOLUSDT')).resolves.toMatchObject({
      symbol: 'SOLUSDT',
      lastPrice: 82.25,
      previousClose: 79.5,
      volume: 245_000.75,
    });
  });

  it('falls back to the official alternate public endpoint', async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('blocked', { status: 403 }))
      .mockResolvedValueOnce(
        jsonResponse({
          retCode: 0,
          retMsg: 'OK',
          time: 1_785_000_000_000,
          result: {
            list: [
              {
                symbol: 'SOLUSDT',
                lastPrice: '82.25',
                prevPrice24h: '79.50',
                volume24h: '245000.75',
              },
            ],
          },
        }),
      );
    const provider = new BybitPublicMarketDataProvider(undefined, request);

    await expect(provider.getQuote('SOLUSDT')).resolves.toMatchObject({ lastPrice: 82.25 });
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      'https://api.bybit.com/v5/market/tickers?category=spot&symbol=SOLUSDT',
      'https://api.bytick.com/v5/market/tickers?category=spot&symbol=SOLUSDT',
    ]);
  });
});
