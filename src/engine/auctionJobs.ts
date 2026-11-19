import type { PrepRow } from './draftPrep.ts';
import { draftOutlook, liveTeam, simulateBoard, type Calib, type MockDials, type Nomination, type PlainTeam } from './mockAuction.ts';

// The mock-auction jobs, shared by the worker (auction.worker.ts) and the no-worker fallback: the Board's Get % (many auctions after every bid change) and the
// Mock draft's runs. Teams come in as plain data (PlainTeam) and are turned back into bidders here.

export type AuctionRequest =
  | { kind: 'board'; rows: PrepRow[]; teams: PlainTeam[]; myBids: Record<string, number>; runs: number; nomination?: Nomination; dials?: MockDials }
  | { kind: 'outlook'; pool: PrepRow[]; teams: PlainTeam[]; me: string | null; plan: Record<string, number>; run: number; n: number; nomination?: Nomination; calib: Calib; dials: MockDials };

export function runAuctionJob(req: AuctionRequest) {
  const teams = req.teams.map(liveTeam);
  switch (req.kind) {
    case 'board': return simulateBoard(req.rows, teams, req.myBids, req.runs, 7, req.nomination, req.dials);
    case 'outlook': return draftOutlook(req.pool, teams, req.me, req.plan, req.run, req.n, req.nomination, req.calib, req.dials);
  }
}

