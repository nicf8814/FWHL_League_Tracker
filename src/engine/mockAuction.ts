// Mock auctions (draft prep parts E and F). runAuction plays one full auction: teams nominate in turn
// the way this league does (by stage of the draft: top / middle / cheap players at the measured rates,
// usually the priciest one at a position the nominator doesn't need, sometimes a wild card), and every
// team bids its persona (position lean, overpay, stars, favorite NFL teams) under its own money, keepers,
// max-bid rule and position limits. Nic's team, when it takes part, bids his plan or a strategy.
// simulate() runs the other 11 teams many times for the board's Get %, likely buyers and plan odds.
// Seeded, so the same inputs always give the same answer.
import type { Persona, PrepPos } from '../data/draftPrep.ts';
import type { Strategy } from './autoFill.ts';
import type { PrepRow } from './draftPrep.ts';
import { POS_MAX, SLOTS } from './rosterPlan.ts';

// bid: Nic's own bids instead of a persona. planned: players he bids exactly (his plan); everyone else he
// bids follows the same roster-shape rules as the other teams.
export interface SimTeam { name: string; budget: number; filled: Partial<Record<PrepPos, number>>; persona: Persona | null; bid?: (r: PrepRow) => number; planned?: Set<string> }
export interface SimResult { runs: number; get: number; price: number; buyers: [string, number][] } // get: share of runs
export interface SimOut { players: Map<string, SimResult>; planOdds: number | null }
export interface Sale { n: number; by: string; key: string; name: string; pos: PrepPos; winner: string | null; price: number; winBid: number; runnerUp: string | null; runnerBid: number }
export interface Auction { log: Sale[]; rosters: Map<string, Sale[]>; left: Map<string, number> }
export type Nomination = [number, number, number][]; // per fifth of the draft: share top / middle / cheap

const NOISE = 0.18; // spread of one owner's bid around his persona price (lognormal sigma)
const STAR_PRICE = 35; // a "star" buy, where the stars habit applies
const FAV_BOOST = 1.12; // favorite NFL team
const DEEP = 0.6; // bid factor once his starters at the position are covered
// Roster shapes like the real ones (2022-26 auctions: QB 1-2, RB 4-5, WR 5-7, TE 0-2 per team): past
// USUAL a team bids a fraction (EXTRA_BID); at SHAPE_MAX it stops, well inside the league's limits.
const USUAL: Record<PrepPos, number> = { QB: 1, RB: 5, WR: 7, TE: 1 };
const SHAPE_MAX: Record<PrepPos, number> = { QB: 3, RB: 6, WR: 8, TE: 3 };
const EXTRA_BID: Record<PrepPos, number> = { QB: 0.5, RB: 0.2, WR: 0.2, TE: 0.2 }; // a backup QB is common (45% of teams carry 2)
// Spots a team still has to fill to field a lineup (QB, 2 RB, 2 WR, a WR or TE for WR/TE; FLEX takes any).
function stillNeeds(f: Record<PrepPos, number>): Partial<Record<PrepPos, number>> {
  const n: Partial<Record<PrepPos, number>> = {};
  if (f.QB < 1) n.QB = 1;
  if (f.RB < 2) n.RB = 2 - f.RB;
  if (f.WR < 2) n.WR = 2 - f.WR;
  if (f.WR < 3 && f.TE < 1) n.WR = (n.WR ?? 0) + 1; // the WR/TE spot, met by a WR or a TE
  return n;
}
const WILD = 0.3; // share of nominations that are a random player from the chosen group
const STARTERS: Record<PrepPos, number> = { QB: 1, RB: 3, WR: 4, TE: 1 }; // a lineup's worth incl. flex spots
// Used when the file has no measured order: 2022-26 auctions.
export const DEFAULT_NOMINATION: Nomination = [[0.65, 0.31, 0.04], [0.21, 0.65, 0.14], [0.01, 0.64, 0.36], [0.01, 0.15, 0.85], [0, 0.01, 0.99]];

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gaussOf = (rand: () => number) => () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

// With many bidders the price (second-highest bid) runs above a typical bid. Divide it back out so a
// player sells for about his expected cost on average: the mean second-highest of n noisy bids.
function secondHighest(n: number, rand: () => number): number {
  const gauss = gaussOf(rand);
  let sum = 0;
  for (let d = 0; d < 2000; d++) {
    const xs = Array.from({ length: n }, () => Math.exp(NOISE * gauss())).sort((a, b) => b - a);
    sum += xs[1] ?? xs[0] ?? 1;
  }
  return sum / 2000;
}

// How Nic bids when a strategy drives his team (the auto-fill buttons' rules, as bids).
export function strategyBid(s: Strategy, r: PrepRow): number {
  const c = Math.max(1, Math.round(r.cost));
  switch (s) {
    case 'points': return (r.vorp ?? 0) > 0 ? Math.min(r.ceiling, Math.max(c, Math.round(Math.min(r.worth, r.ceiling)))) : 1;
    case 'stars': return c >= 35 ? r.ceiling : c <= 5 ? c : 0;
    case 'balanced': return c <= 50 ? c : 0;
    case 'title': return c >= 35 ? r.ceiling : Math.round(c * 0.9);
    case 'bargain': return r.edge >= 5 ? c : 0;
  }
}

