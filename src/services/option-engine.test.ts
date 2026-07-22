import { describe, expect, it } from 'vitest';
import { createSampleOptionDataset, parseOptionCsv, runOptionBacktest, type ResearchConfiguration } from './option-engine';

const configuration: ResearchConfiguration = {
  symbol: 'NIFTY', entryTime: '09:30', exitTime: '15:15', lots: 1, lotSize: 50,
  strikeStep: 50, stopLossPercent: 30, targetPercent: 50, slippageBps: 5,
  feePerOrder: 20, startingCapital: 500_000,
};

describe('browser option research engine', () => {
  it('produces reconciled deterministic results for the sample fixture', async () => {
    const rows = createSampleOptionDataset();
    const first = await runOptionBacktest(rows, configuration);
    const second = await runOptionBacktest(rows, configuration);
    expect(first.summary.netPnl).toBe(second.summary.netPnl);
    expect(first.summary.netPnl).toBeCloseTo(first.trades.reduce((sum, trade) => sum + trade.netPnl, 0), 2);
    expect(first.equityCurve.at(-1)?.equity).toBeCloseTo(configuration.startingCapital + first.summary.netPnl, 2);
    expect(first.manifest.datasetHash).toBe(second.manifest.datasetHash);
  });

  it('rejects invalid OHLC imports', () => {
    const csv = 'timestamp,symbol,expiry,strike,optionType,underlying,open,high,low,close,volume,openInterest\n2026-06-01T04:00:00Z,NIFTY,2026-06-25,24500,CE,24500,100,90,95,98,1,1';
    expect(() => parseOptionCsv(csv)).toThrow(/OHLC/u);
  });
});
