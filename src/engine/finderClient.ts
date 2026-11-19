import type { Dataset, Settings } from '../data/schema.ts';
import { findTrades, type FinderQuery, type TeamOffers } from './finder.ts';
import type { FinderRequest } from './finder.worker.ts';
import type { Values } from './model.ts';
import type { SimResult } from './sim.ts';
import { workerClient } from './workerClient.ts';

// Runs findTrades in a worker (audit PERF-3) so typing and tagging never freeze the page. The page
// keeps only the newest answer; older ones are dropped by the caller's key check.

export interface FindJob { ds: Dataset; version: number; ramp: boolean; settings: Settings; sim: SimResult | null; q: FinderQuery; V: Values }

let sentDs: Dataset | null = null; // the dataset the worker holds: sent once, not with every search
const client = workerClient<FinderRequest, TeamOffers[]>(() => new Worker(new URL('./finder.worker.ts', import.meta.url), { type: 'module' }), 'Finder', () => { sentDs = null; });

export function findTradesAsync(job: FindJob): Promise<TeamOffers[]> {
  if (sentDs !== job.ds && client.send({ kind: 'data', ds: job.ds } satisfies FinderRequest)) sentDs = job.ds;
  return client.call({ kind: 'find', version: job.version, ramp: job.ramp, settings: job.settings, sim: job.sim, q: job.q }, () => findTrades(job.V, job.q));
}
