import type { StrategyConfiguration } from './strategy-schema.js';
import type { Candle } from './market-data.js';
import { canonicalJson, sha256Hex } from '../lib/crypto.js';
import { calculateIndicators } from '../services/indicators.js';

interface DemoTrade {
  id: string;
  date: string;
  entryTime: string;
  exitTime: string;
  grossPnl: number;
  costs: number;
  netPnl: number;
  exitReason: 'scheduled_exit' | 'leg_stop_loss' | 'strategy_target';
}

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function tradingDates(from: string, to: string, maximum: number): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  while (cursor <= end && dates.length < maximum) {
    const day = cursor.getUTCDay();
    if (day >= 1 && day <= 5) dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function maximumDrawdown(equity: number[]): { amount: number; percent: number } {
  let peak = equity[0] ?? 0;
  let maximum = 0;
  for (const value of equity) {
    peak = Math.max(peak, value);
    maximum = Math.max(maximum, peak - value);
  }
  return { amount: round(maximum), percent: peak > 0 ? round((maximum / peak) * 100) : 0 };
}

function modeledMarketCandles(dates: string[], seed: number): Candle[] {
  const random = mulberry32(seed);
  let previousClose = 23_650;
  return dates.map((date) => {
    const open = previousClose + (random() - 0.5) * 110;
    const close = open + (random() + random() - 1) * 185;
    const high = Math.max(open, close) + 18 + random() * 95;
    const low = Math.min(open, close) - 18 - random() * 95;
    previousClose = close;
    return {
      timestamp: `${date}T15:30:00+05:30`,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: Math.round(180_000_000 + random() * 120_000_000),
      openInterest: 0,
    };
  });
}

export async function runSyntheticDemo(configuration: StrategyConfiguration) {
  const configurationJson = canonicalJson(configuration);
  const configurationHash = await sha256Hex(configurationJson);
  const random = mulberry32(Number.parseInt(configurationHash.slice(0, 8), 16));
  const dates = tradingDates(configuration.dateRange.from, configuration.dateRange.to, 120);
  const capital = 500_000;
  const trades: DemoTrade[] = [];
  let cumulative = capital;
  const equityCurve = [{ date: configuration.dateRange.from, equity: capital, dailyPnl: 0 }];

  for (const [index, date] of dates.entries()) {
    const directionalBias = configuration.legs.reduce(
      (total, leg) => total + (leg.side === 'sell' ? 1 : -0.65),
      0,
    );
    const noise = (random() + random() + random() - 1.5) * 4_500;
    const shock = random() < 0.08 ? -random() * 12_000 : 0;
    const grossPnl = round(directionalBias * 650 + noise + shock);
    const costs = round(configuration.legs.length * (35 + random() * 25));
    const netPnl = round(grossPnl - costs);
    cumulative = round(cumulative + netPnl);
    const exitReason =
      shock < -2_000 ? 'leg_stop_loss' : grossPnl > 3_500 ? 'strategy_target' : 'scheduled_exit';
    trades.push({
      id: `demo_trade_${String(index + 1).padStart(3, '0')}`,
      date,
      entryTime: configuration.entry.type === 'fixed_time' ? configuration.entry.time : '09:30',
      exitTime: configuration.exit.time,
      grossPnl,
      costs,
      netPnl,
      exitReason,
    });
    equityCurve.push({ date, equity: cumulative, dailyPnl: netPnl });
  }

  const totalNet = round(trades.reduce((sum, trade) => sum + trade.netPnl, 0));
  const winners = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const grossWins = winners.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const drawdown = maximumDrawdown(equityCurve.map((point) => point.equity));
  const marketCandles = modeledMarketCandles(
    dates,
    Number.parseInt(configurationHash.slice(8, 16), 16),
  );

  return {
    demo: true,
    synthetic: true,
    summary: {
      startingCapital: capital,
      endingCapital: round(capital + totalNet),
      netPnl: totalNet,
      roiPercent: round((totalNet / capital) * 100),
      maxDrawdown: drawdown.amount,
      maxDrawdownPercent: drawdown.percent,
      returnToDrawdown: drawdown.amount > 0 ? round(totalNet / drawdown.amount) : null,
      winRatePercent: trades.length > 0 ? round((winners.length / trades.length) * 100) : 0,
      profitFactor: grossLosses > 0 ? round(grossWins / grossLosses) : null,
      tradeCount: trades.length,
      winningTrades: winners.length,
      losingTrades: losses.length,
    },
    equityCurve,
    marketCandles,
    indicators: calculateIndicators(marketCandles),
    trades,
    manifest: {
      strategyConfigurationHash: configurationHash,
      datasetId: 'dset_synthetic_v1',
      datasetVersion: '1.0.0',
      engineVersion: 'demo-1.0.0',
      executionAdapter: 'edge_demo',
      generatedAt: new Date().toISOString(),
      timezone: 'Asia/Kolkata',
      priceResolution: configuration.priceResolution,
    },
    warnings: [
      'Illustrative synthetic data only. This result is not based on exchange market data.',
      'No live orders are placed and this output is not investment advice.',
    ],
  };
}

export const demoStrategy: StrategyConfiguration = {
  schemaVersion: '1.0.0',
  underlying: 'NIFTY',
  exchange: 'NSE',
  dateRange: { from: '2026-01-01', to: '2026-03-31' },
  session: { timezone: 'Asia/Kolkata', weekdays: [1, 2, 3, 4, 5] },
  entry: { type: 'fixed_time', time: '09:30' },
  exit: { time: '15:15', strategyStopLoss: { unit: 'percent', value: 25 } },
  legs: [
    {
      id: 'short_call',
      instrument: 'call',
      side: 'sell',
      quantity: { unit: 'lots', value: 1 },
      expiry: { type: 'current_week', nextWeekOnExpiryDay: true },
      strike: { type: 'atm' },
      stopLoss: { unit: 'percent', value: 30 },
      moveStopToCost: false,
      squareOff: 'leg',
      tags: ['core'],
    },
    {
      id: 'short_put',
      instrument: 'put',
      side: 'sell',
      quantity: { unit: 'lots', value: 1 },
      expiry: { type: 'current_week', nextWeekOnExpiryDay: true },
      strike: { type: 'atm' },
      stopLoss: { unit: 'percent', value: 30 },
      moveStopToCost: false,
      squareOff: 'leg',
      tags: ['core'],
    },
  ],
  priceResolution: 'ohlc_conservative',
  intervalMinutes: 1,
  missingDataPolicy: 'exclude_date',
  costModel: {
    slippagePercent: 0.1,
    directionAware: true,
    brokerageProfile: 'demo-india-flat-fee',
    costTableVersion: 'demo-2026.1',
  },
  filters: { excludedDates: [] },
  metadata: { tags: ['demo', 'short-straddle'], notes: 'Synthetic showcase preset.' },
};
