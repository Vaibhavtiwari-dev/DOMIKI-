import type { Candle } from '../domain/market-data';

export interface IndicatorParameters {
  smaPeriod: number;
  emaPeriod: number;
  rsiPeriod: number;
  macdFast: number;
  macdSlow: number;
  macdSignal: number;
  bollingerPeriod: number;
  bollingerDeviation: number;
  atrPeriod: number;
  supertrendPeriod: number;
  supertrendMultiplier: number;
}

export interface IndicatorPoint {
  timestamp: string;
  sma: number | null;
  ema: number | null;
  rsi: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bollingerUpper: number | null;
  bollingerMiddle: number | null;
  bollingerLower: number | null;
  atr: number | null;
  vwap: number | null;
  supertrend: number | null;
  supertrendDirection: 'bullish' | 'bearish' | null;
}

export const DEFAULT_INDICATOR_PARAMETERS: IndicatorParameters = {
  smaPeriod: 20,
  emaPeriod: 20,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  bollingerPeriod: 20,
  bollingerDeviation: 2,
  atrPeriod: 14,
  supertrendPeriod: 10,
  supertrendMultiplier: 3,
};

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function simpleMovingAverage(values: number[], period: number): (number | null)[] {
  const output = Array<number | null>(values.length).fill(null);
  let sum = 0;
  for (const [index, value] of values.entries()) {
    sum += value;
    if (index >= period) sum -= values[index - period] ?? 0;
    if (index >= period - 1) output[index] = round(sum / period);
  }
  return output;
}

export function exponentialMovingAverage(values: number[], period: number): (number | null)[] {
  const output = Array<number | null>(values.length).fill(null);
  if (values.length < period) return output;
  const seed = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = round(seed);
  const multiplier = 2 / (period + 1);
  let previous = seed;
  for (let index = period; index < values.length; index += 1) {
    previous = ((values[index] ?? previous) - previous) * multiplier + previous;
    output[index] = round(previous);
  }
  return output;
}

function nullableEma(values: (number | null)[], period: number): (number | null)[] {
  const output = Array<number | null>(values.length).fill(null);
  const available = values.flatMap((value, index) => (value === null ? [] : [{ value, index }]));
  if (available.length < period) return output;
  let previous = available.slice(0, period).reduce((sum, item) => sum + item.value, 0) / period;
  output[available[period - 1]?.index ?? 0] = round(previous);
  const multiplier = 2 / (period + 1);
  for (let index = period; index < available.length; index += 1) {
    const item = available[index];
    if (!item) continue;
    previous = (item.value - previous) * multiplier + previous;
    output[item.index] = round(previous);
  }
  return output;
}

export function relativeStrengthIndex(values: number[], period: number): (number | null)[] {
  const output = Array<number | null>(values.length).fill(null);
  if (values.length <= period) return output;
  let averageGain = 0;
  let averageLoss = 0;
  for (let index = 1; index <= period; index += 1) {
    const change = (values[index] ?? 0) - (values[index - 1] ?? 0);
    averageGain += Math.max(change, 0);
    averageLoss += Math.max(-change, 0);
  }
  averageGain /= period;
  averageLoss /= period;
  output[period] = averageLoss === 0 ? 100 : round(100 - 100 / (1 + averageGain / averageLoss));
  for (let index = period + 1; index < values.length; index += 1) {
    const change = (values[index] ?? 0) - (values[index - 1] ?? 0);
    averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    output[index] = averageLoss === 0 ? 100 : round(100 - 100 / (1 + averageGain / averageLoss));
  }
  return output;
}

export function trueRange(candles: Candle[]): number[] {
  return candles.map((candle, index) => {
    const previousClose = candles[index - 1]?.close ?? candle.close;
    return round(
      Math.max(
        candle.high - candle.low,
        Math.abs(candle.high - previousClose),
        Math.abs(candle.low - previousClose),
      ),
    );
  });
}

function wilderAverage(values: number[], period: number): (number | null)[] {
  const output = Array<number | null>(values.length).fill(null);
  if (values.length < period) return output;
  let previous = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = round(previous);
  for (let index = period; index < values.length; index += 1) {
    previous = (previous * (period - 1) + (values[index] ?? 0)) / period;
    output[index] = round(previous);
  }
  return output;
}

