import { oddsHistory, simulate, type SimInput, type SimResult } from './sim.ts';

// Runs the season simulation off the main thread and caches it by its real inputs (audit PERF-1):
// schedule, results, team strength and sim config. Value sliders never change those, so moving a
// slider never reruns the sim.

type History = Record<number, Record<number, number>>;
type Job = { kind: 'odds'; input: SimInput } | { kind: 'history'; input: SimInput; thru: number };
const MAX_CACHE = 16;
const cache = new Map<string, Promise<SimResult | History>>();
const pending = new Map<number, { resolve: (v: never) => void; reject: (e: Error) => void }>();
let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return null;
  }
  worker.onmessage = (e: MessageEvent<{ id: number; result?: never; error?: string }>) => {
    const p = pending.get(e.data.id);
    if (!p) return;
    pending.delete(e.data.id);
    if (e.data.error) p.reject(new Error(e.data.error));
    else p.resolve(e.data.result as never);
  };
  worker.onerror = (e) => {
    for (const p of pending.values()) p.reject(new Error(e.message || 'Simulation worker failed'));
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

function run<T extends SimResult | History>(req: Job): Promise<T> {
  const key = JSON.stringify(req);
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const w = getWorker();
  const p: Promise<T> = w
    ? new Promise<T>((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve: resolve as (v: never) => void, reject });
        w.postMessage({ ...req, id });
      })
    : // shortcut: no Worker (very old browsers, some test runners) runs inline and blocks for ~150 ms.
      Promise.resolve().then(() => (req.kind === 'odds' ? simulate(req.input) : oddsHistory(req.input, req.thru)) as T);
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return p;
}

export const simulateOdds = (input: SimInput) => run<SimResult>({ kind: 'odds', input });
export const simulateHistory = (input: SimInput, thru: number) => run<History>({ kind: 'history', input, thru });
