import { oddsHistory, simulate, type SimInput, type SimResult } from './sim.ts';
import type { SimRequest } from './sim.worker.ts';
import { workerClient } from './workerClient.ts';

// Runs the season simulation off the main thread and caches it by its real inputs (audit PERF-1):
// schedule, results, team strength and sim config. Value sliders never change those, so moving a
// slider never reruns the sim.

type History = Record<number, Record<number, number>>;
const MAX_CACHE = 16;
const cache = new Map<string, Promise<SimResult | History>>();
const client = workerClient<SimRequest, SimResult | History>(() => new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' }), 'Simulation');

function run<T extends SimResult | History>(req: SimRequest): Promise<T> {
  const key = JSON.stringify(req);
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const p = client.call(req, () => (req.kind === 'odds' ? simulate(req.input) : oddsHistory(req.input, req.thru))) as Promise<T>;
  p.catch(() => cache.delete(key));
  cache.set(key, p);
  if (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value!);
  return p;
}

export const simulateOdds = (input: SimInput) => run<SimResult>({ kind: 'odds', input });
export const simulateHistory = (input: SimInput, thru: number) => run<History>({ kind: 'history', input, thru });
