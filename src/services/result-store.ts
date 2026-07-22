import type { ResearchConfiguration, ResearchResult } from './option-engine';

export interface SavedResearchRun {
  id: string;
  name: string;
  source: 'sample' | 'imported';
  datasetName: string;
  configuration: ResearchConfiguration;
  result: ResearchResult;
  savedAt: string;
}

const KEY = 'dokimi:research-runs';

export function readSavedRuns(): SavedResearchRun[] {
  try { return JSON.parse(window.localStorage.getItem(KEY) ?? '[]') as SavedResearchRun[]; } catch { return []; }
}

export function saveResearchRun(run: SavedResearchRun): void {
  const current = readSavedRuns();
  window.localStorage.setItem(KEY, JSON.stringify([run, ...current].slice(0, 100)));
}

export function deleteResearchRun(id: string): void {
  window.localStorage.setItem(KEY, JSON.stringify(readSavedRuns().filter((run) => run.id !== id)));
}
