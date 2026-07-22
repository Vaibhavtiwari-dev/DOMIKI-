import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save } from 'lucide-react';
import { apiRequest } from '../services/api';
import { appendPaperPositions } from '../services/paper-store';
import { StatusNotice, WorkspaceHeading } from './WorkspaceShell';

interface OptionSide { instrumentKey: string; market: { ltp: number; volume: number; openInterest: number; bidPrice: number; askPrice: number }; greeks: { delta: number; gamma: number; theta: number; vega: number; impliedVolatility: number } }
interface ChainStrike { expiry: string; strikePrice: number; underlyingSpotPrice: number; pcr: number | null; call: OptionSide | null; put: OptionSide | null; }
interface BuilderLeg { id: string; strike: number; optionType: 'CE' | 'PE'; side: 'buy' | 'sell'; quantity: number; price: number; }

function inr(value: number): string { return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(value); }

function Payoff({ legs, spot }: { legs: BuilderLeg[]; spot: number }) {
  if (legs.length === 0 || !spot) return <div className="workspace-empty compact">Add option legs to calculate expiry payoff.</div>;
  const points = Array.from({ length: 61 }, (_, index) => spot * (0.85 + index * 0.005));
  const values = points.map((price) => legs.reduce((sum, leg) => { const intrinsic = leg.optionType === 'CE' ? Math.max(0, price - leg.strike) : Math.max(0, leg.strike - price); const value = (intrinsic - leg.price) * leg.quantity * (leg.side === 'buy' ? 1 : -1); return sum + value; }, 0));
  const min = Math.min(...values); const max = Math.max(...values); const spread = max - min || 1;
  const path = values.map((value, index) => `${index ? 'L' : 'M'} ${(index / (values.length - 1) * 1000).toFixed(2)} ${(220 - (value - min) / spread * 190).toFixed(2)}`).join(' ');
  const zeroY = 220 - (0 - min) / spread * 190;
  return <div className="payoff-wrap"><svg viewBox="0 0 1000 240" className="payoff-chart" role="img" aria-label="Option strategy payoff at expiry"><line x1="0" x2="1000" y1={zeroY} y2={zeroY} /><path d={path} /></svg><div className="payoff-labels"><span>{inr(min)}</span><span>Spot {spot.toLocaleString('en-IN')}</span><span>{inr(max)}</span></div></div>;
}

