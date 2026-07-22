import { useRef, useState } from 'react';
import { Copy, Download, FileUp, Play, Save, Square } from 'lucide-react';
import { runBacktestInWorker } from '../services/backtest-worker';
import { downloadText, resultCsv } from '../services/export-engine';
import {
  createSampleOptionDataset,
  parseOptionCsv,
  type OptionCandle,
  type ResearchConfiguration,
  type ResearchResult,
} from '../services/option-engine';
import { StatusNotice, WorkspaceHeading } from './WorkspaceShell';
import { readSavedRuns, saveResearchRun } from '../services/result-store';

interface StrategyVersion {
  id: string;
  name: string;
  version: number;
  savedAt: string;
  configuration: ResearchConfiguration;
}

const STRATEGY_KEY = 'dokimi:strategy-versions';

function readStrategyVersions(): StrategyVersion[] {
  try { return JSON.parse(window.localStorage.getItem(STRATEGY_KEY) ?? '[]') as StrategyVersion[]; } catch { return []; }
}

const DEFAULT_CONFIGURATION: ResearchConfiguration = {
  symbol: 'NIFTY', entryTime: '09:30', exitTime: '15:15', lots: 1, lotSize: 50,
  strikeStep: 50, stopLossPercent: 30, targetPercent: 50, slippageBps: 5,
  feePerOrder: 20, startingCapital: 500_000,
};

function inr(value: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value);
}

function ResultChart({ result }: { result: ResearchResult }) {
  const values = result.equityCurve.map((point) => point.equity);
  if (values.length < 2) return <div className="workspace-empty">No completed trades to chart.</div>;
  const min = Math.min(...values); const max = Math.max(...values); const spread = max - min || 1;
  const path = values.map((value, index) => `${index ? 'L' : 'M'} ${(index / (values.length - 1) * 1000).toFixed(2)} ${(230 - (value - min) / spread * 200).toFixed(2)}`).join(' ');
  return <svg className="research-equity-chart" viewBox="0 0 1000 250" role="img" aria-label="Imported-data backtest equity curve"><path d={path} /></svg>;
}