function bollingerBands(values: number[], period: number, deviation: number) {
  const middle = simpleMovingAverage(values, period);
  const upper = Array<number | null>(values.length).fill(null);
  const lower = Array<number | null>(values.length).fill(null);
  for (let index = period - 1; index < values.length; index += 1) {
    const window = values.slice(index - period + 1, index + 1);
    const mean = middle[index];
    if (mean === null || mean === undefined) continue;
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const standardDeviation = Math.sqrt(variance);
    upper[index] = round(mean + deviation * standardDeviation);
    lower[index] = round(mean - deviation * standardDeviation);
  }
  return { middle, upper, lower };
}

function volumeWeightedAveragePrice(candles: Candle[]): (number | null)[] {
  let currentDate = '';
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  return candles.map((candle) => {
    const sessionDate = candle.timestamp.slice(0, 10);
    if (sessionDate !== currentDate) {
      currentDate = sessionDate;
      cumulativePriceVolume = 0;
      cumulativeVolume = 0;
    }
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativePriceVolume += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
    return cumulativeVolume === 0 ? null : round(cumulativePriceVolume / cumulativeVolume);
  });
}

function supertrend(candles: Candle[], period: number, multiplier: number) {
  const atr = wilderAverage(trueRange(candles), period);
  const values = Array<number | null>(candles.length).fill(null);
  const directions = Array<'bullish' | 'bearish' | null>(candles.length).fill(null);
  let finalUpper = 0;
  let finalLower = 0;
  let direction: 'bullish' | 'bearish' = 'bullish';

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const currentAtr = atr[index];
    if (!candle || currentAtr === null || currentAtr === undefined) continue;
    const midpoint = (candle.high + candle.low) / 2;
    const basicUpper = midpoint + multiplier * currentAtr;
    const basicLower = midpoint - multiplier * currentAtr;
    const previousCandle = candles[index - 1];
    const previousUpper = finalUpper;
    const previousLower = finalLower;
    finalUpper =
      index === period - 1 ||
      basicUpper < previousUpper ||
      (previousCandle?.close ?? 0) > previousUpper
        ? basicUpper
        : previousUpper;
    finalLower =
      index === period - 1 ||
      basicLower > previousLower ||
      (previousCandle?.close ?? 0) < previousLower
        ? basicLower
        : previousLower;
    if (index > period - 1) {
      if (direction === 'bearish' && candle.close > finalUpper) direction = 'bullish';
      else if (direction === 'bullish' && candle.close < finalLower) direction = 'bearish';
    }
    directions[index] = direction;
    values[index] = round(direction === 'bullish' ? finalLower : finalUpper);
  }
  return { values, directions };
}

export function calculateIndicators(
  candles: Candle[],
  parameters: IndicatorParameters = DEFAULT_INDICATOR_PARAMETERS,
): IndicatorPoint[] {
  const closes = candles.map((candle) => candle.close);
  const sma = simpleMovingAverage(closes, parameters.smaPeriod);
  const ema = exponentialMovingAverage(closes, parameters.emaPeriod);
  const rsi = relativeStrengthIndex(closes, parameters.rsiPeriod);
  const fastEma = exponentialMovingAverage(closes, parameters.macdFast);
  const slowEma = exponentialMovingAverage(closes, parameters.macdSlow);
  const macd = closes.map((_, index) =>
    fastEma[index] === null || slowEma[index] === null
      ? null
      : round((fastEma[index] ?? 0) - (slowEma[index] ?? 0)),
  );
  const macdSignal = nullableEma(macd, parameters.macdSignal);
  const bands = bollingerBands(closes, parameters.bollingerPeriod, parameters.bollingerDeviation);
  const atr = wilderAverage(trueRange(candles), parameters.atrPeriod);
  const vwap = volumeWeightedAveragePrice(candles);
  const trend = supertrend(candles, parameters.supertrendPeriod, parameters.supertrendMultiplier);

  return candles.map((candle, index) => ({
    timestamp: candle.timestamp,
    sma: sma[index] ?? null,
    ema: ema[index] ?? null,
    rsi: rsi[index] ?? null,
    macd: macd[index] ?? null,
    macdSignal: macdSignal[index] ?? null,
    macdHistogram:
      macd[index] === null || macdSignal[index] === null
        ? null
        : round((macd[index] ?? 0) - (macdSignal[index] ?? 0)),
    bollingerUpper: bands.upper[index] ?? null,
    bollingerMiddle: bands.middle[index] ?? null,
    bollingerLower: bands.lower[index] ?? null,
    atr: atr[index] ?? null,
    vwap: vwap[index] ?? null,
    supertrend: trend.values[index] ?? null,
    supertrendDirection: trend.directions[index] ?? null,
  }));
}
