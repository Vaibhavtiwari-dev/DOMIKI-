import { describe, expect, it, vi } from 'vitest';
import { UpstoxMarketDataProvider } from '../src/providers/upstox';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('Upstox market-data provider', () => {
  it('authenticates quote requests and maps provider fields', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          status: 'success',
          data: {
            'NSE_INDEX:Nifty 50': {
              last_price: 25_125.4,
              instrument_token: 'NSE_INDEX|Nifty 50',
              ltq: 12,
              volume: 4_500,
              cp: 25_000,
            },
          },
        }),
      ),
    );
    const provider = new UpstoxMarketDataProvider(
      'analytics-token',
      'https://api.upstox.test',
      request,
    );

    await expect(provider.getQuote('NIFTY')).resolves.toMatchObject({
      symbol: 'NIFTY',
      lastPrice: 25_125.4,
      previousClose: 25_000,
    });
    expect(request).toHaveBeenCalledOnce();
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe(
      'https://api.upstox.test/v3/market-quote/ltp?instrument_key=NSE_INDEX%7CNifty+50',
    );
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer analytics-token');
  });

  it('sorts reverse-chronological candle data for indicator calculations', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          status: 'success',
          data: {
            candles: [
              ['2026-07-20T09:20:00+05:30', 101, 104, 100, 103, 1_100, 5_100],
              ['2026-07-20T09:15:00+05:30', 100, 103, 99, 101, 1_000, 5_000],
            ],
          },
        }),
      ),
    );
    const provider = new UpstoxMarketDataProvider(
      'analytics-token',
      'https://api.upstox.test',
      request,
    );

    const candles = await provider.getIntradayCandles('NIFTY', 5);

    expect(candles.map((candle) => candle.timestamp)).toEqual([
      '2026-07-20T09:15:00+05:30',
      '2026-07-20T09:20:00+05:30',
    ]);
    expect(candles[1]).toMatchObject({ close: 103, openInterest: 5_100 });
  });

  it('returns a one-time V3 WebSocket URL without exposing the analytics token', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        jsonResponse({
          status: 'success',
          data: { authorized_redirect_uri: 'wss://feed.upstox.test/feeds?code=single-use' },
        }),
      ),
    );
    const provider = new UpstoxMarketDataProvider(
      'analytics-token',
      'https://api.upstox.test',
      request,
    );

    await expect(provider.getMarketDataFeedAuthorizeUrl()).resolves.toBe(
      'wss://feed.upstox.test/feeds?code=single-use',
    );
    const [url, init] = request.mock.calls[0] ?? [];
    expect(url).toBe('https://api.upstox.test/v3/feed/market-data-feed/authorize');
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer analytics-token');
  });

  it('does not expose upstream authorization failures', async () => {
    const request = vi.fn<typeof fetch>(() =>
      Promise.resolve(jsonResponse({ developer_message: 'secret' }, 401)),
    );
    const provider = new UpstoxMarketDataProvider(
      'expired-token',
      'https://api.upstox.test',
      request,
    );

    await expect(provider.getQuote('NIFTY')).rejects.toMatchObject({
      status: 503,
      code: 'MARKET_DATA_TOKEN_INVALID',
      message: 'The Upstox Analytics Token is invalid or expired.',
    });
  });
});
