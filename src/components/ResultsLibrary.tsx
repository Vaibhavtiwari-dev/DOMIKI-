import { useMemo, useState } from 'react';
import { Download, Search, Trash2, X } from 'lucide-react';
import { downloadText, resultCsv } from '../services/export-engine';
import { deleteResearchRun, readSavedRuns, type SavedResearchRun } from '../services/result-store';
import type { ResearchTrade } from '../services/option-engine';
import { StatusNotice, WorkspaceHeading } from './WorkspaceShell';

function inr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(value);
}

export function ResultsLibrary() {
  const [runs, setRuns] = useState(readSavedRuns);
  const [selectedId, setSelectedId] = useState(runs[0]?.id ?? '');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<'all' | 'sample' | 'imported'>('all');
  const [trade, setTrade] = useState<ResearchTrade | null>(null);
  const filtered = useMemo(() => runs.filter((run) => {
    const matchesQuery = `${run.name} ${run.datasetName}`.toLowerCase().includes(query.trim().toLowerCase());
    return matchesQuery && (source === 'all' || run.source === source);
  }), [query, runs, source]);
  const selected = runs.find((run) => run.id === selectedId) ?? filtered[0] ?? null;

  const remove = (run: SavedResearchRun) => {
    deleteResearchRun(run.id);
    const next = runs.filter((value) => value.id !== run.id);
    setRuns(next);
    setSelectedId(next[0]?.id ?? '');
    setTrade(null);
  };

  return (
    <div className="workspace-page">
      <WorkspaceHeading eyebrow="Reproducible evidence" title="Results Library" description="Filter and inspect immutable local snapshots with their dataset hash, quality grade, assumptions, trades, warnings, and exports." />
      <StatusNotice tone="neutral" title="LOCAL RESULT VAULT">Up to 100 result snapshots are retained in this browser for the zero-cost alpha.</StatusNotice>
      <section className="result-filters workspace-panel" aria-label="Result filters">
        <label className="search-control"><Search size={14} aria-hidden="true" /><span className="sr-only">Search results</span><input value={query} placeholder="Search run or dataset" onChange={(event) => setQuery(event.target.value)} /></label>
        <label><span>Source</span><select value={source} onChange={(event) => setSource(event.target.value as typeof source)}><option value="all">All sources</option><option value="imported">Imported data</option><option value="sample">Synthetic fixture</option></select></label>
        <small>{filtered.length} of {runs.length} runs</small>
      </section>
      <section className="basket-layout">
        <aside className="workspace-panel basket-list">
          <div className="panel-title"><span>Saved runs</span><small>{filtered.length}</small></div>
          {filtered.length ? filtered.map((run) => (
            <button className={run.id === selected?.id ? 'basket-card active' : 'basket-card'} type="button" key={run.id} onClick={() => { setSelectedId(run.id); setTrade(null); }}>
              <span><strong>{run.name}</strong><small>{new Date(run.savedAt).toLocaleString('en-IN')} · {run.result.qualityGrade}</small></span>
            </button>
          )) : <div className="workspace-empty compact">No saved run matches these filters.</div>}
        </aside>
        <article className="workspace-panel">
          {selected ? <>
            <div className="panel-title"><span>{selected.name}</span><button className="icon-button danger" type="button" aria-label="Delete saved run" onClick={() => remove(selected)}><Trash2 size={15} /></button></div>
            <div className="metric-strip"><div><span>Net P&amp;L</span><strong>{inr(selected.result.summary.netPnl)}</strong></div><div><span>ROI</span><strong>{selected.result.summary.roiPercent.toFixed(2)}%</strong></div><div><span>Max DD</span><strong>{inr(selected.result.summary.maxDrawdown)}</strong></div><div><span>Quality</span><strong>{selected.result.qualityGrade}</strong></div></div>
            <div className="manifest-row"><span>{selected.source.toUpperCase()} · {selected.datasetName}</span><span>Engine {selected.result.manifest.engineVersion}</span><span>Dataset {selected.result.manifest.datasetHash.slice(0, 16)}</span><span>{selected.result.manifest.fillPolicy}</span></div>
            {selected.result.warnings.map((warning) => <p className="result-warning" key={warning}>{warning}</p>)}
            <div className="button-row result-actions"><button className="secondary-button" type="button" onClick={() => downloadText(`${selected.name}.csv`, resultCsv(selected.result), 'text/csv')}><Download size={14} /> CSV</button><button className="secondary-button" type="button" onClick={() => downloadText(`${selected.name}.json`, JSON.stringify(selected, null, 2), 'application/json')}><Download size={14} /> Complete JSON</button></div>
            <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Date</th><th>Expiry</th><th>Strike</th><th>Net P&amp;L</th><th>Exit</th><th /></tr></thead><tbody>{selected.result.trades.map((value) => <tr key={value.id}><td>{value.date}</td><td>{value.expiry}</td><td>{value.strike}</td><td className={value.netPnl >= 0 ? 'positive' : 'negative'}>{inr(value.netPnl)}</td><td>{value.exitReason.replaceAll('_', ' ')}</td><td><button className="text-action" type="button" aria-label={`Inspect trade ${value.date}`} onClick={() => setTrade(value)}>Inspect</button></td></tr>)}</tbody></table></div>
          </> : <div className="workspace-empty">Run a Quick Backtest to create evidence.</div>}
        </article>
      </section>
      {trade && <section className="workspace-panel trade-detail" aria-label="Trade audit detail"><div className="panel-title"><span>Trade audit · {trade.date}</span><button className="icon-button" type="button" aria-label="Close trade detail" onClick={() => setTrade(null)}><X size={15} /></button></div><div className="trade-detail-grid"><div><span>Contract</span><strong>{trade.expiry} · {trade.strike}</strong></div><div><span>Quantity</span><strong>{trade.quantity}</strong></div><div><span>Entry / exit</span><strong>{trade.entryTime} → {trade.exitTime}</strong></div><div><span>Call fill</span><strong>{trade.callEntry} → {trade.callExit}</strong></div><div><span>Put fill</span><strong>{trade.putEntry} → {trade.putExit}</strong></div><div><span>Costs / net</span><strong>{inr(trade.costs)} / {inr(trade.netPnl)}</strong></div></div><p className="panel-footnote">Exit resolution: {trade.exitReason.replaceAll('_', ' ')}. Fill behavior follows the run manifest shown above.</p></section>}
    </div>
  );
}
