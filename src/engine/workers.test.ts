// Off-thread jobs: the mock-auction worker's jobs match the old on-page calls exactly, requests and
// answers survive the copy a worker message makes, and the newest-only queue drops stale requests.
// Run with `npm test`. (No Worker in Node, so workerClient runs jobs inline here: also checked.)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DraftPrep, PrepPos } from '../data/draftPrep.ts';
import { playerKey } from '../data/drafts.ts';
import { runAuctionJob, type AuctionRequest } from './auctionJobs.ts';
import { priceBoard, type PrepRow } from './draftPrep.ts';
import { DEFAULT_DIALS, OUTLOOK_EXAMPLES, calibrate, playerTeam, poolOf, quantile, rng, runAuction, simulate, strategyBid, type Auction, type DraftOutlook, type PlainTeam, type SimTeam } from './mockAuction.ts';
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
// Keyed the way the Board keys players (playerKey: "RB 2" is "rb2|RB").
const myBids: Record<string, number> = { [playerKey('RB 2', 'RB')]: 70, [playerKey('WR 3', 'WR')]: 40, [playerKey('TE 1', 'TE')]: 20 };
test('the test plan names real players', () => {
  for (const k of Object.keys(myBids)) assert.ok(rows.some((r) => key(r) === k), k);
});
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

test('board chance at your price: the worker job matches the old on-page simulate() exactly', () => {
  const old = simulate(rows, others, (r) => myBids[key(r)] ?? Math.round(r.cost), key, Object.keys(myBids), 30, 7, undefined, dials);
  const now = viaWorker({ kind: 'board', rows, teams: others, myBids, runs: 30, dials });
  assert.deepEqual(now, old);
});

// The same drafts the outlook plays, played here the old way (bidders as functions), to recount from.
const calib = calibrate(others, 8, dials.noise);
function sameDrafts(rest: 'plan' | 'balanced', run: number, n: number): Auction[] {
  const rand = rng(run * 104729);
  return Array.from({ length: n }, () => runAuction(pool, oldTeams(rest), key, rand, undefined, calib, dials));
}
const outlook = (rest: 'plan' | 'balanced', run: number, n: number, me: string | null = 'Me', plan = myBids) =>
  viaWorker({ kind: 'outlook', pool, teams: newTeams(rest), me, plan, run, n, calib, dials }) as DraftOutlook;

test('draft outlook: the drafts match the old on-page auctions, and the first example is the most typical', () => {
  for (const rest of ['plan', 'balanced'] as const) {
    const n = 20, drafts = sameDrafts(rest, 3, n), out = outlook(rest, 3, n);
    const freq = new Map<string, number>();
    for (const a of drafts) for (const x of a.log) if (x.winner) freq.set(playerTeam(x.key, x.winner), (freq.get(playerTeam(x.key, x.winner)) ?? 0) + 1 / n);
    assert.deepEqual(out.freq, freq, rest);
    const score = (a: Auction) => a.log.reduce((t, x) => t + (x.winner ? freq.get(playerTeam(x.key, x.winner))! : 0), 0);
    assert.deepEqual(out.examples[0], drafts.reduce((m, a) => (score(a) > score(m) ? a : m)), `${rest}: most typical`);
    assert.equal(out.examples.length, OUTLOOK_EXAMPLES);
    for (const e of out.examples) assert.ok(drafts.some((d) => JSON.stringify(d.log) === JSON.stringify(e.log)), 'every example is one of the drafts played');
    assert.equal(new Set(out.examples.map((e) => JSON.stringify(e.log))).size, out.examples.length, 'no example twice');
  }
});

