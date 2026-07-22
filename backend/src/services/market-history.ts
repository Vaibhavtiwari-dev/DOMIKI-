import type { Candle, MarketDataProvider, MarketSymbol } from '../domain/market-data.js';

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export async function loadRecentCandles(
  provider: MarketDataProvider,
  symbol: MarketSymbol,
  intervalMinutes: number,
  now = new Date(),
): Promise<Candle[]> {
  const intraday = await provider.getIntradayCandles(symbol, intervalMinutes);
  if (intraday.length >= 2) return intraday;

  const from = new Date(now);
  from.setUTCDate(from.getUTCDate() - 14);
  const historical = await provider.getHistoricalCandles(
    symbol,
    intervalMinutes,
    isoDate(from),
    isoDate(now),
  );
  const combined = new Map<string, Candle>();
  for (const candle of [...historical, ...intraday]) combined.set(candle.timestamp, candle);
  return [...combined.values()].sort((left, right) =>
    left.timestamp.localeCompare(right.timestamp),
  );
}
