import { describe, expect, it } from 'vitest';
import type { Candle } from '../src/domain/market-data';
import {
  calculateIndicators,
  exponentialMovingAverage,
  relativeStrengthIndex,
  simpleMovingAverage,
  trueRange,
} from '../src/services/indicators';

function fixtureCandles(count: number): Candle[] {
  return Array.from({ length: count }, (_, index) => {
    const close = 20_000 + index * 8 + Math.sin(index / 3) * 20;
    const date = index < count / 2 ? '2026-07-17' : '2026-07-20';
    const minute = index % 60;
    return {
      timestamp: `${date}T10:${String(minute).padStart(2, '0')}:00+05:30`,
      open: close - 4,
      high: close + 12,
      low: close - 14,
      close,
      volume: 1_000 + index * 10,
      openInterest: 50_000 + index * 100,
    };
  });
}

describe('technical indicators', () => {
  it('calculates aligned SMA and EMA values', () => {
    expect(simpleMovingAverage([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
    expect(exponentialMovingAverage([1, 2, 3, 4], 3)).toEqual([null, null, 2, 3]);
  });

  it('returns RSI 100 for a strictly rising market', () => {
    const values = Array.from({ length: 20 }, (_, index) => index + 1);
    const rsi = relativeStrengthIndex(values, 14);
    expect(rsi[13]).toBeNull();
    expect(rsi[14]).toBe(100);
    expect(rsi.at(-1)).toBe(100);
  });

  it('uses gaps when calculating true range', () => {
    const candles = fixtureCandles(2);
    const second = candles[1];
    const first = candles[0];
    if (!first || !second) throw new Error('Fixture must contain two candles.');
    second.low = first.close + 20;
    second.high = first.close + 40;
    second.close = first.close + 30;
    expect(trueRange(candles)[1]).toBe(40);
  });

  it('emits every backtesting indicator on the original candle timeline', () => {
    const candles = fixtureCandles(80);
    const output = calculateIndicators(candles);
    const latest = output.at(-1);

    expect(output).toHaveLength(candles.length);
    expect(output.map((point) => point.timestamp)).toEqual(
      candles.map((candle) => candle.timestamp),
    );
    expect(latest).toBeDefined();
    expect(latest?.sma).not.toBeNull();
    expect(latest?.ema).not.toBeNull();
    expect(latest?.rsi).not.toBeNull();
    expect(latest?.macd).not.toBeNull();
    expect(latest?.macdSignal).not.toBeNull();
    expect(latest?.bollingerUpper).not.toBeNull();
    expect(latest?.atr).not.toBeNull();
    expect(latest?.vwap).not.toBeNull();
    expect(latest?.supertrend).not.toBeNull();
    expect(latest?.supertrendDirection).toMatch(/bullish|bearish/u);
    expect(
      output.every((point) =>
        Object.values(point).every((value) => typeof value !== 'number' || Number.isFinite(value)),
      ),
    ).toBe(true);
  });
});
