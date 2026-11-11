import type { Dataset, Settings } from '../data/schema.ts';
import type { SimResult } from './sim.ts';
import { findTrades, type FinderQuery } from './finder.ts';
import { buildIndex } from './league.ts';
import { baseKey, buildBase, buildValues, type Base, type Values } from './model.ts';

// The trade finder off the main thread (audit PERF-3). Values hold closures, so they can't be posted;
// the worker rebuilds them from the same inputs the page uses and keeps them until the version moves.

export type FinderRequest =
  | { kind: 'data'; ds: Dataset }
  | { kind: 'find'; id: number; version: number; ramp: boolean; settings: Settings; sim: SimResult | null; q: FinderQuery };

let ds: Dataset | null = null;
let base: Base | null = null;
let values: { version: number; v: Values } | null = null;

self.onmessage = (e: MessageEvent<FinderRequest>) => {
  const req = e.data;
  if (req.kind === 'data') {
    ds = req.ds; base = null; values = null;
    return;
  }
  try {
    if (!ds) throw new Error('Finder worker has no data yet');
    const opts = { median: req.settings.rampMedian, returns: req.settings.returnWeeks };
    if (!base || base.key !== baseKey(req.ramp, opts)) { base = buildBase(buildIndex(ds), req.ramp, opts); values = null; }
    if (!values || values.version !== req.version) values = { version: req.version, v: buildValues(base, req.settings, req.sim) };
    self.postMessage({ id: req.id, result: findTrades(values.v, req.q) });
  } catch (err) {
    self.postMessage({ id: req.id, error: err instanceof Error ? err.message : String(err) });
  }
};
