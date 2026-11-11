import type { Dataset, Settings } from '../data/schema.ts';
import { findTrades, type FinderQuery, type TeamOffers } from './finder.ts';
import type { Values } from './model.ts';
import type { SimResult } from './sim.ts';

// Runs findTrades in a worker (audit PERF-3) so typing and tagging never freeze the page. The page
// keeps only the newest answer; older ones are dropped by the caller's key check.

export interface FindJob { ds: Dataset; version: number; ramp: boolean; settings: Settings; sim: SimResult | null; q: FinderQuery; V: Values }

const pending = new Map<number, { resolve: (v: TeamOffers[]) => void; reject: (e: Error) => void }>();
let worker: Worker | null = null;
let sentDs: Dataset | null = null;
let seq = 0;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./finder.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ id: number; result?: TeamOffers[]; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result!);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Finder worker failed'));
    pending.clear();
    worker?.terminate();
    worker = null;
    sentDs = null;
  };
  return worker;
}

export function findTradesAsync(job: FindJob): Promise<TeamOffers[]> {
  const w = getWorker();
  // shortcut: no Worker (old browsers, test runners) searches inline on the next frame and blocks while it runs.
  if (!w) return new Promise((r) => setTimeout(() => r(findTrades(job.V, job.q)), 16));
  if (sentDs !== job.ds) { w.postMessage({ kind: 'data', ds: job.ds }); sentDs = job.ds; }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ kind: 'find', id, version: job.version, ramp: job.ramp, settings: job.settings, sim: job.sim, q: job.q });
  });
}
