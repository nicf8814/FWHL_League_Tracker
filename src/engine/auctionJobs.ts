import type { PrepRow } from './draftPrep.ts';
import { liveTeam, mockOne, mockTypical, simulateBoard, type Calib, type MockDials, type Nomination, type PlainTeam } from './mockAuction.ts';

// The mock-auction jobs, shared by the worker (auction.worker.ts) and the no-worker fallback: the Board's Get % (many auctions after every bid change) and the
// Mock draft's runs. Teams come in as plain data (PlainTeam) and are turned back into bidders here.

export type AuctionRequest =
  | { kind: 'board'; rows: PrepRow[]; teams: PlainTeam[]; myBids: Record<string, number>; runs: number; nomination?: Nomination; dials?: MockDials }
  | { kind: 'one'; pool: PrepRow[]; teams: PlainTeam[]; run: number; nomination?: Nomination; calib: Calib; dials: MockDials }
  | { kind: 'typical'; pool: PrepRow[]; teams: PlainTeam[]; run: number; n: number; nomination?: Nomination; calib: Calib; dials: MockDials };

export function runAuctionJob(req: AuctionRequest) {
  const teams = req.teams.map(liveTeam);
  switch (req.kind) {
    case 'board': return simulateBoard(req.rows, teams, req.myBids, req.runs, 7, req.nomination, req.dials);
    case 'one': return mockOne(req.pool, teams, req.run, req.nomination, req.calib, req.dials);
    case 'typical': return mockTypical(req.pool, teams, req.run, req.n, req.nomination, req.calib, req.dials);
  }
}

