import { describe, expect, it } from 'vitest';
import { generateModeledMarketAnalysis } from '../src/services/modeled-market';

describe('modeled market analysis', () => {
  it('is stable within an interval and produces valid aligned candles', () => {
    const now = Date.parse('2026-07-20T10:17:12.000Z');
    const first = generateModeledMarketAnalysis('NIFTY', 5, now);
    const second = generateModeledMarketAnalysis('NIFTY', 5, now + 30_000);

    expect(first).toEqual(second);
    expect(first.candles).toHaveLength(200);
    expect(first.indicators).toHaveLength(200);
    expect(
      first.candles.every(
        (candle) =>
          candle.high >= Math.max(candle.open, candle.close) &&
          candle.low <= Math.min(candle.open, candle.close),
      ),
    ).toBe(true);
  });

  it('changes price scale and timeline for instrument and interval selections', () => {
    const now = Date.parse('2026-07-20T10:17:12.000Z');
    const nifty = generateModeledMarketAnalysis('NIFTY', 5, now);
    const bankNifty = generateModeledMarketAnalysis('BANKNIFTY', 5, now);
    const hourly = generateModeledMarketAnalysis('NIFTY', 30, now);

    expect(bankNifty.quote.lastPrice).toBeGreaterThan(nifty.quote.lastPrice * 1.8);
    expect(hourly.candles[1]?.timestamp).not.toBe(nifty.candles[1]?.timestamp);
    expect(hourly.intervalMinutes).toBe(30);
  });
});
