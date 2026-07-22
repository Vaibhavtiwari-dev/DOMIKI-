export type OptionType = 'CE' | 'PE';

export interface OptionCandle {
  timestamp: string;
  symbol: string;
  expiry: string;
  strike: number;
  optionType: OptionType;
  underlying: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number;
}

export interface ResearchConfiguration {
  symbol: string;
  entryTime: string;
  exitTime: string;
  lots: number;
  lotSize: number;
  strikeStep: number;
  stopLossPercent: number;
  targetPercent: number;
  slippageBps: number;
  feePerOrder: number;
  startingCapital: number;
}

export interface ResearchTrade {
  id: string;
  date: string;
  expiry: string;
  strike: number;
  quantity: number;
  entryTime: string;
  exitTime: string;
  callEntry: number;
  callExit: number;
  putEntry: number;
  putExit: number;
  grossPnl: number;
  costs: number;
  netPnl: number;
  exitReason: string;
}

export interface ResearchResult {
  summary: {
    netPnl: number;
    roiPercent: number;
    maxDrawdown: number;
    winRatePercent: number;
    profitFactor: number | null;
    tradeCount: number;
    excludedSessions: number;
  };
  trades: ResearchTrade[];
  equityCurve: Array<{ date: string; equity: number; dailyPnl: number }>;
  qualityGrade: 'A' | 'B' | 'C' | 'D' | 'F';
  warnings: string[];
  manifest: {
    engineVersion: string;
    generatedAt: string;
    datasetHash: string;
    fillPolicy: string;
    timezone: string;
    rowCount: number;
  };
}

const REQUIRED_HEADERS = [
  'timestamp', 'symbol', 'expiry', 'strike', 'optionType', 'underlying',
  'open', 'high', 'low', 'close', 'volume', 'openInterest',
] as const;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function parseLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      values.push(current.trim());
      current = '';
    } else current += character;
  }
  if (quoted) throw new Error('CSV contains an unterminated quoted value.');
  values.push(current.trim());
  return values;
}

