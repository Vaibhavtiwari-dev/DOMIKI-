import type { OptionCandle, ResearchConfiguration, ResearchResult } from './option-engine';

export function runBacktestInWorker(
  rows: OptionCandle[],
  configuration: ResearchConfiguration,
): { promise: Promise<ResearchResult>; cancel: () => void } {
  const worker = new Worker(new URL('./backtest.worker.ts', import.meta.url), { type: 'module' });
  const id = crypto.randomUUID();
  const promise = new Promise<ResearchResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<{ id: string; result?: ResearchResult; error?: string }>) => {
      if (event.data.id !== id) return;
      worker.terminate();
      if (event.data.result) resolve(event.data.result);
      else reject(new Error(event.data.error ?? 'Backtest failed.'));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error('The browser backtest worker stopped unexpectedly.'));
    };
    worker.postMessage({ id, rows, configuration });
  });
  return { promise, cancel: () => worker.terminate() };
}
