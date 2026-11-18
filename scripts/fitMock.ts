// Fits the mock auction's dials to real auctions (`npm run data -- fitmock`). Nic, Nov 18: "we can't
// hardcode this logic". Too little data for a learned model (5 drafts under today's rules), so the mock
// keeps its readable steps and only its few dials are chosen by the data:
//   1. Replay each fit year's real draft (its FantasyPros board, real keepers, owners as personas) RUNS
//      times for every combination of dial values in GRID.
//   2. Score each against what really happened: sale prices (auctioned players at $5+), money left per
//      team, and each owner's players per position.
//   3. Keep the best on the fit years, then report how it does on the check years it never saw.
// Writes the result into public/seed/draft-prep.json (mockDials); the site reads it from there.
import { playerKey } from '../src/data/drafts.ts';
import type { DraftPrep, MockFit, Persona, PrepPos } from '../src/data/draftPrep.ts';
import { PREP_POS } from '../src/data/draftPrep.ts';
import { readFileSync } from 'node:fs';
import { priceBoard } from '../src/engine/draftPrep.ts';
import { DEFAULT_DIALS, calibrate, poolOf, rng, runAuction, type MockDials, type SimTeam } from '../src/engine/mockAuction.ts';
import { buildDraftPrep } from './draftPrep.ts';

export const FIT_YEARS = [2025], CHECK_YEARS = [2026];
const RUNS = 30;
const GRID: Record<keyof MockDials, number[]> = {
  noise: [0.09, 0.15, 0.22, 0.3],
  deep: [0.6, 0.8, 1],
  extra: [0.1, 0.2, 0.35],
  pressure: [2, 4, 6, 9],
  wild: [0.05, 0.15, 0.3],
};
// Loss weights: $5 of price miss, $5 of money-left miss, one player of shape miss and 20 points of
// coverage off its 80% target count the same. Coverage keeps the mock honest about uncertainty: without
// it, the least random dials always win (averages look fine when every mock is the same draft).
const COVER = 0.8;
const loss = (s: Score) => s.price / 5 + s.left / 5 + s.shape + Math.abs(s.cover - COVER) * 5;
interface Score { price: number; left: number; shape: number; cover: number }
const r2 = (v: number) => Math.round(v * 100) / 100;

interface Replay { year: number; rows: ReturnType<typeof priceBoard>['rows']; teams: SimTeam[]; actual: { price: Map<string, number>; left: Map<string, number>; shape: Map<string, Record<PrepPos, number>> } }

function replayOf(prep: DraftPrep, personas: Persona[], drafts: { picks: [number, number, string, number, 0 | 1, ...unknown[]][]; players: [string, string][] }): Replay {
  const rows = priceBoard(prep).rows;
  const keyOf = (n: string, p: string) => playerKey(n, p);
  const teams: SimTeam[] = personas.map((p) => {
    const ks = prep.keepers.filter((k) => k[3] === p.key);
    const filled: SimTeam['filled'] = {};
    for (const k of ks) filled[k[1]] = (filled[k[1]] ?? 0) + 1;
    return { name: p.key, budget: prep.budget - ks.reduce((s, k) => s + k[2], 0), filled, persona: p };
  });
  const picks = drafts.picks.filter((x) => x[0] === prep.year);
  const price = new Map<string, number>(), left = new Map<string, number>(), shape = new Map<string, Record<PrepPos, number>>();
  for (const t of teams) { left.set(t.name, 200); shape.set(t.name, { QB: 0, RB: 0, WR: 0, TE: 0 }); }
  for (const x of picks) {
    const [name, pos] = drafts.players[x[1]]!;
    if (!left.has(x[2]) || !(PREP_POS as readonly string[]).includes(pos)) continue;
    left.set(x[2], left.get(x[2])! - x[3]);
    shape.get(x[2])![pos as PrepPos]++;
    if (!x[4]) price.set(keyOf(name, pos), x[3]);
  }
  return { year: prep.year, rows, teams, actual: { price, left, shape } };
}

