import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, XCircle } from 'lucide-react';
import { apiRequest } from '../services/api';
import {
  appendPaperFill, PAPER_EVENT, readPaperFills, readPaperPositions, writePaperPositions,
  type PaperFill, type PaperLeg,
} from '../services/paper-store';
import { StatusNotice, WorkspaceHeading } from './WorkspaceShell';

interface ChainStrike {
  strikePrice: number;
  call: { market: { ltp: number } } | null;
  put: { market: { ltp: number } } | null;
}

function inr(value: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(value);
}

function legPnl(position: PaperLeg): number {
  return (position.markPrice - position.entryPrice) * position.quantity * (position.side === 'buy' ? 1 : -1);
}

export function PaperPortfolio() {
  const [positions, setPositions] = useState<PaperLeg[]>(readPaperPositions);
  const [fills, setFills] = useState<PaperFill[]>(readPaperFills);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastMark, setLastMark] = useState('');
  const [pendingExitId, setPendingExitId] = useState('');

  useEffect(() => {
    const sync = () => setPositions(readPaperPositions());
    window.addEventListener(PAPER_EVENT, sync);
    return () => window.removeEventListener(PAPER_EVENT, sync);
  }, []);

  const persist = useCallback((next: PaperLeg[]) => {
    setPositions(next);
    writePaperPositions(next);
  }, []);
  const totalPnl = useMemo(() => positions.reduce((sum, leg) => sum + legPnl(leg), 0), [positions]);
  const realizedPnl = useMemo(() => fills.reduce((sum, fill) => sum + fill.realizedPnl, 0), [fills]);
  const exposure = useMemo(() => positions.reduce((sum, leg) => sum + leg.entryPrice * leg.quantity, 0), [positions]);

  const refresh = useCallback(async () => {
    if (!positions.length) return;
    setRefreshing(true);
    setError('');
    try {
      const groups = [...new Set(positions.map((position) => `${position.symbol}|${position.expiry}`))];
      const responses = await Promise.all(groups.map(async (group) => {
        const [symbol, expiry] = group.split('|');
        const value = await apiRequest<{ strikes: ChainStrike[] }>(`/v1/demo/market/option-chain?symbol=${symbol}&expiry=${expiry}`);
        return { group, strikes: value.strikes };
      }));
      const byGroup = new Map(responses.map((response) => [response.group, response.strikes]));
      const next = positions.map((position) => {
        const strike = byGroup.get(`${position.symbol}|${position.expiry}`)?.find((row) => row.strikePrice === position.strike);
        const mark = position.optionType === 'CE' ? strike?.call?.market.ltp : strike?.put?.market.ltp;
        return mark === undefined ? position : { ...position, markPrice: mark };
      });
      persist(next);
      setLastMark(new Date().toISOString());
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to refresh paper marks.');
    } finally {
      setRefreshing(false);
    }
  }, [persist, positions]);

  useEffect(() => {
    if (!positions.length) return undefined;
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [positions.length, refresh]);

  const exitPosition = (position: PaperLeg) => {
    if (pendingExitId !== position.id) {
      setPendingExitId(position.id);
      return;
    }
    const fill: PaperFill = {
      ...position,
      exitedAt: new Date().toISOString(),
      exitPrice: position.markPrice,
      realizedPnl: legPnl(position),
    };
    appendPaperFill(fill);
    setFills(readPaperFills());
    persist(positions.filter((value) => value.id !== position.id));
    setPendingExitId('');
  };

  const markAgeSeconds = lastMark ? Math.max(0, Math.floor((Date.now() - new Date(lastMark).getTime()) / 1000)) : null;
  return (
    <div className="workspace-page">
      <WorkspaceHeading eyebrow="Risk-free execution" title="Paper Portfolio" description="Monitor locally durable paper positions with provider marks. Live broker execution is disabled by design." actions={<button className="secondary-button" type="button" disabled={!positions.length || refreshing} onClick={() => void refresh()}><RefreshCw size={15} className={refreshing ? 'spin' : ''} /> {refreshing ? 'Refreshing' : 'Refresh marks'}</button>} />
      <StatusNotice tone={error ? 'danger' : 'neutral'} title={error ? 'MARK REFRESH FAILED' : 'NO LIVE ORDERS'}>{error || (lastMark ? `Provider marks received ${new Date(lastMark).toLocaleTimeString('en-IN')} (${markAgeSeconds ?? 0}s ago). Open positions refresh every 15 seconds.` : 'Positions remain local and paper-only. Open positions refresh provider marks every 15 seconds.')}</StatusNotice>
      <section className="metric-strip portfolio-metrics"><div><span>Open positions</span><strong>{positions.length}</strong></div><div><span>Premium exposure</span><strong>{inr(exposure)}</strong></div><div><span>Unrealized P&amp;L</span><strong className={totalPnl >= 0 ? 'positive' : 'negative'}>{inr(totalPnl)}</strong></div><div><span>Realized P&amp;L</span><strong className={realizedPnl >= 0 ? 'positive' : 'negative'}>{inr(realizedPnl)}</strong></div></section>
      <section className="workspace-panel"><div className="panel-title"><span>Open option legs</span><small>LOCAL PORTFOLIO · PAPER</small></div>{positions.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Opened</th><th>Contract</th><th>Side</th><th>Quantity</th><th>Entry</th><th>Mark</th><th>P&amp;L</th><th /></tr></thead><tbody>{positions.map((position) => { const pnl = legPnl(position); const confirming = pendingExitId === position.id; return <tr key={position.id}><td>{new Date(position.openedAt).toLocaleString('en-IN')}</td><td><strong>{position.symbol} {position.expiry} {position.strike} {position.optionType}</strong></td><td><span className={`side-pill ${position.side}`}>{position.side.toUpperCase()}</span></td><td>{position.quantity}</td><td>{position.entryPrice.toFixed(2)}</td><td>{position.markPrice.toFixed(2)}</td><td className={pnl >= 0 ? 'positive' : 'negative'}>{inr(pnl)}</td><td><button className={confirming ? 'danger-button compact-button' : 'icon-button'} type="button" aria-label={confirming ? `Confirm exit ${position.strike} ${position.optionType}` : `Exit ${position.strike} ${position.optionType}`} onClick={() => exitPosition(position)}>{confirming ? 'Confirm exit' : <XCircle size={15} />}</button></td></tr>; })}</tbody></table></div> : <div className="workspace-empty">No open paper positions. Add a strategy from Live Builder.</div>}</section>
      <section className="workspace-panel"><div className="panel-title"><span>Closed paper fills</span><small>{fills.length} FILLS</small></div>{fills.length ? <div className="data-table-wrap"><table className="data-table"><thead><tr><th>Exited</th><th>Contract</th><th>Side</th><th>Entry</th><th>Exit</th><th>Realized P&amp;L</th></tr></thead><tbody>{fills.slice(0, 100).map((fill) => <tr key={`${fill.id}-${fill.exitedAt}`}><td>{new Date(fill.exitedAt).toLocaleString('en-IN')}</td><td>{fill.symbol} {fill.expiry} {fill.strike} {fill.optionType}</td><td>{fill.side.toUpperCase()}</td><td>{fill.entryPrice.toFixed(2)}</td><td>{fill.exitPrice.toFixed(2)}</td><td className={fill.realizedPnl >= 0 ? 'positive' : 'negative'}>{inr(fill.realizedPnl)}</td></tr>)}</tbody></table></div> : <div className="workspace-empty compact">No paper exits have been recorded.</div>}</section>
    </div>
  );
}
