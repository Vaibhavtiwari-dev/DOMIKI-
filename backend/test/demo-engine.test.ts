import { describe, expect, it } from 'vitest';
import { demoStrategy, runSyntheticDemo } from '../src/domain/demo-engine';

describe('synthetic demo engine', () => {
  it('is deterministic for the same strategy configuration', async () => {
    const first = await runSyntheticDemo(demoStrategy);
    const second = await runSyntheticDemo(demoStrategy);

    expect(first.summary).toEqual(second.summary);
    expect(first.trades).toEqual(second.trades);
    expect(first.equityCurve).toEqual(second.equityCurve);
    expect(first.marketCandles).toEqual(second.marketCandles);
    expect(first.indicators).toEqual(second.indicators);
    expect(first.manifest.strategyConfigurationHash).toBe(
      second.manifest.strategyConfigurationHash,
    );
  });

  it('reconciles trade, summary, and equity totals', async () => {
    const result = await runSyntheticDemo(demoStrategy);
    const netFromTrades = result.trades.reduce((sum, trade) => sum + trade.netPnl, 0);
    const endingEquity = result.equityCurve.at(-1)?.equity;

    expect(result.demo).toBe(true);
    expect(result.synthetic).toBe(true);
    expect(result.summary.netPnl).toBeCloseTo(netFromTrades, 2);
    expect(result.summary.tradeCount).toBe(result.trades.length);
    expect(result.summary.winningTrades + result.summary.losingTrades).toBeLessThanOrEqual(
      result.summary.tradeCount,
    );
    expect(endingEquity).toBe(result.summary.endingCapital);
    expect(result.marketCandles).toHaveLength(result.trades.length);
    expect(result.indicators).toHaveLength(result.marketCandles.length);
    expect(
      result.marketCandles.every(
        (candle) =>
          candle.high >= Math.max(candle.open, candle.close) &&
          candle.low <= Math.min(candle.open, candle.close),
      ),
    ).toBe(true);
    expect(result.warnings).toContain(
      'Illustrative synthetic data only. This result is not based on exchange market data.',
    );
  });
});
