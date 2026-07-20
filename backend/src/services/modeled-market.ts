import type { Candle, MarketSymbol } from '../domain/market-data';
import { calculateIndicators, DEFAULT_INDICATOR_PARAMETERS } from './indicators';

const BASELINES: Record<MarketSymbol, number> = {
  NIFTY: 24_600,
  BANKNIFTY: 53_400,
  FINNIFTY: 26_200,
  MIDCPNIFTY: 13_100,
  INDIAVIX: 14.5,
  SENSEX: 80_500,
  BANKEX: 60_200,
};

function seedFor(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

export function generateModeledMarketAnalysis(
  symbol: MarketSymbol,
  intervalMinutes: number,
  now = Date.now(),
) {
  const intervalMs = intervalMinutes * 60_000;
  const lastTimestamp = Math.floor(now / intervalMs) * intervalMs;
  const random = mulberry32(seedFor(`${symbol}:${intervalMinutes}:${lastTimestamp}`));
  const baseline = BASELINES[symbol];
  const scale = symbol === 'INDIAVIX' ? 0.012 : 0.0024;
  let previousClose = baseline * (0.985 + random() * 0.03);
  const candles: Candle[] = [];

  for (let index = 199; index >= 0; index -= 1) {
    const open = previousClose * (1 + (random() - 0.5) * scale * 0.7);
    const close = open * (1 + (random() + random() - 1) * scale);
    const range = Math.max(baseline * scale * (0.25 + random()), symbol === 'INDIAVIX' ? 0.03 : 1);
    const high = Math.max(open, close) + range;
    const low = Math.max(0.01, Math.min(open, close) - range);
    previousClose = close;
    candles.push({
      timestamp: new Date(lastTimestamp - index * intervalMs).toISOString(),
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: Math.round(80_000_000 + random() * 220_000_000),
      openInterest: 0,
    });
  }

  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const indicators = calculateIndicators(candles);
  return {
    provider: 'modeled-v1',
    source: 'modeled',
    market: 'equity_index',
    symbol,
    intervalMinutes,
    quote: {
      symbol,
      lastPrice: latest?.close ?? baseline,
      previousClose: previous?.close ?? baseline,
      volume: latest?.volume ?? 0,
      asOf: latest?.timestamp ?? new Date(lastTimestamp).toISOString(),
    },
    candles,
    indicators,
    latest: indicators.at(-1) ?? null,
    freshness: {
      quoteReceivedAt: latest?.timestamp ?? null,
      latestCandleAt: latest?.timestamp ?? null,
    },
    parameters: DEFAULT_INDICATOR_PARAMETERS,
  };
}
