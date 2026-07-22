import type { ReactNode } from 'react';
import { Activity, Archive, BarChart3, BriefcaseBusiness, FlaskConical, Layers3, LogOut, Play, Radio } from 'lucide-react';

export type WorkspaceId = 'overview' | 'backtest' | 'results' | 'baskets' | 'simulator' | 'builder' | 'portfolio';

const ITEMS: Array<{ id: WorkspaceId; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Dashboard', icon: Activity },
  { id: 'backtest', label: 'Backtest', icon: BarChart3 },
  { id: 'results', label: 'Results', icon: Archive },
  { id: 'baskets', label: 'Baskets', icon: Layers3 },
  { id: 'simulator', label: 'Simulator', icon: Play },
  { id: 'builder', label: 'Live Builder', icon: FlaskConical },
  { id: 'portfolio', label: 'Paper Portfolio', icon: BriefcaseBusiness },
];

export function WorkspaceShell({
  active,
  onChange,
  onExit,
  children,
}: {
  active: WorkspaceId;
  onChange: (value: WorkspaceId) => void;
  onExit: () => void;
  children: ReactNode;
}) {
  return (
    <main className="terminal-app">
      <header className="terminal-header">
        <button type="button" className="terminal-brand" onClick={() => onChange('overview')} aria-label="Open dashboard">
          DOKIMI<span>.</span>
        </button>
        <nav className="terminal-nav" aria-label="Research workspaces">
          {ITEMS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" title={label} className={active === id ? 'active' : ''} aria-current={active === id ? 'page' : undefined} onClick={() => onChange(id)}>
              <Icon size={15} aria-hidden="true" /> {label}
            </button>
          ))}
        </nav>
        <div className="terminal-actions">
          <span className="paper-badge"><Radio size={13} aria-hidden="true" /> RESEARCH / PAPER</span>
          <button type="button" className="icon-button" onClick={onExit} aria-label="Exit research session"><LogOut size={17} /></button>
        </div>
      </header>
      <div className="terminal-content">{children}</div>
      <footer className="terminal-footer">
        Research and paper-trading workspace. Data source, freshness, assumptions, and model status are shown wherever results are used.
      </footer>
    </main>
  );
}

export function WorkspaceHeading({ eyebrow, title, description, actions }: { eyebrow: string; title: string; description: string; actions?: ReactNode }) {
  return (
    <section className="workspace-heading">
      <div><p className="workspace-eyebrow">{eyebrow}</p><h1>{title}</h1><p>{description}</p></div>
      {actions && <div className="workspace-actions">{actions}</div>}
    </section>
  );
}

export function StatusNotice({ tone = 'neutral', title, children }: { tone?: 'neutral' | 'good' | 'warning' | 'danger'; title: string; children: ReactNode }) {
  return <div className={`status-notice ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}><strong>{title}</strong><span>{children}</span></div>;
}