export function QuickBacktest() {
  const [configuration, setConfiguration] = useState(DEFAULT_CONFIGURATION);
  const [rows, setRows] = useState<OptionCandle[]>(() => createSampleOptionDataset());
  const [source, setSource] = useState<'sample' | 'imported'>('sample');
  const [datasetName, setDatasetName] = useState('Dokimi synthetic option fixture');
  const [result, setResult] = useState<ResearchResult | null>(null);
  const [status, setStatus] = useState<'ready' | 'running' | 'error'>('ready');
  const [error, setError] = useState('');
  const [versions, setVersions] = useState<StrategyVersion[]>(readStrategyVersions);
  const [selectedVersionId, setSelectedVersionId] = useState('');
  const [comparisonId, setComparisonId] = useState('');
  const [savedRuns, setSavedRuns] = useState(readSavedRuns);
  const cancelRef = useRef<(() => void) | null>(null);

  const updateNumber = (key: keyof ResearchConfiguration, value: string) => {
    const number = Number(value);
    if (Number.isFinite(number)) setConfiguration((current) => ({ ...current, [key]: number }));
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    setError('');
    try {
      const imported = parseOptionCsv(await file.text());
      setRows(imported); setSource('imported'); setDatasetName(file.name); setResult(null);
      setConfiguration((current) => ({ ...current, symbol: imported[0]?.symbol ?? current.symbol }));
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to import this dataset.');
    }
  };

  const run = async () => {
    setStatus('running'); setError('');
    const task = runBacktestInWorker(rows, configuration);
    cancelRef.current = task.cancel;
    try {
      const next = await task.promise;
      setResult(next);
      window.localStorage.setItem('dokimi:last-research-result', JSON.stringify(next));
      saveResearchRun({ id: crypto.randomUUID(), name: `${configuration.symbol} short straddle`, source, datasetName, configuration, result: next, savedAt: new Date().toISOString() });
      setSavedRuns(readSavedRuns());
      setStatus('ready');
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Backtest failed.');
      setStatus('error');
    } finally { cancelRef.current = null; }
  };

  const cancel = () => { cancelRef.current?.(); cancelRef.current = null; setStatus('ready'); };
  const saveVersion = () => {
    const version = 1 + Math.max(0, ...versions.filter((value) => value.name === configuration.symbol).map((value) => value.version));
    const next = [{ id: crypto.randomUUID(), name: configuration.symbol, version, savedAt: new Date().toISOString(), configuration }, ...versions].slice(0, 100);
    window.localStorage.setItem(STRATEGY_KEY, JSON.stringify(next));
    setVersions(next);
    setSelectedVersionId(next[0]?.id ?? '');
  };
  const cloneVersion = () => {
    const selected = versions.find((value) => value.id === selectedVersionId);
    if (!selected) return;
    setConfiguration({ ...selected.configuration });
    setResult(null);
  };
  const comparison = savedRuns.find((value) => value.id === comparisonId) ?? null;

  return (
    <div className="workspace-page">
      <WorkspaceHeading eyebrow="Part 3 / deterministic engine" title="Quick Backtest" description="Run a conservative short-straddle research model in a browser worker. Import legally obtained option candles to replace the explicit sample fixture." actions={<><label className="secondary-button file-button"><FileUp size={15} /> Import option CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void importFile(event.target.files?.[0])} /></label>{status === 'running' ? <button className="danger-button" type="button" onClick={cancel}><Square size={14} /> Cancel</button> : <button className="primary-button" type="button" onClick={() => void run()}><Play size={15} /> Run backtest</button>}</>} />

      <StatusNotice tone={source === 'imported' ? 'good' : 'warning'} title={source === 'imported' ? 'USER-IMPORTED DATA' : 'SYNTHETIC FIXTURE'}>
        {datasetName} · {rows.length.toLocaleString('en-IN')} rows. {source === 'sample' ? 'Illustrative only; not exchange evidence.' : 'Processed locally in this browser; confirm your data rights and quality.'}
      </StatusNotice>
      {error && <StatusNotice tone="danger" title="BACKTEST ERROR">{error}</StatusNotice>}

      <section className="workspace-grid two-column">
        <article className="workspace-panel">
          <div className="panel-title"><span>Strategy configuration</span><small>SHORT ATM STRADDLE</small></div>
          <div className="strategy-version-row"><label>Saved version<select value={selectedVersionId} onChange={(event) => setSelectedVersionId(event.target.value)}><option value="">Select version</option>{versions.map((value) => <option value={value.id} key={value.id}>{value.name} · v{value.version}</option>)}</select></label><button className="secondary-button" type="button" onClick={saveVersion}><Save size={14} /> Save version</button><button className="secondary-button" type="button" disabled={!selectedVersionId} onClick={cloneVersion}><Copy size={14} /> Clone into form</button></div>
          <div className="form-grid">
            <label>Symbol<input value={configuration.symbol} maxLength={20} onChange={(event) => setConfiguration((current) => ({ ...current, symbol: event.target.value.toUpperCase() }))} /></label>
            <label>Entry time<input type="time" value={configuration.entryTime} onChange={(event) => setConfiguration((current) => ({ ...current, entryTime: event.target.value }))} /></label>
            <label>Exit time<input type="time" value={configuration.exitTime} onChange={(event) => setConfiguration((current) => ({ ...current, exitTime: event.target.value }))} /></label>
            <label>Lots<input type="number" min="1" max="100" value={configuration.lots} onChange={(event) => updateNumber('lots', event.target.value)} /></label>
            <label>Lot size<input type="number" min="1" value={configuration.lotSize} onChange={(event) => updateNumber('lotSize', event.target.value)} /></label>
            <label>Strike step<input type="number" min="1" value={configuration.strikeStep} onChange={(event) => updateNumber('strikeStep', event.target.value)} /></label>
            <label>Leg stop-loss %<input type="number" min="1" max="500" value={configuration.stopLossPercent} onChange={(event) => updateNumber('stopLossPercent', event.target.value)} /></label>
            <label>Leg target %<input type="number" min="0" max="100" value={configuration.targetPercent} onChange={(event) => updateNumber('targetPercent', event.target.value)} /></label>
            <label>Slippage bps<input type="number" min="0" max="500" value={configuration.slippageBps} onChange={(event) => updateNumber('slippageBps', event.target.value)} /></label>
            <label>Fee / order<input type="number" min="0" value={configuration.feePerOrder} onChange={(event) => updateNumber('feePerOrder', event.target.value)} /></label>
          </div>
          <p className="panel-footnote">Required CSV columns: timestamp, symbol, expiry, strike, optionType, underlying, open, high, low, close, volume, openInterest.</p>
        </article>
        <article className="workspace-panel result-panel">
          <div className="panel-title"><span>Research result</span><small>{result ? `QUALITY ${result.qualityGrade}` : status.toUpperCase()}</small></div>
          {result ? <>
            <div className="metric-strip"><div><span>Net P&amp;L</span><strong>{inr(result.summary.netPnl)}</strong></div><div><span>ROI</span><strong>{result.summary.roiPercent.toFixed(2)}%</strong></div><div><span>Max DD</span><strong>{inr(result.summary.maxDrawdown)}</strong></div><div><span>Win rate</span><strong>{result.summary.winRatePercent.toFixed(1)}%</strong></div></div>
            <ResultChart result={result} />
            <div className="button-row"><button className="secondary-button" type="button" onClick={() => downloadText('dokimi-backtest.csv', resultCsv(result), 'text/csv')}><Download size={14} /> CSV</button><button className="secondary-button" type="button" onClick={() => downloadText('dokimi-backtest.json', JSON.stringify(result, null, 2), 'application/json')}><Download size={14} /> JSON + manifest</button></div>
            <div className="comparison-control"><label>Compare with<select value={comparisonId} onChange={(event) => setComparisonId(event.target.value)}><option value="">No comparison</option>{savedRuns.filter((value) => value.result.manifest.datasetHash !== result.manifest.datasetHash || value.savedAt !== savedRuns[0]?.savedAt).map((value) => <option key={value.id} value={value.id}>{value.name} · {new Date(value.savedAt).toLocaleString('en-IN')}</option>)}</select></label>{comparison && <div className="comparison-deltas"><span>P&amp;L Δ <strong>{inr(result.summary.netPnl - comparison.result.summary.netPnl)}</strong></span><span>ROI Δ <strong>{(result.summary.roiPercent - comparison.result.summary.roiPercent).toFixed(2)} pts</strong></span><span>MDD Δ <strong>{inr(result.summary.maxDrawdown - comparison.result.summary.maxDrawdown)}</strong></span></div>}</div>
          </> : <div className="workspace-empty">Configure the strategy and run it against the selected dataset.</div>}
        </article>
      </section>
      {result && <section className="workspace-panel"><div className="panel-title"><span>Trade audit</span><small>{result.summary.tradeCount} TRADES · {result.summary.excludedSessions} EXCLUDED</small></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Expiry</th><th>Strike</th><th>Call</th><th>Put</th><th>Costs</th><th>Net P&amp;L</th><th>Exit</th></tr></thead><tbody>{result.trades.map((trade) => <tr key={trade.id}><td>{trade.date}</td><td>{trade.expiry}</td><td>{trade.strike}</td><td>{trade.callEntry} → {trade.callExit}</td><td>{trade.putEntry} → {trade.putExit}</td><td>{inr(trade.costs)}</td><td className={trade.netPnl >= 0 ? 'positive' : 'negative'}>{inr(trade.netPnl)}</td><td>{trade.exitReason.replaceAll('_', ' ')}</td></tr>)}</tbody></table></div><div className="manifest-row"><span>Engine {result.manifest.engineVersion}</span><span>Dataset {result.manifest.datasetHash.slice(0, 12)}</span><span>{result.manifest.fillPolicy}</span><span>{result.manifest.timezone}</span></div>{result.warnings.map((warning) => <p className="result-warning" key={warning}>{warning}</p>)}</section>}
    </div>
  );
}