test('draft outlook: odds to win, plan odds and targets landed match a recount of the same drafts', () => {
  const n = 30, drafts = sameDrafts('plan', 2, n), out = outlook('plan', 2, n);
  const sale = (a: Auction, k: string) => a.log.find((s) => s.key === k);
  const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length ? (s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2) : null; };
  assert.deepEqual(out.targets.map((t) => t.key).sort(), Object.keys(myBids).sort());
  for (const t of out.targets) {
    assert.equal(t.bid, myBids[t.key]);
    assert.equal(t.get, drafts.filter((a) => sale(a, t.key)?.winner === 'Me').length / n, `${t.name} odds to win`);
    assert.deepEqual(Object.keys(t).sort(), ['bid', 'get', 'key', 'name', 'pos', 'toWin'], 'odds and price to win only: no rival names');
    // What it took to win him: the winner's top bid + $1, in each draft he was lost to someone; it varies.
    const took = drafts.map((a) => sale(a, t.key)).filter((s) => s?.winner && s.winner !== 'Me').map((s) => s!.winBid + 1);
    if (!took.length) { assert.equal(t.toWin, null); continue; }
    assert.deepEqual(t.toWin, { mid: med(took), lo: quantile(took, 0.25), hi: quantile(took, 0.75) }, `${t.name} price to win`);
    assert.ok(t.toWin!.lo <= t.toWin!.mid && t.toWin!.mid <= t.toWin!.hi, `${t.name}: low ≤ usual ≤ high`);
    assert.ok(took.includes(t.toWin!.lo) && took.includes(t.toWin!.hi), `${t.name}: the range ends are amounts really bid`);
  }
  for (let i = 1; i < out.targets.length; i++) assert.ok(out.targets[i - 1]!.get <= out.targets[i]!.get, 'least likely first');
  assert.equal(out.planOdds, drafts.filter((a) => Object.keys(myBids).every((k) => sale(a, k)?.winner === 'Me')).length / n);
  assert.equal(out.landed, med(drafts.map((a) => Object.keys(myBids).filter((k) => sale(a, k)?.winner === 'Me').length)), 'targets usually landed');
  assert.ok(out.landed! >= 0 && out.landed! <= Object.keys(myBids).length);
  assert.ok(out.planOdds! <= Math.min(...out.targets.map((t) => t.get)) + 1e-9, 'the whole plan is never likelier than its least likely player');
  assert.equal(out.usual!.bought, med(drafts.map((a) => a.rosters.get('Me')!.length)));
  assert.equal(out.usual!.left, med(drafts.map((a) => a.left.get('Me')!)));
  // Each player lands with one team per draft at most, so his chances across teams never pass 100%.
  const byPlayer = new Map<string, number>();
  for (const [k, v] of out.freq) { const p = k.split('\u0000')[0]!; byPlayer.set(p, (byPlayer.get(p) ?? 0) + v); }
  for (const [p, v] of byPlayer) assert.ok(v <= 1 + 1e-9, `${p} ${v}`);
});

test('draft outlook: no team picked, no plan, and a planned player who is not up for auction', () => {
  const none = outlook('plan', 1, 5, null);
  assert.deepEqual([none.targets, none.planOdds, none.landed, none.usual], [[], null, null, null]);
  const empty = outlook('plan', 1, 5, 'Me', {});
  assert.deepEqual([empty.targets, empty.planOdds, empty.landed], [[], null, null]);
  assert.ok(empty.usual && empty.usual.bought > 0);
  const ghost = outlook('plan', 1, 5, 'Me', { ...myBids, [playerKey('Nobody', 'QB')]: 30 });
  assert.equal(ghost.targets.some((t) => t.key === playerKey('Nobody', 'QB')), false, 'not in the pool: left out, not counted as lost');
  assert.equal(ghost.targets.length, Object.keys(myBids).length);
  assert.equal(outlook('plan', 1, 3).examples.length, 3, 'fewer drafts than examples: every draft is shown once');
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

test('my team keeps roster spots for planned players still to come, not only money', () => {
  // A plan with cheap late players: before the fix, market buys filled the roster before they came up.
  const cheap = rows.filter((r) => !r.keeper && r.cost <= 2).slice(0, 6);
  const plan: Record<string, number> = { ...myBids, ...Object.fromEntries(cheap.map((r) => [key(r), 1])) };
  const me = { name: 'Me', budget: 200, filled: {}, persona: null, bids: plan, rest: 'one' as const, market: true };
  const out = viaWorker({ kind: 'outlook', pool, teams: [me, ...others], me: 'Me', plan, run: 4, n: 25, calib, dials }) as DraftOutlook;
  for (const a of out.examples) {
    let mine = 0;
    for (const s of a.log) {
      if (s.winner === 'Me') { mine++; continue; }
      if (!(s.key in plan) || !s.winner) continue;
      // He lost a planned player: it must not be because his roster was already full.
      assert.ok(mine < 13, `${s.name} sold to ${s.winner} after Me had filled all 13 spots`);
    }
    assert.ok((a.rosters.get('Me')?.length ?? 0) <= 13);
  }
  for (const r of cheap) assert.ok(out.targets.find((t) => t.key === key(r))!.get > 0, `${r.name}: a $1 target is sometimes mine`);
});

test('draft outlook: the same set of drafts gives the same answer; a new set gives new drafts', () => {
  assert.deepEqual(outlook('plan', 5, 10), outlook('plan', 5, 10), 'same set, same answer');
  const a = outlook('plan', 5, 10), b = outlook('plan', 6, 10);
  assert.notDeepEqual(a.examples.map((e) => e.log), b.examples.map((e) => e.log), 'a new set plays different drafts');
});

test('quantile picks a real value from the list', () => {
  assert.equal(quantile([5], 0.25), 5);
  assert.equal(quantile([4, 1, 3, 2], 0), 1);
  assert.equal(quantile([4, 1, 3, 2], 1), 4);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.25), 20);
  assert.equal(quantile([10, 20, 30, 40, 50], 0.75), 40);
});