const open = (t: { filled: Record<PrepPos, number> }) => SLOTS.length - Object.values(t.filled).reduce((a, b) => a + b, 0);
// Could this team take him? A spot open, under the position limit (and the usual roster shape for a
// persona team), and, when his open spots are only enough for what his lineup still needs, one of those.
function canTake(t: { filled: Record<PrepPos, number>; bid?: unknown }, r: PrepRow): { ok: boolean; need: boolean } {
  const o = open(t);
  if (o <= 0 || (POS_MAX[r.pos] !== undefined && t.filled[r.pos] >= POS_MAX[r.pos]!)) return { ok: false, need: false };
  if (!t.bid && t.filled[r.pos] >= SHAPE_MAX[r.pos]) return { ok: false, need: false };
  const needs = stillNeeds(t.filled), short = Object.values(needs).reduce((x, y) => x + (y ?? 0), 0);
  const fills = (needs[r.pos] ?? 0) > 0 || (r.pos === 'TE' && t.filled.WR < 3 && t.filled.TE < 1);
  if (o <= short && !fills) return { ok: false, need: false };
  return { ok: true, need: o <= short && fills };
}

// One full auction. pool: players up for auction (keepers removed). order: team names in nomination order.
export function runAuction(pool: PrepRow[], teams: SimTeam[], keyOf: (r: PrepRow) => string, rand: () => number, nomination: Nomination = DEFAULT_NOMINATION, calib = 1): Auction {
  const gauss = gaussOf(rand);
  const state = teams.map((t) => ({ ...t, left: t.budget, filled: { QB: 0, RB: 0, WR: 0, TE: 0, ...t.filled } as Record<PrepPos, number> }));
  const order = state.map((t) => ({ t, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.t);
  const byPrice = [...pool].sort((a, b) => b.cost - a.cost);
  const group = new Map(byPrice.map((r, i) => [r, i < 24 ? 0 : i < 72 ? 1 : 2]));
  const left = new Set(byPrice);
  const total = Math.min(byPrice.length, state.reduce((s, t) => s + open(t), 0));
  const log: Sale[] = [];
  let turn = 0;
  while (left.size && state.some((t) => open(t) > 0)) {
    // Nominator: the next team in turn that still has a spot.
    let by = order[turn++ % order.length]!;
    for (let i = 0; i < order.length && open(by) <= 0; i++) by = order[turn++ % order.length]!;
    // Which group: the league's rates for this stage of the draft, falling back to any group left.
    const filledSoFar = log.filter((x) => x.winner).length; // stage of the draft: share of open spots filled
    const stage = nomination[Math.min(nomination.length - 1, Math.floor((filledSoFar * nomination.length) / Math.max(1, total)))]!;
    let g = 2, x = rand() * (stage[0] + stage[1] + stage[2] || 1);
    for (let i = 0; i < 3; i++) { if (x < stage[i]!) { g = i; break; } x -= stage[i]!; }
    // He nominates someone he could take himself (he opens the bidding at $1): by position, checked once.
    const okPos = new Set((['QB', 'RB', 'WR', 'TE'] as PrepPos[]).filter((pos) => canTake(by, { pos } as PrepRow).ok));
    const mine = [...left].filter((r) => okPos.has(r.pos));
    let cands = mine.filter((r) => group.get(r) === g);
    if (!cands.length) cands = mine.length ? mine : [...left];
    // Usually the priciest at a position he doesn't need (drain the others); sometimes a wild card.
    // Early and middle: a position he doesn't need, to drain the others. Late (cheap players): one he wants.
    const want = (r: PrepRow) => (by.filled[r.pos] < USUAL[r.pos] ? 1 : 0) + (by.filled[r.pos] < STARTERS[r.pos] ? 1 : 0) + (by.persona ? by.persona.lean[r.pos] - 1 : 0);
    const need = (r: PrepRow) => (g === 2 ? -want(r) : want(r));
    let r = cands[0]!;
    if (rand() < WILD) r = cands[Math.floor(rand() * cands.length)]!;
    else for (const c of cands) if (need(c) < need(r) || (need(c) === need(r) && c.cost > r.cost)) r = c;
    left.delete(r);
    // Bids.
    const spotsLeft = state.reduce((x, t) => x + Math.max(0, open(t)), 0);
    let best = 0, second = 0, win = -1, run = -1;
    state.forEach((t, i) => {
      const o = open(t), take = canTake(t, r);
      if (!take.ok) return;
      const maxBid = t.left - (o - 1);
      if (maxBid < 1) return;
      let w: number;
      const must = take.need || t === by || left.size < 2 * spotsLeft; // a lineup need, his own nomination, or the pool running out
      // Roster shape: less interest past his starters, much less past a usual roster, none past the shape cap.
      const shaped = (x: number) => {
        if (t.filled[r.pos] >= SHAPE_MAX[r.pos]) return 0;
        if (t.filled[r.pos] >= USUAL[r.pos]) x *= EXTRA_BID[r.pos]; else if (t.filled[r.pos] >= STARTERS[r.pos]) x *= DEEP;
        // Under $1 of interest: he bids the $1 minimum only that share of the time (so a lukewarm owner
        // doesn't win every $1 coin flip).
        if (x < 1) { if (!must && rand() >= x) return 0; x = 1; }
        return x;
      };
      if (t.bid) {
        w = t.planned?.has(keyOf(r)) ? t.bid(r) : shaped(t.bid(r));
        if (t === by) w = Math.max(1, w); // the nominator opens at $1
      } else {
        w = (r.cost / calib) * Math.exp(NOISE * gauss());
        const p = t.persona;
        if (p) {
          w *= p.lean[r.pos] * p.overpay;
          if (r.cost >= STAR_PRICE) w *= p.stars;
          if (p.fav.includes(r.team.toUpperCase())) w *= FAV_BOOST;
        }
        w = shaped(w);
        if (!w) return;
        w = Math.min(r.ceiling, w); // nobody past the most that slot has sold for
      }
      w = Math.min(maxBid, w);
      if (w < 1) return;
      if (w > best || (w === best && rand() < 0.5)) { second = best; run = win; best = w; win = i; } else if (w > second) { second = w; run = i; }
    });
    const price = win < 0 ? 0 : Math.max(1, Math.min(Math.floor(best), Math.floor(second) + 1));
    const sale: Sale = { n: log.length + 1, by: by.name, key: keyOf(r), name: r.name, pos: r.pos, winner: win < 0 ? null : state[win]!.name, price, winBid: Math.floor(best), runnerUp: run < 0 ? null : state[run]!.name, runnerBid: Math.floor(second) };
    if (win >= 0) { const w = state[win]!; w.left -= price; w.filled[r.pos]++; }
    log.push(sale);
  }
  const rosters = new Map(state.map((t) => [t.name, log.filter((s) => s.winner === t.name)]));
  return { log, rosters, left: new Map(state.map((t) => [t.name, t.left])) };
}

// Up for auction: everyone not kept with a price, plus the best-projected unpriced players as $1
// fodder, enough to fill every roster (EXTRA spare).
const EXTRA = 60;
export function poolOf(rows: PrepRow[], spots = 156): PrepRow[] {
  const open = rows.filter((r) => !r.keeper);
  const priced = open.filter((r) => r.cost > 0);
  const fodder = open.filter((r) => r.cost <= 0 && r.proj !== null).sort((a, b) => (b.vorp ?? -1e9) - (a.vorp ?? -1e9) || b.proj! - a.proj!);
  return [...priced, ...fodder.slice(0, Math.max(0, spots + EXTRA - priced.length))];
}
export const calibrate = (teams: number, seed = 8) => secondHighest(Math.max(2, teams), rng(seed));

// rows: the priced board (keepers and Nic's planned buys already taken). myMax: what Nic would pay per
// player (his planned bid, else the expected cost; the ceiling is only a reference, Nic Nov 18).
// plan: Nic's planned (non-keeper) players, for plan odds. Nic is not in these auctions: they measure
// what everyone else would pay.
export function simulate(rows: PrepRow[], teams: SimTeam[], myMax: (r: PrepRow) => number, keyOf: (r: PrepRow) => string, plan: string[] = [], runs = 200, seed = 7, nomination: Nomination = DEFAULT_NOMINATION): SimOut {
  const pool = poolOf(rows);
  const stats = new Map<string, { get: number; price: number; buyers: Map<string, number> }>();
  for (const r of rows) if (!r.keeper) stats.set(keyOf(r), { get: 0, price: 0, buyers: new Map() });
  const byKey = new Map(rows.map((r) => [keyOf(r), r]));
  const rand = rng(seed), calib = calibrate(teams.length);
  // Gettable: Nic gets him if his bid beats the most anyone else would pay (the winner's bid).
  let planHits = 0;
  for (let run = 0; run < runs; run++) {
    const sales = new Map(runAuction(pool, teams, keyOf, rand, nomination, calib).log.map((x) => [x.key, x]));
    let ok = true;
    for (const [key, st] of stats) {
      const sale = sales.get(key), mine = myMax(byKey.get(key)!);
      const top = sale?.winner ? sale.winBid : 0;
      if (mine > top) st.get++; else if (mine === top) st.get += 0.5; // a tie: a coin flip on who bid first
      if (mine < top && plan.includes(key)) ok = false;
      if (sale?.winner) { st.price += sale.price; st.buyers.set(sale.winner, (st.buyers.get(sale.winner) ?? 0) + 1); }
    }
    if (ok) planHits++;
  }
  const players = new Map<string, SimResult>();
  for (const [key, st] of stats) {
    const sold = [...st.buyers.values()].reduce((a, b) => a + b, 0);
    players.set(key, { runs, get: st.get / runs, price: sold ? st.price / sold : 1, buyers: [...st.buyers].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => [n, c / runs]) });
  }
  return { players, planOdds: plan.length ? planHits / runs : null };
}
