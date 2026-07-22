import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  connectBybitSpotStream,
  type CryptoStreamStatus,
} from '../services/bybitStream';
import { connectUpstoxMarketStream } from '../services/upstoxStream';
import { endResearchSession } from '../services/api';
import { BasketManager } from './BasketManager';
import { HistoricalSimulator } from './HistoricalSimulator';
import { LiveBuilder } from './LiveBuilder';
import { PaperPortfolio } from './PaperPortfolio';
import { QuickBacktest } from './QuickBacktest';
import { ResultsLibrary } from './ResultsLibrary';
import { WorkspaceShell, type WorkspaceId } from './WorkspaceShell';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? 'http://localhost:8787' : '/api');

interface DemoStrategy {
  underlying: string;
  dateRange: { from: string; to: string };
  legs: Array<{ id: string; instrument: string; side: string }>;
  metadata: { notes?: string };
  [key: string]: unknown;
}

interface DemoResult {
  summary: {
    netPnl: number;
    roiPercent: number;
    maxDrawdown: number;
    winRatePercent: number;
    profitFactor: number | null;
    tradeCount: number;
  };
  equityCurve: Array<{ date: string; equity: number; dailyPnl: number }>;
  marketCandles: ChartCandle[];
  indicators: ChartIndicator[];
  trades: Array<{
    id: string;
    date: string;
    entryTime: string;
    exitTime: string;
    netPnl: number;
    exitReason: string;
  }>;
  manifest: {
    generatedAt: string;
  };
}

interface ApiResponse<T> {
  data: T;
}

interface MarketStatus {
  provider: string;
  configured: boolean;
  source: string;
  capabilities: string[];
  indicators: string[];
}

interface ChartCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface ChartIndicator {
  timestamp: string;
  ema: number | null;
  rsi: number | null;
  macd: number | null;
  macdHistogram: number | null;
  bollingerUpper: number | null;
  bollingerLower: number | null;
  atr: number | null;
  vwap: number | null;
  supertrend: number | null;
  supertrendDirection: 'bullish' | 'bearish' | null;
}

interface MarketAnalysis {
  provider: string;
  source: 'live' | 'modeled';
  market?: string;
  symbol: string;
  intervalMinutes: number;
  quote: { lastPrice: number; previousClose: number; volume: number; asOf: string };
  candles: ChartCandle[];
  indicators: ChartIndicator[];
  freshness: { quoteReceivedAt: string | null; latestCandleAt: string | null };
}

const INDICATOR_OPTIONS = [
  { id: 'ema', label: 'EMA 20' },
  { id: 'bollinger', label: 'Bollinger 20/2' },
  { id: 'supertrend', label: 'Supertrend 10/3' },
  { id: 'rsi', label: 'RSI 14' },
  { id: 'macd', label: 'MACD' },
  { id: 'atr', label: 'ATR 14' },
  { id: 'vwap', label: 'VWAP' },
  { id: 'volume', label: 'Volume' },
] as const;

type IndicatorId = (typeof INDICATOR_OPTIONS)[number]['id'];

