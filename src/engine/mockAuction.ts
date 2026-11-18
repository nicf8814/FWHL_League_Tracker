// Mock auctions (draft prep part E): the other 11 teams buy the open pool many times over, each owner
// bidding the way his persona says (position lean, overpay, stars, favorite NFL teams), under his own
// money, keepers, max-bid rule and position limits. What Nic gets from it, per player: how often the
// most anyone else would pay stays under his max bid (gettable), what he usually sells for, and who
// usually buys him. Seeded, so the same inputs always give the same answer.
import type { Persona, PrepPos } from '../data/draftPrep.ts';
import type { PrepRow } from './draftPrep.ts';
import { POS_MAX, SLOTS } from './rosterPlan.ts';

export interface SimTeam { name: string; budget: number; filled: Partial<Record<PrepPos, number>>; persona: Persona | null }
export interface SimResult { runs: number; get: number; price: number; buyers: [string, number][] } // get: share of runs
export interface SimOut { players: Map<string, SimResult>; planOdds: number | null }

const NOISE = 0.18; // spread of one owner's bid around his persona price (lognormal sigma)
const STAR_PRICE = 35; // a "star" buy, where the stars habit applies
const FAV_BOOST = 1.12; // favorite NFL team
const DEEP = 0.6; // bid factor once his starters at the position are covered

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const STARTERS: Record<PrepPos, number> = { QB: 1, RB: 3, WR: 4, TE: 1 }; // a lineup's worth incl. flex spots

// With many bidders the price (second-highest bid) runs above a typical bid. Divide it back out so a
// player sells for about his expected cost on average: the mean second-highest of n noisy bids.
function secondHighest(n: number, rand: () => number): number {
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  let sum = 0;
  const draws = 2000;
  for (let d = 0; d < draws; d++) {
    const xs = Array.from({ length: n }, () => Math.exp(NOISE * gauss())).sort((a, b) => b - a);
    sum += xs[1] ?? xs[0] ?? 1;
  }
  return sum / draws;
}

// rows: the priced board (keepers and Nic's planned buys already taken). myMax: what Nic would pay per
// player (his planned bid, else the expected cost; the ceiling is only a reference, Nic Nov 18). plan: Nic's planned (non-keeper) players, for plan odds.
export function simulate(rows: PrepRow[], teams: SimTeam[], myMax: (r: PrepRow) => number, keyOf: (r: PrepRow) => string, plan: string[] = [], runs = 200, seed = 7): SimOut {
  const pool = rows.filter((r) => !r.keeper && r.cost > 0).sort((a, b) => b.cost - a.cost);
  const spots = teams.reduce((s, t) => s + SLOTS.length - Object.values(t.filled).reduce((a, b) => a + (b ?? 0), 0), 0);
  const nominated = pool.slice(0, spots + 20);
  const stats = new Map<string, { get: number; price: number; buyers: Map<string, number> }>();
  for (const r of rows) if (!r.keeper) stats.set(keyOf(r), { get: 0, price: 0, buyers: new Map() });
  const planHits = { all: 0 };
  const rand = rng(seed);
  const calib = secondHighest(Math.max(2, teams.length), rng(seed + 1));
  const gauss = () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());
  for (let run = 0; run < runs; run++) {
    const state = teams.map((t) => ({ ...t, left: t.budget, filled: { ...t.filled } as Record<PrepPos, number> }));
    for (const s of state) for (const p of ['QB', 'RB', 'WR', 'TE'] as PrepPos[]) s.filled[p] ??= 0;
    const order = nominated.map((r) => ({ r, k: r.cost * Math.exp(0.35 * gauss()) })).sort((a, b) => b.k - a.k).map((x) => x.r);
    const seen = new Set<string>();
    let planOk = true;
    for (const r of order) {
      const key = keyOf(r);
      seen.add(key);
      let best = 0, second = 0, winner = -1;
      state.forEach((t, i) => {
        const open = SLOTS.length - Object.values(t.filled).reduce((a, b) => a + b, 0);
        if (open <= 0 || (POS_MAX[r.pos] !== undefined && t.filled[r.pos] >= POS_MAX[r.pos]!)) return;
        const maxBid = t.left - (open - 1);
        if (maxBid < 1) return;
        const p = t.persona;
        let w = (r.cost / calib) * Math.exp(NOISE * gauss());
        if (p) {
          w *= p.lean[r.pos] * p.overpay;
          if (r.cost >= STAR_PRICE) w *= p.stars;
          if (p.fav.includes(r.team.toUpperCase())) w *= FAV_BOOST;
        }
        if (t.filled[r.pos] >= STARTERS[r.pos]) w *= DEEP;
        w = Math.min(maxBid, r.ceiling, Math.max(1, w)); // nobody past the most that slot has sold for
        if (w > best) { second = best; best = w; winner = i; } else if (w > second) second = w;
      });
      const st = stats.get(key)!;
      const mine = myMax(r);
      const top = Math.floor(best);
      if (mine > top) st.get++; else if (mine === top) st.get += 0.5; // a tie: a coin flip on who bid first
      if (mine < top && plan.includes(key)) planOk = false;
      if (winner < 0) continue;
      const price = Math.max(1, Math.min(Math.floor(best), Math.floor(second) + 1));
      const w = state[winner]!;
      w.left -= price; w.filled[r.pos]++;
      st.price += price;
      st.buyers.set(w.name, (st.buyers.get(w.name) ?? 0) + 1);
    }
    // Never nominated: nobody else wanted him at all, so he's gettable for $1.
    for (const [key, st] of stats) if (!seen.has(key)) st.get++;
    if (planOk) planHits.all++;
  }
  const players = new Map<string, SimResult>();
  for (const [key, st] of stats) {
    const sold = [...st.buyers.values()].reduce((a, b) => a + b, 0);
    players.set(key, { runs, get: st.get / runs, price: sold ? st.price / sold : 1, buyers: [...st.buyers].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, c]) => [n, c / runs]) });
  }
  return { players, planOdds: plan.length ? planHits.all / runs : null };
}
