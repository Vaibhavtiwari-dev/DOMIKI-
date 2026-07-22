import { describe, expect, it, vi } from 'vitest';
import type { MarketDataProvider } from '../src/domain/market-data';
import { loadRecentCandles } from '../src/services/market-history';

const candle = (timestamp: string) => ({
  timestamp,
  open: 1,
  high: 2,
  low: 0.5,
  close: 1.5,
  volume: 10,
  openInterest: 0,
});

describe('recent market history', () => {
  it('falls back to historical candles when the market is closed', async () => {
    const historicalMock = vi
      .fn()
      .mockResolvedValue([
        candle('2026-07-22T10:00:00+05:30'),
        candle('2026-07-22T10:05:00+05:30'),
      ]);
    const provider = {
      getIntradayCandles: vi.fn().mockResolvedValue([]),
      getHistoricalCandles: historicalMock,
    } as unknown as MarketDataProvider;
    const result = await loadRecentCandles(provider, 'NIFTY', 5, new Date('2026-07-23T00:00:00Z'));
    expect(result).toHaveLength(2);
    expect(historicalMock).toHaveBeenCalled();
  });
});
