import type { ResearchResult } from './option-engine';

function safeCell(value: unknown): string {
  const text = String(value ?? '');
  const neutralized = /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text;
  return `"${neutralized.replaceAll('"', '""')}"`;
}

export function resultCsv(result: ResearchResult): string {
  const headers = ['date','expiry','strike','quantity','callEntry','callExit','putEntry','putExit','grossPnl','costs','netPnl','exitReason'];
  const lines = [headers.map(safeCell).join(',')];
  for (const trade of result.trades) lines.push(headers.map((header) => safeCell(trade[header as keyof typeof trade])).join(','));
  return lines.join('\r\n');
}

export function downloadText(filename: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.replace(/[^a-zA-Z0-9._-]/gu, '_');
  anchor.click();
  URL.revokeObjectURL(url);
}
