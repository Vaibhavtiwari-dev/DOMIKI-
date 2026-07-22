import { useEffect, useMemo, useState } from 'react';
import { Download, FileUp, Pause, Play, RotateCcw, StepForward } from 'lucide-react';
import { createSampleOptionDataset, parseOptionCsv, type OptionCandle, type OptionType } from '../services/option-engine';
import { downloadText } from '../services/export-engine';
import { StatusNotice, WorkspaceHeading } from './WorkspaceShell';

interface ReplayLeg { id: string; optionType: OptionType; side: 'buy' | 'sell'; strike: number; entryPrice: number; quantity: number; }
interface ReplayEvent { at: string; action: 'entry' | 'exit'; optionType: OptionType; side: 'buy' | 'sell'; strike: number; quantity: number; price: number; }

function inr(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value); }

export function HistoricalSimulator() {
  const [rows, setRows] = useState<OptionCandle[]>(() => createSampleOptionDataset());
  const dates = useMemo(() => [...new Set(rows.map((row) => row.timestamp.slice(0, 10)))].sort(), [rows]);
  const [date, setDate] = useState(dates[0] ?? '');
  const dayRows = useMemo(() => rows.filter((row) => row.timestamp.slice(0, 10) === date), [date, rows]);
  const times = useMemo(() => [...new Set(dayRows.map((row) => row.timestamp))].sort(), [dayRows]);
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [legs, setLegs] = useState<ReplayLeg[]>([]);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [source, setSource] = useState<'sample' | 'imported'>('sample');
  const currentTime = times[Math.min(step, Math.max(0, times.length - 1))];
  const currentRows = dayRows.filter((row) => row.timestamp === currentTime);
  const spot = currentRows[0]?.underlying ?? 0;
  const strikes = [...new Set(currentRows.map((row) => row.strike))].sort((a, b) => a - b);

  useEffect(() => {
    if (!playing || step >= times.length - 1) { if (step >= times.length - 1) setPlaying(false); return undefined; }
    const timer = window.setTimeout(() => setStep((value) => value + 1), 700);
    return () => window.clearTimeout(timer);
  }, [playing, step, times.length]);

  const importFile = async (file?: File) => {
    if (!file) return;
    const imported = parseOptionCsv(await file.text()); setRows(imported); setSource('imported'); setDate(imported[0]?.timestamp.slice(0, 10) ?? ''); setStep(0); setLegs([]); setEvents([]);
  };
  const addLeg = (optionType: OptionType, strike: number, side: 'buy' | 'sell') => {
    const candle = currentRows.find((row) => row.optionType === optionType && row.strike === strike);
    if (!candle) return;
    const leg = { id: crypto.randomUUID(), optionType, strike, side, entryPrice: candle.close, quantity: 50 };
    setLegs((current) => [...current, leg]);
    setEvents((current) => [...current, { at: currentTime ?? '', action: 'entry', optionType, side, strike, quantity: leg.quantity, price: candle.close }]);
  };
  const mark = (leg: ReplayLeg) => currentRows.find((row) => row.optionType === leg.optionType && row.strike === leg.strike)?.close ?? leg.entryPrice;
  const pnl = legs.reduce((sum, leg) => sum + (mark(leg) - leg.entryPrice) * leg.quantity * (leg.side === 'buy' ? 1 : -1), 0);
  const exitLeg = (leg: ReplayLeg) => {
    setEvents((current) => [...current, { at: currentTime ?? '', action: 'exit', optionType: leg.optionType, side: leg.side, strike: leg.strike, quantity: leg.quantity, price: mark(leg) }]);
    setLegs((current) => current.filter((value) => value.id !== leg.id));
  };
  const exportReplay = () => downloadText(`dokimi-replay-${date}.json`, JSON.stringify({ source, session: date, replayTime: currentTime, openLegs: legs, events }, null, 2), 'application/json');

  return <div className="workspace-page">
    <WorkspaceHeading eyebrow="Historical replay" title="Option Simulator" description="Replay imported option candles without future-data leakage. The timeline reveals only the selected timestamp and earlier observations." actions={<><label className="secondary-button file-button"><FileUp size={15} /> Import option CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void importFile(event.target.files?.[0])} /></label><button className="secondary-button" type="button" disabled={!events.length} onClick={exportReplay}><Download size={15} /> Replay JSON</button></>} />
    <StatusNotice tone={source === 'imported' ? 'good' : 'warning'} title={source === 'imported' ? 'USER-IMPORTED REPLAY' : 'SYNTHETIC REPLAY FIXTURE'}>{source === 'sample' ? 'Use this only to evaluate the workflow. Import historical option candles for research.' : `${rows.length.toLocaleString('en-IN')} rows are being replayed locally.`}</StatusNotice>
    <section className="simulator-toolbar workspace-panel"><label>Session<select value={date} onChange={(event) => { setDate(event.target.value); setStep(0); setLegs([]); setEvents([]); }}>{dates.map((value) => <option key={value}>{value}</option>)}</select></label><div className="replay-clock"><span>Replay time</span><strong>{currentTime ? new Date(currentTime).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' }) : '—'}</strong></div><div className="button-row"><button className="icon-button" type="button" aria-label="Reset replay" onClick={() => { setStep(0); setPlaying(false); setLegs([]); setEvents([]); }}><RotateCcw size={16} /></button><button className="secondary-button" type="button" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? 'Pause' : 'Auto-forward'}</button><button className="secondary-button" type="button" disabled={step >= times.length - 1} onClick={() => setStep((value) => Math.min(times.length - 1, value + 1))}><StepForward size={15} /> Next candle</button></div><input className="timeline" type="range" min="0" max={Math.max(0, times.length - 1)} value={Math.min(step, Math.max(0, times.length - 1))} onChange={(event) => { setPlaying(false); setStep(Number(event.target.value)); }} aria-label="Replay timeline" /></section>
    <section className="workspace-grid two-column simulator-grid"><article className="workspace-panel"><div className="panel-title"><span>Visible option chain</span><small>SPOT {spot.toLocaleString('en-IN')}</small></div><div className="data-table-wrap"><table className="data-table option-chain-table"><thead><tr><th>Call action</th><th>Call LTP</th><th>Strike</th><th>Put LTP</th><th>Put action</th></tr></thead><tbody>{strikes.slice(Math.max(0, Math.floor(strikes.length / 2) - 8), Math.floor(strikes.length / 2) + 9).map((strike) => { const call = currentRows.find((row) => row.strike === strike && row.optionType === 'CE'); const put = currentRows.find((row) => row.strike === strike && row.optionType === 'PE'); return <tr key={strike} className={Math.abs(strike - spot) <= 25 ? 'atm-row' : ''}><td><button type="button" className="chain-action sell" disabled={!call} onClick={() => addLeg('CE', strike, 'sell')}>SELL</button><button type="button" className="chain-action buy" disabled={!call} onClick={() => addLeg('CE', strike, 'buy')}>BUY</button></td><td>{call?.close.toFixed(2) ?? '—'}</td><td><strong>{strike}</strong></td><td>{put?.close.toFixed(2) ?? '—'}</td><td><button type="button" className="chain-action buy" disabled={!put} onClick={() => addLeg('PE', strike, 'buy')}>BUY</button><button type="button" className="chain-action sell" disabled={!put} onClick={() => addLeg('PE', strike, 'sell')}>SELL</button></td></tr>; })}</tbody></table></div></article><article className="workspace-panel"><div className="panel-title"><span>Replay positions</span><small>PAPER ONLY</small></div><div className="metric-strip"><div><span>Live replay P&amp;L</span><strong className={pnl >= 0 ? 'positive' : 'negative'}>{inr(pnl)}</strong></div><div><span>Open legs</span><strong>{legs.length}</strong></div></div>{legs.length === 0 ? <div className="workspace-empty compact">Add calls or puts from the visible chain.</div> : <div className="position-list">{legs.map((leg) => <div className="position-row" key={leg.id}><span className={`side-pill ${leg.side}`}>{leg.side.toUpperCase()}</span><strong>{leg.strike} {leg.optionType}</strong><label className="ticket-quantity"><span className="sr-only">Replay quantity for {leg.strike} {leg.optionType}</span><input type="number" min="1" value={leg.quantity} onChange={(event) => setLegs((current) => current.map((value) => value.id === leg.id ? { ...value, quantity: Math.max(1, Number(event.target.value) || 1) } : value))} /></label><span>{leg.entryPrice.toFixed(2)} → {mark(leg).toFixed(2)}</span><button className="text-action" type="button" onClick={() => exitLeg(leg)}>Exit</button></div>)}</div>}<p className="panel-footnote">The replay clock is deterministic and reveals no candles later than the selected timestamp. Entry and exit events are included in the replay export.</p></article></section>
  </div>;
}