function finite(value: string, field: string, row: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Row ${row}: ${field} must be a finite number.`);
  return parsed;
}

export function parseOptionCsv(text: string): OptionCandle[] {
  if (new TextEncoder().encode(text).byteLength > 50_000_000) {
    throw new Error('The CSV exceeds the 50 MB local-import limit.');
  }
  const lines = text.replace(/^\uFEFF/u, '').split(/\r?\n/u).filter((line) => line.trim());
  if (lines.length < 2) throw new Error('The CSV must contain a header and at least one row.');
  if (lines.length > 250_001) throw new Error('The CSV exceeds the 250,000-row local limit.');
  const headers = parseLine(lines[0] ?? '');
  const index = Object.fromEntries(headers.map((header, position) => [header, position]));
  for (const header of REQUIRED_HEADERS) {
    if (index[header] === undefined) throw new Error(`CSV is missing the ${header} column.`);
  }
  const rows = lines.slice(1).map((line, offset) => {
    const rowNumber = offset + 2;
    const values = parseLine(line);
    const read = (field: (typeof REQUIRED_HEADERS)[number]) => values[index[field] as number] ?? '';
    const timestamp = new Date(read('timestamp'));
    if (Number.isNaN(timestamp.getTime())) throw new Error(`Row ${rowNumber}: timestamp is invalid.`);
    const expiry = read('expiry');
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(expiry)) throw new Error(`Row ${rowNumber}: expiry must be YYYY-MM-DD.`);
    const optionType = read('optionType').toUpperCase();
    if (optionType !== 'CE' && optionType !== 'PE') throw new Error(`Row ${rowNumber}: optionType must be CE or PE.`);
    const candle: OptionCandle = {
      timestamp: timestamp.toISOString(),
      symbol: read('symbol').toUpperCase(),
      expiry,
      strike: finite(read('strike'), 'strike', rowNumber),
      optionType,
      underlying: finite(read('underlying'), 'underlying', rowNumber),
      open: finite(read('open'), 'open', rowNumber),
      high: finite(read('high'), 'high', rowNumber),
      low: finite(read('low'), 'low', rowNumber),
      close: finite(read('close'), 'close', rowNumber),
      volume: finite(read('volume'), 'volume', rowNumber),
      openInterest: finite(read('openInterest'), 'openInterest', rowNumber),
    };
    if (candle.low < 0 || candle.high < candle.low || candle.open < candle.low || candle.open > candle.high || candle.close < candle.low || candle.close > candle.high) {
      throw new Error(`Row ${rowNumber}: OHLC values are inconsistent.`);
    }
    return candle;
  });
  return rows.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function timeInIndia(timestamp: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date(timestamp));
}

function dateInIndia(timestamp: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function exitForShort(rows: OptionCandle[], entry: number, configuration: ResearchConfiguration) {
  const stop = entry * (1 + configuration.stopLossPercent / 100);
  const target = entry * (1 - configuration.targetPercent / 100);
  for (const row of rows) {
    if (row.high >= stop) return { price: stop, timestamp: row.timestamp, reason: 'leg_stop_loss' };
    if (configuration.targetPercent > 0 && row.low <= target) return { price: target, timestamp: row.timestamp, reason: 'leg_target' };
  }
  const last = rows.at(-1);
  return { price: last?.close ?? entry, timestamp: last?.timestamp ?? '', reason: 'scheduled_exit' };
}

export async function runOptionBacktest(
  rows: OptionCandle[],
  configuration: ResearchConfiguration,
): Promise<ResearchResult> {
  if (rows.length === 0) throw new Error('No option candles were supplied.');
  const grouped = new Map<string, OptionCandle[]>();
  for (const row of rows) {
    if (row.symbol !== configuration.symbol) continue;
    const date = dateInIndia(row.timestamp);
    grouped.set(date, [...(grouped.get(date) ?? []), row]);
  }
  const trades: ResearchTrade[] = [];
  let excludedSessions = 0;
  for (const [date, dayRows] of [...grouped.entries()].sort()) {
    const entryCandidates = dayRows.filter((row) => timeInIndia(row.timestamp) >= configuration.entryTime);
    const anchor = entryCandidates[0];
    if (!anchor) { excludedSessions += 1; continue; }
    const expiry = [...new Set(entryCandidates.map((row) => row.expiry))].filter((value) => value >= date).sort()[0];
    const strike = Math.round(anchor.underlying / configuration.strikeStep) * configuration.strikeStep;
    const legRows = (type: OptionType) => dayRows.filter((row) => row.expiry === expiry && row.strike === strike && row.optionType === type && timeInIndia(row.timestamp) >= configuration.entryTime && timeInIndia(row.timestamp) <= configuration.exitTime);
    const calls = legRows('CE');
    const puts = legRows('PE');
    if (!expiry || calls.length === 0 || puts.length === 0) { excludedSessions += 1; continue; }
    const callExit = exitForShort(calls, calls[0]!.open, configuration);
    const putExit = exitForShort(puts, puts[0]!.open, configuration);
    const quantity = configuration.lots * configuration.lotSize;
    const grossPnl = ((calls[0]!.open - callExit.price) + (puts[0]!.open - putExit.price)) * quantity;
    const turnover = (calls[0]!.open + callExit.price + puts[0]!.open + putExit.price) * quantity;
    const costs = turnover * configuration.slippageBps / 10_000 + configuration.feePerOrder * 4;
    trades.push({
      id: `trade-${date}`,
      date,
      expiry,
      strike,
      quantity,
      entryTime: calls[0]!.timestamp,
      exitTime: callExit.timestamp > putExit.timestamp ? callExit.timestamp : putExit.timestamp,
      callEntry: round(calls[0]!.open), callExit: round(callExit.price),
      putEntry: round(puts[0]!.open), putExit: round(putExit.price),
      grossPnl: round(grossPnl), costs: round(costs), netPnl: round(grossPnl - costs),
      exitReason: callExit.reason === 'scheduled_exit' && putExit.reason === 'scheduled_exit' ? 'scheduled_exit' : `${callExit.reason}/${putExit.reason}`,
    });
  }
  let equity = configuration.startingCapital;
  let peak = equity;
  let maximumDrawdown = 0;
  const equityCurve = [{ date: trades[0]?.date ?? '', equity, dailyPnl: 0 }];
  for (const trade of trades) {
    equity = round(equity + trade.netPnl);
    peak = Math.max(peak, equity);
    maximumDrawdown = Math.max(maximumDrawdown, peak - equity);
    equityCurve.push({ date: trade.date, equity, dailyPnl: trade.netPnl });
  }
  const wins = trades.filter((trade) => trade.netPnl > 0);
  const losses = trades.filter((trade) => trade.netPnl < 0);
  const netPnl = round(trades.reduce((sum, trade) => sum + trade.netPnl, 0));
  const grossWins = wins.reduce((sum, trade) => sum + trade.netPnl, 0);
  const grossLosses = Math.abs(losses.reduce((sum, trade) => sum + trade.netPnl, 0));
  const exclusionRate = grouped.size === 0 ? 1 : excludedSessions / grouped.size;
  const qualityGrade = exclusionRate === 0 ? 'A' : exclusionRate <= 0.02 ? 'B' : exclusionRate <= 0.1 ? 'C' : exclusionRate <= 0.25 ? 'D' : 'F';
  return {
    summary: {
      netPnl, roiPercent: round(netPnl / configuration.startingCapital * 100),
      maxDrawdown: round(maximumDrawdown),
      winRatePercent: trades.length ? round(wins.length / trades.length * 100) : 0,
      profitFactor: grossLosses ? round(grossWins / grossLosses) : null,
      tradeCount: trades.length, excludedSessions,
    },
    trades, equityCurve, qualityGrade,
    warnings: [
      'Conservative OHLC policy: a stop-loss wins same-candle conflicts.',
      ...(excludedSessions ? [`${excludedSessions} session(s) were excluded because required contracts or timestamps were missing.`] : []),
    ],
    manifest: {
      engineVersion: 'dokimi-browser-options-1.0.0', generatedAt: new Date().toISOString(),
      datasetHash: await sha256(JSON.stringify(rows)), fillPolicy: 'ohlc_conservative_stop_first',
      timezone: 'Asia/Kolkata', rowCount: rows.length,
    },
  };
}

export function createSampleOptionDataset(symbol = 'NIFTY'): OptionCandle[] {
  const rows: OptionCandle[] = [];
  let spot = 24_500;
  for (let day = 1; day <= 20; day += 1) {
    const date = new Date(Date.UTC(2026, 5, day));
    if (date.getUTCDay() === 0 || date.getUTCDay() === 6) continue;
    const dateText = date.toISOString().slice(0, 10);
    const expiry = '2026-06-25';
    const strike = Math.round(spot / 50) * 50;
    for (let step = 0; step < 24; step += 1) {
      const timestamp = new Date(`${dateText}T04:00:00.000Z`);
      timestamp.setUTCMinutes(timestamp.getUTCMinutes() + step * 15);
      spot += Math.sin(day * 1.7 + step * 0.35) * 6;
      for (const optionType of ['CE', 'PE'] as const) {
        const base = 125 + Math.abs(spot - strike) * 0.15;
        const decay = step * 2.4;
        const wave = Math.sin(step * 0.8 + (optionType === 'CE' ? 0 : 1.4)) * 18;
        const open = Math.max(4, base - decay + wave);
        const close = Math.max(3, open + Math.sin(step + day) * 7);
        rows.push({ timestamp: timestamp.toISOString(), symbol, expiry, strike, optionType, underlying: round(spot), open: round(open), high: round(Math.max(open, close) + 5), low: round(Math.max(0.5, Math.min(open, close) - 5)), close: round(close), volume: 50_000 + step * 1_000, openInterest: 1_000_000 + day * 10_000 });
      }
    }
  }
  return rows;
}
