import { useMemo, useState } from 'react';
import { Layers3, Plus, Play, Trash2 } from 'lucide-react';
import type { ResearchResult } from '../services/option-engine';
import { StatusNotice, WorkspaceHeading } from './WorkspaceShell';

interface BasketItem { id: string; name: string; multiplier: number; selected: boolean; netPnl: number; maxDrawdown: number; }
interface Basket { id: string; name: string; capital: number; stopLoss: number; target: number; items: BasketItem[]; updatedAt: string; }

function readBaskets(): Basket[] {
  try { return JSON.parse(window.localStorage.getItem('dokimi:baskets') ?? '[]') as Basket[]; } catch { return []; }
}

function lastResult(): ResearchResult | null {
  try { return JSON.parse(window.localStorage.getItem('dokimi:last-research-result') ?? 'null') as ResearchResult | null; } catch { return null; }
}

function inr(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value); }

export function BasketManager() {
  const [baskets, setBaskets] = useState<Basket[]>(readBaskets);
  const [activeId, setActiveId] = useState(baskets[0]?.id ?? '');
  const [runAt, setRunAt] = useState('');
  const active = baskets.find((basket) => basket.id === activeId) ?? null;
  const persist = (next: Basket[]) => { setBaskets(next); window.localStorage.setItem('dokimi:baskets', JSON.stringify(next)); };
  const updateActive = (change: (basket: Basket) => Basket) => {
    persist(baskets.map((basket) => basket.id === activeId ? { ...change(basket), updatedAt: new Date().toISOString() } : basket));
  };
  const create = () => { const id = crypto.randomUUID(); const basket: Basket = { id, name: `Research Basket ${baskets.length + 1}`, capital: 1_000_000, stopLoss: 50_000, target: 100_000, items: [], updatedAt: new Date().toISOString() }; persist([...baskets, basket]); setActiveId(id); };
  const addLatest = () => { const result = lastResult(); if (!result || !active) return; updateActive((basket) => ({ ...basket, items: [...basket.items, { id: crypto.randomUUID(), name: `Research run ${basket.items.length + 1}`, multiplier: 1, selected: true, netPnl: result.summary.netPnl, maxDrawdown: result.summary.maxDrawdown }] })); };
  const totals = useMemo(() => active?.items.filter((item) => item.selected).reduce((value, item) => ({ pnl: value.pnl + item.netPnl * item.multiplier, drawdown: value.drawdown + item.maxDrawdown * item.multiplier }), { pnl: 0, drawdown: 0 }) ?? { pnl: 0, drawdown: 0 }, [active]);
  const run = () => setRunAt(new Date().toISOString());

  return <div className="workspace-page">
    <WorkspaceHeading eyebrow="Portfolio research" title="Basket Manager" description="Combine completed research runs under shared capital and risk limits. Basket state is stored locally for the zero-cost alpha." actions={<button className="primary-button" type="button" onClick={create}><Plus size={15} /> New basket</button>} />
    <StatusNotice tone="neutral" title="LOCAL-FIRST STORAGE">Baskets persist in this browser. Cloud sync becomes available when the authenticated D1 backend is deployed.</StatusNotice>
    <section className="basket-layout">
      <aside className="workspace-panel basket-list"><div className="panel-title"><span>Baskets</span><small>{baskets.length}</small></div>{baskets.length === 0 ? <div className="workspace-empty compact">Create your first basket.</div> : baskets.map((basket) => <button type="button" className={basket.id === activeId ? 'basket-card active' : 'basket-card'} key={basket.id} onClick={() => setActiveId(basket.id)}><Layers3 size={16} /><span><strong>{basket.name}</strong><small>{basket.items.length} strategies</small></span></button>)}</aside>
      <div className="workspace-panel basket-detail">{active ? <>
        <div className="panel-title"><input className="title-input" value={active.name} onChange={(event) => updateActive((basket) => ({ ...basket, name: event.target.value }))} /><button className="icon-button danger" type="button" aria-label="Delete basket" onClick={() => { const next = baskets.filter((basket) => basket.id !== active.id); persist(next); setActiveId(next[0]?.id ?? ''); }}><Trash2 size={16} /></button></div>
        <div className="form-grid basket-config"><label>Shared capital<input type="number" min="0" value={active.capital} onChange={(event) => updateActive((basket) => ({ ...basket, capital: Number(event.target.value) }))} /></label><label>Basket stop-loss<input type="number" min="0" value={active.stopLoss} onChange={(event) => updateActive((basket) => ({ ...basket, stopLoss: Number(event.target.value) }))} /></label><label>Basket target<input type="number" min="0" value={active.target} onChange={(event) => updateActive((basket) => ({ ...basket, target: Number(event.target.value) }))} /></label></div>
        <div className="button-row"><button className="secondary-button" type="button" disabled={!lastResult()} onClick={addLatest}><Plus size={14} /> Add latest backtest</button><button className="primary-button" type="button" disabled={active.items.length === 0} onClick={run}><Play size={14} /> Run all</button></div>
        <div className="metric-strip"><div><span>Aggregate P&amp;L</span><strong>{inr(totals.pnl)}</strong></div><div><span>Summed drawdown</span><strong>{inr(totals.drawdown)}</strong></div><div><span>Return on capital</span><strong>{active.capital ? (totals.pnl / active.capital * 100).toFixed(2) : '0.00'}%</strong></div><div><span>Risk state</span><strong>{totals.pnl <= -active.stopLoss ? 'STOPPED' : totals.pnl >= active.target ? 'TARGET' : 'OPEN'}</strong></div></div>
        {runAt && <p className="panel-footnote">Portfolio scenario calculated at {new Date(runAt).toLocaleString('en-IN')}. Drawdown is conservative summed MDD until aligned daily series are imported.</p>}
        <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Use</th><th>Strategy</th><th>Multiplier</th><th>P&amp;L</th><th>MDD</th><th /></tr></thead><tbody>{active.items.map((item) => <tr key={item.id}><td><input type="checkbox" checked={item.selected} aria-label={`Select ${item.name}`} onChange={(event) => updateActive((basket) => ({ ...basket, items: basket.items.map((candidate) => candidate.id === item.id ? { ...candidate, selected: event.target.checked } : candidate) }))} /></td><td>{item.name}</td><td><input className="table-number" type="number" min="1" max="100" value={item.multiplier} aria-label={`Multiplier for ${item.name}`} onChange={(event) => updateActive((basket) => ({ ...basket, items: basket.items.map((candidate) => candidate.id === item.id ? { ...candidate, multiplier: Number(event.target.value) } : candidate) }))} /></td><td>{inr(item.netPnl * item.multiplier)}</td><td>{inr(item.maxDrawdown * item.multiplier)}</td><td><button className="icon-button" type="button" aria-label={`Remove ${item.name}`} onClick={() => updateActive((basket) => ({ ...basket, items: basket.items.filter((candidate) => candidate.id !== item.id) }))}><Trash2 size={14} /></button></td></tr>)}</tbody></table></div>
      </> : <div className="workspace-empty">Select or create a basket.</div>}</div>
    </section>
  </div>;
}