export function LiveBuilder() {
  const [symbol, setSymbol] = useState('NIFTY');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [lotSizes, setLotSizes] = useState<Record<string, number | null>>({});
  const [expiry, setExpiry] = useState('');
  const [chain, setChain] = useState<ChainStrike[]>([]);
  const [legs, setLegs] = useState<BuilderLeg[]>([]);
  const [status, setStatus] = useState<'loading' | 'live' | 'unavailable'>('loading');
  const [error, setError] = useState('');
  const [receivedAt, setReceivedAt] = useState('');
  const lotSize = lotSizes[expiry] ?? 0;
  const spot = chain[0]?.underlyingSpotPrice ?? 0;
  const netPremium = useMemo(() => legs.reduce((sum, leg) => sum + leg.price * leg.quantity * (leg.side === 'sell' ? 1 : -1), 0), [legs]);

  useEffect(() => {
    let cancelled = false; setStatus('loading'); setError(''); setChain([]); setExpiry(''); setLegs([]);
    void apiRequest<{ expiries: string[]; lotSizeByExpiry: Record<string, number | null> }>(`/v1/demo/market/expiries?symbol=${symbol}`)
      .then((value) => { if (!cancelled) { setExpiries(value.expiries); setLotSizes(value.lotSizeByExpiry); setExpiry(value.expiries[0] ?? ''); if (!value.expiries.length) { setStatus('unavailable'); setError('The provider returned no active expiries.'); } } })
      .catch((caughtError) => { if (!cancelled) { setExpiries([]); setStatus('unavailable'); setError(caughtError instanceof Error ? caughtError.message : 'Expiry data is unavailable.'); } });
    return () => { cancelled = true; };
  }, [symbol]);

  const refresh = useCallback(async () => {
    if (!expiry) return;
    try {
      const value = await apiRequest<{ strikes: ChainStrike[]; receivedAt: string }>(`/v1/demo/market/option-chain?symbol=${symbol}&expiry=${expiry}`);
      setChain(value.strikes); setReceivedAt(value.receivedAt); setStatus('live'); setError('');
    } catch (caughtError) { setStatus('unavailable'); setError(caughtError instanceof Error ? caughtError.message : 'Option chain is unavailable.'); }
  }, [expiry, symbol]);
  useEffect(() => { void refresh(); if (!expiry) return undefined; const timer = window.setInterval(() => void refresh(), 15_000); return () => window.clearInterval(timer); }, [expiry, refresh]);

  const visibleChain = useMemo(() => { if (!spot) return chain.slice(0, 24); const ordered = [...chain].sort((left, right) => Math.abs(left.strikePrice - spot) - Math.abs(right.strikePrice - spot)).slice(0, 24); return ordered.sort((a, b) => a.strikePrice - b.strikePrice); }, [chain, spot]);
  const addLeg = (row: ChainStrike, optionType: 'CE' | 'PE', side: 'buy' | 'sell') => { const option = optionType === 'CE' ? row.call : row.put; if (!option || !lotSize) return; setLegs((current) => [...current, { id: crypto.randomUUID(), strike: row.strikePrice, optionType, side, quantity: lotSize, price: option.market.ltp }]); };
  const savePaper = () => { appendPaperPositions(legs.map((leg) => ({ ...leg, symbol, expiry, entryPrice: leg.price, markPrice: leg.price, openedAt: new Date().toISOString() }))); setLegs([]); };

  return <div className="workspace-page"><WorkspaceHeading eyebrow="Exchange-backed workspace" title="Live Strategy Builder" description="Build multi-leg paper positions from the provider option chain. Refreshes every 15 seconds; no order can reach a broker." actions={<button className="secondary-button" type="button" disabled={!expiry} onClick={() => void refresh()}><RefreshCw size={15} /> Refresh</button>} />
    {error ? <StatusNotice tone="danger" title="LIVE DATA UNAVAILABLE">{error} Configure a valid read-only Upstox Analytics Token on the backend. No modeled chain is substituted.</StatusNotice> : <StatusNotice tone={status === 'live' ? 'good' : 'neutral'} title={status === 'live' ? 'LIVE OPTION CHAIN' : 'CONNECTING'}>{receivedAt ? `Provider snapshot received ${new Date(receivedAt).toLocaleTimeString('en-IN')}.` : 'Resolving active expiries and contracts.'}</StatusNotice>}
    <section className="builder-controls workspace-panel"><label>Underlying<select value={symbol} onChange={(event) => setSymbol(event.target.value)}><option>NIFTY</option><option>BANKNIFTY</option><option>FINNIFTY</option><option>MIDCPNIFTY</option><option>SENSEX</option><option>BANKEX</option></select></label><label>Expiry<select value={expiry} disabled={!expiries.length} onChange={(event) => { setExpiry(event.target.value); setLegs([]); }}><option value="">Select expiry</option>{expiries.map((value) => <option key={value}>{value}</option>)}</select></label><div><span>Lot size</span><strong>{lotSize || '—'}</strong></div><div><span>Spot</span><strong>{spot ? spot.toLocaleString('en-IN') : '—'}</strong></div></section>
    <section className="workspace-grid builder-grid"><article className="workspace-panel"><div className="panel-title"><span>Option chain</span><small>{visibleChain.length} STRIKES</small></div>{visibleChain.length ? <div className="data-table-wrap"><table className="data-table option-chain-table"><thead><tr><th>Call OI / Vol</th><th>Call IV / Δ</th><th>Call LTP</th><th>Call</th><th>Strike</th><th>Put</th><th>Put LTP</th><th>Put IV / Δ</th><th>Put OI / Vol</th></tr></thead><tbody>{visibleChain.map((row) => <tr key={row.strikePrice} className={Math.abs(row.strikePrice - spot) <= Math.max(1, spot * 0.001) ? 'atm-row' : ''}><td>{row.call ? `${row.call.market.openInterest.toLocaleString('en-IN')} / ${row.call.market.volume.toLocaleString('en-IN')}` : '—'}</td><td>{row.call ? `${row.call.greeks.impliedVolatility.toFixed(1)}% / ${row.call.greeks.delta.toFixed(2)}` : '—'}</td><td title={row.call ? `Bid ${row.call.market.bidPrice} · Ask ${row.call.market.askPrice}` : undefined}>{row.call?.market.ltp.toFixed(2) ?? '—'}</td><td><button className="chain-action sell" type="button" disabled={!row.call} onClick={() => addLeg(row, 'CE', 'sell')}>SELL</button><button className="chain-action buy" type="button" disabled={!row.call} onClick={() => addLeg(row, 'CE', 'buy')}>BUY</button></td><td><strong>{row.strikePrice}</strong></td><td><button className="chain-action buy" type="button" disabled={!row.put} onClick={() => addLeg(row, 'PE', 'buy')}>BUY</button><button className="chain-action sell" type="button" disabled={!row.put} onClick={() => addLeg(row, 'PE', 'sell')}>SELL</button></td><td title={row.put ? `Bid ${row.put.market.bidPrice} · Ask ${row.put.market.askPrice}` : undefined}>{row.put?.market.ltp.toFixed(2) ?? '—'}</td><td>{row.put ? `${row.put.greeks.impliedVolatility.toFixed(1)}% / ${row.put.greeks.delta.toFixed(2)}` : '—'}</td><td>{row.put ? `${row.put.market.openInterest.toLocaleString('en-IN')} / ${row.put.market.volume.toLocaleString('en-IN')}` : '—'}</td></tr>)}</tbody></table></div> : <div className="workspace-empty">{status === 'loading' ? 'Loading provider contracts…' : 'No exchange-backed strikes are available.'}</div>}</article>
      <article className="workspace-panel strategy-ticket"><div className="panel-title"><span>Strategy ticket</span><small>PAPER</small></div>{legs.length === 0 ? <div className="workspace-empty compact">Add legs from the option chain.</div> : <><div className="position-list">{legs.map((leg) => <div className="position-row" key={leg.id}><span className={`side-pill ${leg.side}`}>{leg.side.toUpperCase()}</span><strong>{leg.strike} {leg.optionType}</strong><label className="ticket-quantity"><span className="sr-only">Quantity for {leg.strike} {leg.optionType}</span><input type="number" min={lotSize} step={lotSize} value={leg.quantity} onChange={(event) => setLegs((current) => current.map((value) => value.id === leg.id ? { ...value, quantity: Math.max(lotSize, Number(event.target.value) || lotSize) } : value))} /></label><span>@ {leg.price.toFixed(2)}</span><button className="text-action" type="button" onClick={() => setLegs((current) => current.filter((value) => value.id !== leg.id))}>Remove</button></div>)}</div><div className="ticket-summary"><span>Net premium</span><strong className={netPremium >= 0 ? 'positive' : 'negative'}>{inr(netPremium)}</strong></div></>}<Payoff legs={legs} spot={spot} /><button className="primary-button full-button" type="button" disabled={!legs.length} onClick={savePaper}><Save size={15} /> Add to paper portfolio</button></article></section>
  </div>;
}
