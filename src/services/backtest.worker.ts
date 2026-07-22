import { runOptionBacktest, type OptionCandle, type ResearchConfiguration } from './option-engine';

interface RequestMessage {
  id: string;
  rows: OptionCandle[];
  configuration: ResearchConfiguration;
}

self.onmessage = (event: MessageEvent<RequestMessage>) => {
  const { id, rows, configuration } = event.data;
  void runOptionBacktest(rows, configuration)
    .then((result) => self.postMessage({ id, result }))
    .catch((error) => self.postMessage({ id, error: error instanceof Error ? error.message : 'Backtest failed.' }));
};

export {};
