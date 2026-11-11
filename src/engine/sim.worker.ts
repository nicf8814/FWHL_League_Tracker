import { oddsHistory, simulate, type SimInput } from './sim.ts';

export type SimRequest = { id: number; kind: 'odds'; input: SimInput } | { id: number; kind: 'history'; input: SimInput; thru: number };

self.onmessage = (e: MessageEvent<SimRequest>) => {
  const req = e.data;
  try {
    const result = req.kind === 'odds' ? simulate(req.input) : oddsHistory(req.input, req.thru);
    self.postMessage({ id: req.id, result });
  } catch (err) {
    self.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};
