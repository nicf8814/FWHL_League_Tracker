// Off-thread jobs: the mock-auction worker's jobs match the old on-page calls exactly, requests and
// answers survive the copy a worker message makes, and the newest-only queue drops stale requests.
// Run with `npm test`. (No Worker in Node, so workerClient runs jobs inline here: also checked.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DraftPrep, PrepPos } from '../data/draftPrep.ts';
import { playerKey } from '../data/drafts.ts';
import { runAuctionJob, type AuctionRequest } from './auctionJobs.ts';
import { priceBoard, type PrepRow } from './draftPrep.ts';
import { DEFAULT_DIALS, calibrate, poolOf, rng, runAuction, simulate, strategyBid, typicalPair, type Auction, type PlainTeam, type SimTeam } from './mockAuction.ts';
import { newestOnly, workerClient } from './workerClient.ts';

const tiers = () => ({ upTo: 999, label: 'All', factor: 1, n: 10 });
function tiny(): DraftPrep {
  const board: DraftPrep['board'] = [];
  for (const [pos, n, top] of [['QB', 30, 300], ['RB', 80, 250], ['WR', 80, 240], ['TE', 30, 180]] as [PrepPos, number, number][]) {
    for (let i = 0; i < n; i++) board.push([`${pos} ${i + 1}`, pos, 'XX', top - i * 4, Math.max(0, 40 - i * 2)]);
  }
  return {
    year: 2027, kind: 'board', teams: 12, budget: 200, roster: 13, source: 'test', board, keepers: [],
    fit: {
      marketYears: [[2026, 4]], tiers: { QB: [tiers()], RB: [tiers()], WR: [tiers()], TE: [tiers()] },
      projYears: [2018], shrink: { QB: 1, RB: 1, WR: 1, TE: 1 }, miss: { QB: 0.3, RB: 0.3, WR: 0.3, TE: 0.3 },
      flex: { years: [2025], flexRB: 0.5, flexWR: 0.4, flexTE: 0.1, recWR: 0.7, recTE: 0.3 },
      slotYears: [2025], slots: { QB: [[1, 999]], RB: [[1, 999]], WR: [[1, 999]], TE: [[1, 999]] },
    },
  };
}
const rows = priceBoard(tiny()).rows;
const pool = poolOf(rows);
const key = (r: PrepRow) => playerKey(r.name, r.pos);
const persona = (k: string, rb = 1) => ({ key: k, name: k, teamId: 0, lean: { QB: 1, RB: rb, WR: 1.1, TE: 0.9 }, overpay: 1, stars: 1.1, fav: [], drafts: 5 });
const others: PlainTeam[] = Array.from({ length: 11 }, (_, i) => ({ name: `T${i}`, budget: 200, filled: i === 3 ? { RB: 1 } : {}, persona: persona(`T${i}`, i === 0 ? 1.5 : 1) }));
const myBids: Record<string, number> = { 'RB 2|RB': 70, 'WR 3|WR': 40, 'TE 1|TE': 20 };
const dials = DEFAULT_DIALS;

// The Mock draft's teams the way the page built them before the worker: functions, not data.
function oldTeams(rest: 'plan' | 'balanced'): SimTeam[] {
  const me: SimTeam = { name: 'Me', budget: 200, filled: {}, persona: null, bid: (r) => myBids[key(r)] ?? (rest === 'plan' ? 1 : strategyBid(rest, r)), planned: new Set(Object.keys(myBids)), market: rest === 'plan' };
  return [me, ...others];
}
const newTeams = (rest: 'plan' | 'balanced'): PlainTeam[] => [{ name: 'Me', budget: 200, filled: {}, persona: null, bids: myBids, rest: rest === 'plan' ? 'one' : rest, market: rest === 'plan' }, ...others];
// What postMessage does to a request: a structured copy. It throws on a function, so this also proves
// the request is plain data.
const viaWorker = (req: AuctionRequest) => structuredClone(runAuctionJob(structuredClone(req)));

