export interface PaperLeg {
  id: string;
  symbol: string;
  expiry: string;
  strike: number;
  optionType: 'CE' | 'PE';
  side: 'buy' | 'sell';
  quantity: number;
  entryPrice: number;
  markPrice: number;
  openedAt: string;
}

export interface PaperFill extends PaperLeg {
  exitedAt: string;
  exitPrice: number;
  realizedPnl: number;
}

const KEY = 'dokimi:paper-positions';
const FILLS_KEY = 'dokimi:paper-fills';
export const PAPER_EVENT = 'dokimi-paper-updated';

export function readPaperPositions(): PaperLeg[] {
  try { return JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as PaperLeg[]; } catch { return []; }
}

export function writePaperPositions(positions: PaperLeg[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(positions));
  window.dispatchEvent(new Event(PAPER_EVENT));
}

export function appendPaperPositions(positions: PaperLeg[]): void {
  writePaperPositions([...readPaperPositions(), ...positions]);
}

export function readPaperFills(): PaperFill[] {
  try { return JSON.parse(window.localStorage.getItem(FILLS_KEY) ?? '[]') as PaperFill[]; } catch { return []; }
}

export function appendPaperFill(fill: PaperFill): void {
  window.localStorage.setItem(FILLS_KEY, JSON.stringify([fill, ...readPaperFills()].slice(0, 500)));
}
