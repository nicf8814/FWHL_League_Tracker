import { runAuctionJob, type AuctionRequest } from './auctionJobs.ts';
import type { Auction, SimOut } from './mockAuction.ts';
import { newestOnly, workerClient } from './workerClient.ts';

// Mock auctions in a worker, so the Board and the Mock draft never freeze while they run. Callers keep
// only the newest answer (see useLatest in the pages): a bid typed while a run is going supersedes it.

type Result = SimOut | Auction | { auction: Auction; freq: Map<string, number> };
const client = workerClient<AuctionRequest, Result>(() => new Worker(new URL('./auction.worker.ts', import.meta.url), { type: 'module' }), 'Mock auction');
const run = (req: AuctionRequest) => client.call(req, () => runAuctionJob(req));

type Of<K extends AuctionRequest['kind']> = Omit<Extract<AuctionRequest, { kind: K }>, 'kind'>;
export const boardOdds = newestOnly((req: Of<'board'>) => run({ kind: 'board', ...req }) as Promise<SimOut>);
export const mockAuction = (req: Of<'one'>) => run({ kind: 'one', ...req }) as Promise<Auction>;
export const typicalAuction = (req: Of<'typical'>) => run({ kind: 'typical', ...req }) as Promise<{ auction: Auction; freq: Map<string, number> }>;