function score(r: Replay, d: MockDials, nomination: [number, number, number][] | undefined, runs = RUNS): Score {
  const pool = poolOf(r.rows), keyOf = (x: { name: string; pos: string }) => playerKey(x.name, x.pos);
  const rand = rng(r.year), calib = calibrate(r.teams, 8, d.noise);
  const paid = new Map<string, number>(), left = new Map<string, number>(), shape = new Map<string, Record<PrepPos, number>>();
  const prices = new Map<string, number[]>();
  for (let i = 0; i < runs; i++) {
    const a = runAuction(pool, r.teams, keyOf, rand, nomination, calib, d);
    for (const s of a.log) if (s.winner) {
      paid.set(s.key, (paid.get(s.key) ?? 0) + s.price / runs);
      prices.set(s.key, [...(prices.get(s.key) ?? []), s.price]);
      const z = shape.get(s.winner) ?? { QB: 0, RB: 0, WR: 0, TE: 0 };
      z[s.pos] += 1 / runs; shape.set(s.winner, z);
    }
    for (const t of r.teams) left.set(t.name, (left.get(t.name) ?? 0) + a.left.get(t.name)! / runs);
  }
  const big = [...r.actual.price].filter(([k]) => (r.rows.find((x) => keyOf(x) === k)?.cost ?? 0) >= 5);
  const price = big.reduce((s, [k, v]) => s + Math.abs((paid.get(k) ?? 0) - v), 0) / (big.length || 1);
  const leftMiss = r.teams.reduce((s, t) => s + Math.abs(left.get(t.name)! - r.actual.left.get(t.name)!), 0) / r.teams.length;
  let sh = 0;
  for (const t of r.teams) {
    const real = r.actual.shape.get(t.name)!, kept = t.filled, mock = shape.get(t.name) ?? { QB: 0, RB: 0, WR: 0, TE: 0 };
    for (const pos of PREP_POS) sh += Math.abs((mock[pos] + (kept[pos] ?? 0)) - real[pos]);
  }
  // Coverage: share of real prices inside the mock's 10th-90th percentile for that player (unsold in a run = $0).
  const inside = big.filter(([k, v]) => {
    const xs = [...(prices.get(k) ?? [])]; while (xs.length < runs) xs.push(0);
    xs.sort((a, b) => a - b);
    return v >= xs[Math.floor(0.1 * (runs - 1))]! && v <= xs[Math.ceil(0.9 * (runs - 1))]!;
  }).length;
  return { price: r2(price), left: r2(leftMiss), shape: r2(sh / r.teams.length / PREP_POS.length), cover: r2(inside / (big.length || 1)) };
}

const mean = (xs: Score[], k: keyof Score) => r2(xs.reduce((s, x) => s + x[k], 0) / xs.length);
const avg = (xs: Score[]): Score => ({ price: mean(xs, 'price'), left: mean(xs, 'left'), shape: mean(xs, 'shape'), cover: mean(xs, 'cover') });

export function fitMock(log: (m: string) => void = () => {}): MockFit {
  const { file, replays } = buildDraftPrep(undefined, undefined, undefined, [...FIT_YEARS, ...CHECK_YEARS]);
  const drafts = JSON.parse(readFileSync('public/seed/drafts.json', 'utf8'));
  const personas = file.personas ?? [];
  const reps = replays.map((p) => replayOf(p, personas, drafts));
  const fit = reps.filter((r) => FIT_YEARS.includes(r.year)), check = reps.filter((r) => CHECK_YEARS.includes(r.year));
  if (!fit.length || !check.length) throw new Error('fitmock needs a board for every fit and check year');
  const combos: MockDials[] = [];
  for (const noise of GRID.noise) for (const deep of GRID.deep) for (const extra of GRID.extra) for (const pressure of GRID.pressure) for (const wild of GRID.wild) combos.push({ noise, deep, extra, pressure, wild });
  let best = DEFAULT_DIALS, bestLoss = Infinity;
  combos.forEach((d, i) => {
    const l = loss(avg(fit.map((r) => score(r, d, file.nomination))));
    if (l < bestLoss) { bestLoss = l; best = d; }
    if (i % 50 === 0) log(`${i}/${combos.length} best so far ${JSON.stringify(best)} loss ${r2(bestLoss)}`);
  });
  return {
    dials: best, fitOn: FIT_YEARS, checkOn: CHECK_YEARS,
    score: avg(check.map((r) => score(r, best, file.nomination, RUNS * 2))),
    before: avg(check.map((r) => score(r, DEFAULT_DIALS, file.nomination, RUNS * 2))),
    combos: combos.length, runs: RUNS,
  };
}