test('board Get %: the worker job matches the old on-page simulate() exactly', () => {
  const old = simulate(rows, others, (r) => myBids[key(r)] ?? Math.round(r.cost), key, Object.keys(myBids), 30, 7, undefined, dials);
  const now = viaWorker({ kind: 'board', rows, teams: others, myBids, runs: 30, dials });
  assert.deepEqual(now, old);
});

test('one mock draft: the worker job matches the old on-page runAuction() exactly, both ways of filling the rest', () => {
  for (const rest of ['plan', 'balanced'] as const) {
    const calib = calibrate(others, 8, dials.noise);
    for (const run of [1, 2, 5]) {
      const old = runAuction(pool, oldTeams(rest), key, rng(run * 7919), undefined, calib, dials);
      assert.deepEqual(viaWorker({ kind: 'one', pool, teams: newTeams(rest), run, calib, dials }), old, `${rest} run ${run}`);
    }
  }
});

test('most typical of n: the worker job matches the old on-page pick, and its odds add up', () => {
  const calib = calibrate(others, 8, dials.noise), n = 12;
  const rand = rng(3 * 104729);
  const runs = Array.from({ length: n }, () => runAuction(pool, oldTeams('plan'), key, rand, undefined, calib, dials));
  const freq = new Map<string, number>();
  for (const a of runs) for (const x of a.log) if (x.winner) freq.set(typicalPair(x.key, x.winner), (freq.get(typicalPair(x.key, x.winner)) ?? 0) + 1 / n);
  const score = (a: Auction) => a.log.reduce((t, x) => t + (x.winner ? freq.get(typicalPair(x.key, x.winner))! : 0), 0);
  const best = runs.reduce((m, a) => (score(a) > score(m) ? a : m));
  const now = viaWorker({ kind: 'typical', pool, teams: newTeams('plan'), run: 3, n, calib, dials }) as { auction: Auction; freq: Map<string, number> };
  assert.deepEqual(now.auction, best);
  assert.deepEqual(now.freq, freq);
  // Each player lands with one team per run at most, so his odds across teams never pass 100%.
  const byPlayer = new Map<string, number>();
  for (const [k, v] of now.freq) { const p = k.split('\u0000')[0]!; byPlayer.set(p, (byPlayer.get(p) ?? 0) + v); }
  for (const [p, v] of byPlayer) assert.ok(v <= 1 + 1e-9, `${p} ${v}`);
});

test('newest-only: while a job runs, the requests in between are skipped and everyone gets the newest answer', async () => {
  const started: string[] = [];
  const gates = new Map<string, () => void>();
  const job = newestOnly((a: string) => { started.push(a); return new Promise<string>((r) => gates.set(a, () => r(`done ${a}`))); });
  const pA = job('A'), pB = job('B'), pC = job('C');
  assert.deepEqual(started, ['A'], 'B and C wait');
  gates.get('A')!();
  assert.equal(await pA, 'done A');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(started, ['A', 'C'], 'B is never run');
  gates.get('C')!();
  assert.deepEqual(await Promise.all([pB, pC]), ['done C', 'done C']);
  // Idle again: the next request starts straight away.
  const pD = job('D');
  assert.deepEqual(started, ['A', 'C', 'D']);
  gates.get('D')!();
  assert.equal(await pD, 'done D');
});

test('newest-only: a failed job does not block the next one', async () => {
  let n = 0;
  const job = newestOnly((a: number) => (++n === 1 ? Promise.reject(new Error('boom')) : Promise.resolve(a * 2)));
  const p1 = job(1), p2 = job(2);
  await assert.rejects(p1, /boom/);
  assert.equal(await p2, 4);
});

test('worker client: with no Worker (as in Node) the job runs inline, errors included', async () => {
  const c = workerClient<{ x: number }, number>(() => { throw new Error('never spawned'); }, 'Test');
  assert.equal(c.send({}), false);
  assert.equal(await c.call({ x: 2 }, () => 42), 42);
  await assert.rejects(c.call({ x: 2 }, () => { throw new Error('inline failed'); }), /inline failed/);
});
