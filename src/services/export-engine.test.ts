import { describe, expect, it } from 'vitest';
import { resultCsv } from './export-engine';
import type { ResearchResult } from './option-engine';

describe('research exports', () => {
  it('neutralizes spreadsheet formulas', () => {
    const result = {
      trades: [{ id: 'x', date: '=1+1', expiry: '2026-01-01', strike: 1, quantity: 1, callEntry: 1, callExit: 1, putEntry: 1, putExit: 1, grossPnl: 0, costs: 0, netPnl: 0, exitReason: '@cmd', entryTime: '', exitTime: '' }],
    } as ResearchResult;
    const csv = resultCsv(result);
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'@cmd");
  });
});