function formatInr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatRunTime(value: string): string {
  return new Date(value).toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function EquityChart({ points }: { points: DemoResult['equityCurve'] }) {
  if (points.length < 2) return <div className="chart-empty">Awaiting run data.</div>;

  const values = points.map((point) => point.equity);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = maximum - minimum || 1;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 1000;
      const y = 240 - ((point.equity - minimum) / spread) * 210;
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');

  return (
    <svg className="equity-chart" viewBox="0 0 1000 260" role="img" aria-label="Completed backtest equity curve">
      <defs>
        <linearGradient id="equityFill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ccff00" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#ccff00" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="equity-area" d={`${path} L 1000 260 L 0 260 Z`} />
      <path className="equity-line" d={path} />
    </svg>
  );
}

function CandlestickChart({
  candles: allCandles,
  indicators: allIndicators,
  selectedIndicators,
  live,
}: {
  candles: ChartCandle[];
  indicators: ChartIndicator[];
  selectedIndicators: IndicatorId[];
  live: boolean;
}) {
  const candles = allCandles.slice(-80);
  const indicators = allIndicators.slice(-80);
  if (candles.length < 2) return <div className="chart-empty">Preparing market candles.</div>;
  const values = candles.flatMap((candle, index) => {
    const chartValues = [candle.high, candle.low];
    if (selectedIndicators.includes('bollinger')) {
      chartValues.push(
        indicators[index]?.bollingerUpper ?? candle.close,
        indicators[index]?.bollingerLower ?? candle.close,
      );
    }
    if (selectedIndicators.includes('ema')) chartValues.push(indicators[index]?.ema ?? candle.close);
    if (selectedIndicators.includes('supertrend')) chartValues.push(indicators[index]?.supertrend ?? candle.close);
    return chartValues;
  });
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const spread = maximum - minimum || 1;
  const yFor = (value: number) => 240 - ((value - minimum) / spread) * 210;
  const step = 1000 / candles.length;
  const candleWidth = Math.max(2, step * 0.58);
  const pathFor = (selector: (index: number) => number | null) => {
    let started = false;
    return candles
      .map((_, index) => {
        const value = selector(index);
        if (value === null) return '';
        const x = index * step + step / 2;
        const y = yFor(value);
        const command = started ? 'L' : 'M';
        started = true;
        return `${command} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  };
  const emaPath = pathFor((index) => indicators[index]?.ema ?? null);
  const upperPath = pathFor((index) => indicators[index]?.bollingerUpper ?? null);
  const lowerPath = pathFor((index) => indicators[index]?.bollingerLower ?? null);
  const supertrendPath = pathFor((index) => indicators[index]?.supertrend ?? null);

  return (
    <svg className="market-chart" viewBox="0 0 1000 260" role="img" aria-label={`${live ? 'Live' : 'Modeled'} OHLC candlestick chart`}>
      {selectedIndicators.includes('bollinger') && (
        <>
          <path className="market-band" d={upperPath} />
          <path className="market-band" d={lowerPath} />
        </>
      )}
      {candles.map((candle, index) => {
        const x = index * step + step / 2;
        const bullish = candle.close >= candle.open;
        const bodyTop = yFor(Math.max(candle.open, candle.close));
        const bodyHeight = Math.max(1.5, Math.abs(yFor(candle.open) - yFor(candle.close)));
        return (
          <g key={candle.timestamp} className={bullish ? 'candle bullish' : 'candle bearish'}>
            <line x1={x} x2={x} y1={yFor(candle.high)} y2={yFor(candle.low)} />
            <rect x={x - candleWidth / 2} y={bodyTop} width={candleWidth} height={bodyHeight} />
          </g>
        );
      })}
      {selectedIndicators.includes('ema') && <path className="market-ema" d={emaPath} />}
      {selectedIndicators.includes('supertrend') && <path className="market-supertrend" d={supertrendPath} />}
    </svg>
  );
}

function OverviewDashboard() {
  const [strategy, setStrategy] = useState<DemoStrategy | null>(null);
  const [result, setResult] = useState<DemoResult | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'running' | 'error'>('loading');
  const [error, setError] = useState('');
  const [marketStatus, setMarketStatus] = useState<MarketStatus | null>(null);
  const [marketAnalysis, setMarketAnalysis] = useState<MarketAnalysis | null>(null);
  const [marketSymbol, setMarketSymbol] = useState('SOLUSDT');
  const [marketInterval, setMarketInterval] = useState('5');
  const [marketLoading, setMarketLoading] = useState(false);
  const [marketError, setMarketError] = useState('');
  const [streamStatus, setStreamStatus] = useState<CryptoStreamStatus>('offline');
  const [selectedIndicators, setSelectedIndicators] = useState<IndicatorId[]>([]);
  const marketRequestId = useRef(0);

  const runBacktest = useCallback(async (selectedStrategy: DemoStrategy) => {
    setStatus('running');
    setError('');
    try {
      const response = await fetch(`${API_BASE_URL}/v1/demo/backtest`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configuration: selectedStrategy }),
      });
      if (!response.ok) throw new Error('The demo backtest service did not respond successfully.');
      const payload = (await response.json()) as ApiResponse<DemoResult>;
      setResult(payload.data);
      setStatus('ready');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to run the demo backtest.');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    const loadDemo = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/v1/demo/strategy`, { credentials: 'include' });
        if (!response.ok) throw new Error('The demo strategy could not be loaded.');
        const payload = (await response.json()) as ApiResponse<DemoStrategy>;
        setStrategy(payload.data);
        await runBacktest(payload.data);
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unable to initialize demo mode.');
        setStatus('error');
      }
    };

    void loadDemo();
  }, [runBacktest]);

  const refreshMarket = useCallback(async (
    symbol: string,
    interval: string,
    _equityLiveConfigured: boolean,
  ) => {
    const requestId = ++marketRequestId.current;
    setMarketLoading(true);
    setMarketError('');
    setMarketAnalysis((current) =>
      current?.symbol === symbol && current.intervalMinutes === Number(interval) ? current : null,
    );
    try {
      const route = symbol === 'SOLUSDT' ? 'crypto/analysis' : 'market/analysis';
      const response = await fetch(`${API_BASE_URL}/v1/demo/${route}?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}`, { credentials: 'include' });
      const payload = (await response.json()) as ApiResponse<MarketAnalysis> & {
        error?: { message?: string };
      };
      if (!response.ok) throw new Error(payload.error?.message ?? 'Live market data is unavailable.');
      if (requestId === marketRequestId.current) setMarketAnalysis(payload.data);
    } catch (caughtError) {
      if (requestId === marketRequestId.current) {
        setMarketError(caughtError instanceof Error ? caughtError.message : 'Live market data is unavailable.');
      }
    } finally {
      if (requestId === marketRequestId.current) setMarketLoading(false);
    }
  }, []);

  useEffect(() => {
    const loadMarketStatus = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/v1/demo/market/status`, { credentials: 'include' });
        if (!response.ok) throw new Error('Market-data status is unavailable.');
        const payload = (await response.json()) as ApiResponse<MarketStatus>;
        setMarketStatus(payload.data);
      } catch (caughtError) {
        setMarketError(caughtError instanceof Error ? caughtError.message : 'Market-data status is unavailable.');
      }
    };
    void loadMarketStatus();
  }, []);

  useEffect(() => {
    if (!marketStatus) return;
    void refreshMarket(marketSymbol, marketInterval, marketStatus.configured);
  }, [marketInterval, marketStatus, marketSymbol, refreshMarket]);

  useEffect(() => {
    if (!marketStatus || marketSymbol === 'SOLUSDT') return;
    const reconciliation = window.setInterval(() => {
      void refreshMarket(marketSymbol, marketInterval, marketStatus.configured);
    }, 15_000);
    return () => window.clearInterval(reconciliation);
  }, [marketInterval, marketStatus, marketSymbol, refreshMarket]);

  useEffect(() => {
    if (marketSymbol !== 'SOLUSDT' || !marketStatus) {
      setStreamStatus('offline');
      return;
    }
    const intervalMinutes = Number(marketInterval);
    const disconnect = connectBybitSpotStream({
      symbol: 'SOLUSDT',
      interval: marketInterval,
      onStatus: setStreamStatus,
      onUpdate: (update) => {
        setMarketAnalysis((current) => {
          if (
            !current ||
            current.symbol !== 'SOLUSDT' ||
            current.intervalMinutes !== intervalMinutes
          ) {
            return current;
          }
          const quote = update.quote
            ? {
                ...current.quote,
                lastPrice: update.quote.lastPrice,
                volume: update.quote.volume ?? current.quote.volume,
                asOf: update.quote.asOf,
              }
            : current.quote;
          let candles = current.candles;
          if (update.candle) {
            const candleIndex = candles.findIndex(
              (candle) => candle.timestamp === update.candle?.timestamp,
            );
            candles = [...candles];
            if (candleIndex >= 0) candles[candleIndex] = update.candle;
            else candles = [...candles, update.candle].slice(-200);
          }
          return {
            ...current,
            quote,
            candles,
            freshness: {
              quoteReceivedAt: update.quote?.asOf ?? current.freshness.quoteReceivedAt,
              latestCandleAt: update.candle?.timestamp ?? current.freshness.latestCandleAt,
            },
          };
        });
      },
    });
    const reconciliation = window.setInterval(() => {
      void refreshMarket('SOLUSDT', marketInterval, false);
    }, 15_000);
    return () => {
      window.clearInterval(reconciliation);
      disconnect();
    };
  }, [marketInterval, marketStatus, marketSymbol, refreshMarket]);

  useEffect(() => {
    if (!marketStatus?.configured || marketSymbol === 'SOLUSDT') return;
    const intervalMinutes = Number(marketInterval);
    return connectUpstoxMarketStream({
      apiBaseUrl: API_BASE_URL,
      symbol: marketSymbol,
      onStatus: setStreamStatus,
      onQuote: (streamQuote) => {
        setMarketAnalysis((current) => {
          if (
            !current ||
            current.symbol !== marketSymbol ||
            current.intervalMinutes !== intervalMinutes
          ) {
            return current;
          }
          const timestampMs = Date.parse(streamQuote.asOf);
          const candleTimestamp = new Date(
            Math.floor(timestampMs / (intervalMinutes * 60_000)) * intervalMinutes * 60_000,
          ).toISOString();
          const candles = [...current.candles];
          const latest = candles.at(-1);
          if (latest?.timestamp === candleTimestamp) {
            candles[candles.length - 1] = {
              ...latest,
              high: Math.max(latest.high, streamQuote.lastPrice),
              low: Math.min(latest.low, streamQuote.lastPrice),
              close: streamQuote.lastPrice,
            };
          } else if (!latest || latest.timestamp < candleTimestamp) {
            candles.push({
              timestamp: candleTimestamp,
              open: streamQuote.lastPrice,
              high: streamQuote.lastPrice,
              low: streamQuote.lastPrice,
              close: streamQuote.lastPrice,
              volume: 0,
            });
          }
          return {
            ...current,
            quote: {
              ...current.quote,
              lastPrice: streamQuote.lastPrice,
              previousClose: streamQuote.previousClose ?? current.quote.previousClose,
              asOf: streamQuote.asOf,
            },
            candles: candles.slice(-200),
            freshness: {
              quoteReceivedAt: streamQuote.asOf,
              latestCandleAt: candles.at(-1)?.timestamp ?? current.freshness.latestCandleAt,
            },
          };
        });
      },
    });
  }, [marketInterval, marketStatus?.configured, marketSymbol]);

  const liveMarket = marketAnalysis?.source === 'live';
  const displayedCandles = marketAnalysis?.candles ?? [];
  const displayedIndicators = marketAnalysis?.indicators ?? [];
  const latestCandle = displayedCandles.at(-1);
  const latestIndicator = displayedIndicators.at(-1);
  const selectedReadouts = [
    { id: 'rsi' as const, label: 'RSI 14', value: latestIndicator?.rsi?.toFixed(2) ?? '—' },
    { id: 'macd' as const, label: 'MACD', value: latestIndicator?.macd?.toFixed(2) ?? '—' },
    { id: 'atr' as const, label: 'ATR 14', value: latestIndicator?.atr?.toFixed(2) ?? '—' },
    { id: 'vwap' as const, label: 'VWAP', value: latestIndicator?.vwap?.toFixed(2) ?? '—' },
    { id: 'supertrend' as const, label: 'Supertrend', value: latestIndicator?.supertrendDirection?.toUpperCase() ?? '—' },
    { id: 'volume' as const, label: 'Volume', value: (marketAnalysis?.quote.volume ?? latestCandle?.volume ?? 0).toLocaleString('en-IN') },
  ].filter(({ id }) => selectedIndicators.includes(id));
  const lastRunLabel = result
    ? `COMPLETED ${formatRunTime(result.manifest.generatedAt)}`
    : 'AWAITING RUN';

  return (
    <main className="demo-shell">
      <section className="demo-hero">
        <div>
          <p className="demo-kicker">Research terminal / Live market data</p>
          <h1>Strategy<br /><span>Intelligence.</span></h1>
        </div>
        <div className="strategy-summary">
          <div><span>Underlying</span><strong>{strategy?.underlying ?? '—'}</strong></div>
          <div><span>Structure</span><strong>{strategy ? `${strategy.legs.length}-leg short straddle` : '—'}</strong></div>
          <div><span>Period</span><strong>{strategy ? `${strategy.dateRange.from} → ${strategy.dateRange.to}` : '—'}</strong></div>
          <button type="button" className="run-button" disabled={!strategy || status === 'running'} onClick={() => strategy && void runBacktest(strategy)}>
            {status === 'running' ? 'Running model…' : 'Run again'}
          </button>
        </div>
      </section>

      {error && <div className="demo-error" role="alert">{error} Ensure the backend is running on port 8787.</div>}

      <section className="metrics-grid" aria-label="Backtest summary">
        <article><span>Net P&amp;L</span><strong>{result ? formatInr(result.summary.netPnl) : '—'}</strong><small>Synthetic result</small></article>
        <article><span>Return</span><strong>{result ? `${result.summary.roiPercent.toFixed(2)}%` : '—'}</strong><small>On ₹5L capital</small></article>
        <article><span>Max drawdown</span><strong>{result ? formatInr(result.summary.maxDrawdown) : '—'}</strong><small>Conservative path</small></article>
        <article><span>Win rate</span><strong>{result ? `${result.summary.winRatePercent.toFixed(1)}%` : '—'}</strong><small>{result ? `${result.summary.tradeCount} sessions` : 'Awaiting run'}</small></article>
      </section>

      <section className="live-lab terminal-panel" aria-label="Live Indicator Lab">
        <div className="live-lab-header">
          <div>
            <p className="demo-kicker">Indicator lab</p>
            <h2>Market telemetry.</h2>
          </div>
          <div className="market-controls">
            <label>
              Instrument
              <select value={marketSymbol} onChange={(event) => setMarketSymbol(event.target.value)}>
                <option value="SOLUSDT">SOL / USDT · LIVE</option>
                <option value="NIFTY">NIFTY 50</option>
                <option value="BANKNIFTY">BANK NIFTY</option>
                <option value="FINNIFTY">FIN NIFTY</option>
                <option value="INDIAVIX">INDIA VIX</option>
                <option value="SENSEX">SENSEX</option>
              </select>
            </label>
            <label>
              Interval
              <select value={marketInterval} onChange={(event) => setMarketInterval(event.target.value)}>
                <option value="1">1 minute</option>
                <option value="3">3 minutes</option>
                <option value="5">5 minutes</option>
                <option value="15">15 minutes</option>
                <option value="30">30 minutes</option>
              </select>
            </label>
            {marketSymbol === 'SOLUSDT' ? (
              <div className={`stream-status ${streamStatus}`} aria-live="polite">
                <span /> {streamStatus === 'live' ? 'Streaming live' : streamStatus}
              </div>
            ) : (
              <div className={`stream-status ${marketStatus?.configured ? streamStatus : 'offline'}`} aria-live="polite">
                <span /> {marketLoading ? 'Syncing…' : marketStatus?.configured ? streamStatus === 'live' ? 'Streaming live' : streamStatus : 'Provider required'}
              </div>
            )}
          </div>
        </div>

        <div className="indicator-picker" role="group" aria-labelledby="indicator-picker-label">
          <div className="indicator-picker-copy">
            <strong id="indicator-picker-label">Indicators</strong>
            <span>Candles only by default. Add the studies you need.</span>
          </div>
          <div className="indicator-options">
            {INDICATOR_OPTIONS.map((indicator) => {
              const isSelected = selectedIndicators.includes(indicator.id);
              return (
                <button
                  key={indicator.id}
                  type="button"
                  className={isSelected ? 'indicator-option selected' : 'indicator-option'}
                  aria-pressed={isSelected}
                  onClick={() => setSelectedIndicators((current) => (
                    current.includes(indicator.id)
                      ? current.filter((id) => id !== indicator.id)
                      : [...current, indicator.id]
                  ))}
                >
                  {indicator.label}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            className="indicator-clear"
            disabled={selectedIndicators.length === 0}
            onClick={() => setSelectedIndicators([])}
          >
            Clear all
          </button>
        </div>

        {marketSymbol !== 'SOLUSDT' && !marketStatus?.configured && (
          <div className="provider-banner">
            <span className="provider-state">EQUITY PROVIDER NOT CONFIGURED</span>
            <p>Add the read-only Upstox Analytics Token on the backend. Professional mode never substitutes fabricated equity candles.</p>
          </div>
        )}
        {displayedCandles.length > 0 ? (
          <div className={`market-live-grid${selectedReadouts.length === 0 ? ' chart-only' : ''}`}>
            <div className="market-chart-wrap">
              <div className="market-quote">
                <div><span>{marketAnalysis?.symbol ?? strategy?.underlying ?? 'NIFTY'}</span><strong>{(marketAnalysis?.quote.lastPrice ?? latestCandle?.close ?? 0).toLocaleString('en-IN')}</strong></div>
                <small>{liveMarket ? marketAnalysis?.market === 'crypto_spot' ? 'PUBLIC WEBSOCKET STREAM' : 'EXCHANGE-BACKED LIVE DATA' : 'DETERMINISTIC MODELED BACKTEST DATA'} · Latest candle {latestCandle ? new Date(latestCandle.timestamp).toLocaleString('en-IN') : 'pending'} · Synced {marketAnalysis?.freshness.quoteReceivedAt ? new Date(marketAnalysis.freshness.quoteReceivedAt).toLocaleTimeString('en-IN') : 'pending'}</small>
              </div>
              <CandlestickChart candles={displayedCandles} indicators={displayedIndicators} selectedIndicators={selectedIndicators} live={liveMarket} />
              <div className="chart-legend">
                <span className="legend-price">OHLC CANDLES</span>
                {selectedIndicators.includes('ema') && <span className="legend-ema">EMA 20</span>}
                {selectedIndicators.includes('bollinger') && <span className="legend-band">BOLLINGER 20/2</span>}
                {selectedIndicators.includes('supertrend') && <span className="legend-supertrend">SUPERTREND 10/3</span>}
              </div>
            </div>
            {selectedReadouts.length > 0 && (
              <div className="indicator-readout">
                {selectedReadouts.map(({ id, label, value }) => <div key={id}><span>{label}</span><strong>{value}</strong></div>)}
              </div>
            )}
          </div>
        ) : (
          <div className="provider-setup">{marketLoading ? 'Loading market candles…' : 'No verified candles available.'}</div>
        )}
        {marketError && <div className="market-error" role="alert">{marketError}</div>}
      </section>

      <section className="demo-grid">
        <article className="terminal-panel chart-panel">
          <div className="panel-heading"><span>Backtest equity curve</span><small>{lastRunLabel}</small></div>
          <p className="panel-context">Cumulative P&amp;L from the completed strategy run. It redraws whenever a new backtest finishes.</p>
          <EquityChart key={result?.manifest.generatedAt ?? 'waiting'} points={result?.equityCurve ?? []} />
        </article>
        <article className="terminal-panel">
          <div className="panel-heading"><span>Backtest sessions</span><small>{result ? `${result.summary.tradeCount} TRADES` : 'AWAITING RUN'}</small></div>
          <p className="panel-context">The latest completed trades from this strategy run, separate from live market ticks.</p>
          <div className="trade-list" key={result?.manifest.generatedAt ?? 'waiting'}>
            {(result?.trades.slice(-6).reverse() ?? []).map((trade) => (
              <div className="trade-row" key={trade.id}>
                <span>{trade.date}</span>
                <span className="trade-reason">{trade.exitReason.replaceAll('_', ' ')}</span>
                <strong className={trade.netPnl >= 0 ? 'positive' : 'negative'}>{formatInr(trade.netPnl)}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>

    </main>
  );
}

export function DemoDashboard() {
  const navigate = useNavigate();
  const [workspace, setWorkspace] = useState<WorkspaceId>('overview');
  const exit = async () => {
    try {
      await endResearchSession();
    } finally {
      navigate('/');
    }
  };

  return (
    <WorkspaceShell active={workspace} onChange={setWorkspace} onExit={() => void exit()}>
      {workspace === 'overview' && <OverviewDashboard />}
      {workspace === 'backtest' && <QuickBacktest />}
      {workspace === 'results' && <ResultsLibrary />}
      {workspace === 'baskets' && <BasketManager />}
      {workspace === 'simulator' && <HistoricalSimulator />}
      {workspace === 'builder' && <LiveBuilder />}
      {workspace === 'portfolio' && <PaperPortfolio />}
    </WorkspaceShell>
  );
}
