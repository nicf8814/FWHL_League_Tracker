// Mock auctions (draft prep parts E and F). runAuction plays one full auction: teams nominate in turn
// the way this league does (by stage of the draft: top / middle / cheap players at the measured rates,
// usually the priciest one at a position the nominator doesn't need, sometimes a wild card), and every
// team bids its persona (position lean, overpay, stars, favorite NFL teams) under its own money, keepers,
// max-bid rule and position limits. Nic's team, when it takes part, bids his plan or a strategy.
// simulate() runs the other 11 teams many times for the board's Get %, likely buyers and plan odds.
// Seeded, so the same inputs always give the same answer.
import { PREP_POS, type Persona, type PrepPos } from '../data/draftPrep.ts';
import { playerKey } from '../data/drafts.ts';
import type { Strategy } from './autoFill.ts';
import type { PrepRow } from './draftPrep.ts';
import { POS_MAX, SLOTS } from './rosterPlan.ts';

// bid: Nic's own bids instead of a persona. planned: players he bids exactly (his plan); everyone else he
// bids follows the same roster-shape rules as the other teams. market: off-plan players are bid like a
// plain owner (expected cost, money pressure, no persona habits) instead of by bid(), so he spends his
// money like a real team (Nic, Nov 18: $1 on everyone else left ~$100 on the table).
export interface SimTeam { name: string; budget: number; filled: Partial<Record<PrepPos, number>>; persona: Persona | null; bid?: (r: PrepRow) => number; planned?: Set<string>; market?: boolean }
export interface SimResult { runs: number; get: number; price: number; buyers: [string, number][] } // get: share of runs
export interface SimOut { players: Map<string, SimResult>; planOdds: number | null }
export interface Sale { n: number; by: string; key: string; name: string; pos: PrepPos; winner: string | null; price: number; winBid: number; runnerUp: string | null; runnerBid: number }
export interface Auction { log: Sale[]; rosters: Map<string, Sale[]>; left: Map<string, number> }
export type Nomination = [number, number, number][]; // per fifth of the draft: share top / middle / cheap

const STAR_PRICE = 35; // a "star" buy, where the stars habit applies
const FAV_BOOST = 1.12; // favorite NFL team
// Roster shapes like the real ones (2022-26 auctions: QB 1-2, RB 4-5, WR 5-7, TE 0-2 per team): past
// USUAL a team bids a fraction (EXTRA_BID); at SHAPE_MAX it stops, well inside the league's limits.
const USUAL: Record<PrepPos, number> = { QB: 1, RB: 5, WR: 7, TE: 1 };
const SHAPE_MAX: Record<PrepPos, number> = { QB: 3, RB: 6, WR: 8, TE: 3 };
// The mock's dials. Fitted to real auctions by scripts/fitMock.ts (draft-prep.json mockDials); these are
// the starting values.
export interface MockDials {
  noise: number; // spread of one owner's bid around his persona price (lognormal sigma)
  deep: number; // bid factor once his starters at the position are covered
  extra: number; // bid factor past his usual roster (a backup QB gets 2.5x this, up to 1)
  pressure: number; // how hard money per open spot pushes bids (exponent)
  wild: number; // share of nominations that are a random player from the chosen group
}
export const DEFAULT_DIALS: MockDials = { noise: 0.18, deep: 0.6, extra: 0.2, pressure: 0.5, wild: 0.3 };
const extraBid = (d: MockDials, pos: PrepPos) => (pos === 'QB' ? Math.min(1, d.extra * 2.5) : d.extra); // 45% of teams carry 2 QBs
// A team's usual count and hard cap at a position: his own history (persona shape) when there is one,
// else the league's usual roster. His usual is his average rounded down when the fraction is under .5
// (a 1.4-QB owner usually carries 1); the cap is the most he has ever had, never past the league limit.
function usualOf(t: { persona: Persona | null }, pos: PrepPos): number {
  const s = t.persona?.shape?.[pos];
  return s === undefined ? USUAL[pos] : Math.round(s);
}
function capOf(t: { persona: Persona | null }, pos: PrepPos): number {
  const m = t.persona?.shapeMax?.[pos];
  return Math.min(POS_MAX[pos] ?? 99, m === undefined ? SHAPE_MAX[pos] : Math.max(m, usualOf(t, pos)));
}

// Spots a team still has to fill to field a lineup (QB, 2 RB, 2 WR, a WR or TE for WR/TE; FLEX takes any).
function stillNeeds(f: Record<PrepPos, number>): Partial<Record<PrepPos, number>> {
  const n: Partial<Record<PrepPos, number>> = {};
  if (f.QB < 1) n.QB = 1;
  if (f.RB < 2) n.RB = 2 - f.RB;
  if (f.WR < 2) n.WR = 2 - f.WR;
  if (f.WR < 3 && f.TE < 1) n.WR = (n.WR ?? 0) + 1; // the WR/TE spot, met by a WR or a TE
  return n;
}
const MAX_PRESSURE = 2; // cap on money-per-spot pressure
const STARTERS: Record<PrepPos, number> = { QB: 1, RB: 3, WR: 4, TE: 1 }; // a lineup's worth incl. flex spots
// Used when the file has no measured order: 2022-26 auctions.
export const DEFAULT_NOMINATION: Nomination = [[0.65, 0.31, 0.04], [0.21, 0.65, 0.14], [0.01, 0.64, 0.36], [0.01, 0.15, 0.85], [0, 0.01, 0.99]];

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const gaussOf = (rand: () => number) => () => Math.sqrt(-2 * Math.log(rand() || 1e-9)) * Math.cos(2 * Math.PI * rand());

// With many bidders the price (second-highest bid) runs above a typical bid, and the persona habits
// (position lean x overpay, x stars for a star) push it higher still: several owners love a star, so the
// second-highest of their bids sat at the slot ceiling every time (Chase $89 in all 200 mocks, Nov 18;
// he really went for $70 in 2026, top WRs $64-77). Divide it back out per position, star or not, with
// this league's personas, so a player sells for about his expected cost on average. A persona's habits
// still decide WHO buys him; this keeps them from also deciding that everyone overpays.
export type Calib = number | Record<PrepPos, [number, number]>; // per position: [not a star, star]
function secondHighest(mults: number[], rand: () => number, noise: number): number {
  const gauss = gaussOf(rand), n = Math.max(2, mults.length);
  let sum = 0;
  for (let d = 0; d < 2000; d++) {
    const xs = Array.from({ length: n }, (_, i) => (mults[i] ?? 1) * Math.exp(noise * gauss())).sort((a, b) => b - a);
    sum += xs[1]!;
  }
  return sum / 2000;
}
const calibOf = (c: Calib, r: PrepRow) => (typeof c === 'number' ? c : c[r.pos][r.cost >= STAR_PRICE ? 1 : 0]);

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
// o: his open spots, when the caller already has them.
function canTake(t: { filled: Record<PrepPos, number>; bid?: unknown; persona?: Persona | null }, r: PrepRow, o = open(t)): { ok: boolean; need: boolean } {
  if (o <= 0 || (POS_MAX[r.pos] !== undefined && t.filled[r.pos] >= POS_MAX[r.pos]!)) return { ok: false, need: false };
  if (!t.bid && t.filled[r.pos] >= capOf(t as { persona: Persona | null }, r.pos)) return { ok: false, need: false };
  const needs = stillNeeds(t.filled), short = Object.values(needs).reduce((x, y) => x + (y ?? 0), 0);
  const fills = (needs[r.pos] ?? 0) > 0 || (r.pos === 'TE' && t.filled.WR < 3 && t.filled.TE < 1);
  if (o <= short && !fills) return { ok: false, need: false };
  return { ok: true, need: o <= short && fills };
}

// One full auction. pool: players up for auction (keepers removed). order: team names in nomination order.
export function runAuction(pool: PrepRow[], teams: SimTeam[], keyOf: (r: PrepRow) => string, rand: () => number, nomination: Nomination = DEFAULT_NOMINATION, calib: Calib = 1, dials: MockDials = DEFAULT_DIALS): Auction {
  const gauss = gaussOf(rand);
  const state = teams.map((t) => ({ ...t, left: t.budget, filled: { QB: 0, RB: 0, WR: 0, TE: 0, ...t.filled } as Record<PrepPos, number> }));
  const order = state.map((t) => ({ t, k: rand() })).sort((a, b) => a.k - b.k).map((x) => x.t);
  const byPrice = [...pool].sort((a, b) => b.cost - a.cost);
  const group = new Map(byPrice.map((r, i) => [r, i < 24 ? 0 : i < 72 ? 1 : 2]));
  const left = new Set(byPrice);
  const total = Math.min(byPrice.length, state.reduce((s, t) => s + open(t), 0));
  const log: Sale[] = [];
  let turn = 0, filledSoFar = 0; // filledSoFar: sales with a winner, the stage of the draft
  while (left.size && state.some((t) => open(t) > 0)) {
    // Nominator: the next team in turn that still has a spot.
    let by = order[turn++ % order.length]!;
    for (let i = 0; i < order.length && open(by) <= 0; i++) by = order[turn++ % order.length]!;
    // Which group: the league's rates for this stage of the draft, falling back to any group left.
    const stage = nomination[Math.min(nomination.length - 1, Math.floor((filledSoFar * nomination.length) / Math.max(1, total)))]!;
    let g = 2, x = rand() * (stage[0] + stage[1] + stage[2] || 1);
    for (let i = 0; i < 3; i++) { if (x < stage[i]!) { g = i; break; } x -= stage[i]!; }
    // He nominates someone he could take himself (he opens the bidding at $1): by position, checked once.
    const okPos = new Set((['QB', 'RB', 'WR', 'TE'] as PrepPos[]).filter((pos) => canTake(by, { pos } as PrepRow).ok));
    const mine: PrepRow[] = [];
    let cands: PrepRow[] = [];
    for (const r of left) if (okPos.has(r.pos)) { mine.push(r); if (group.get(r) === g) cands.push(r); }
    if (!cands.length) cands = mine.length ? mine : [...left];
    // Usually the priciest at a position he doesn't need (drain the others); sometimes a wild card.
    // Early and middle: a position he doesn't need, to drain the others. Late (cheap players): one he wants.
    // Need depends only on position, so it is worked out once per position, not per candidate.
    const want = (pos: PrepPos) => (by.filled[pos] < usualOf(by, pos) ? 1 : 0) + (by.filled[pos] < STARTERS[pos] ? 1 : 0) + (by.persona ? by.persona.lean[pos] - 1 : 0);
    const needOf = {} as Record<PrepPos, number>;
    for (const pos of PREP_POS) needOf[pos] = g === 2 ? -want(pos) : want(pos);
    let r = cands[0]!;
    if (rand() < dials.wild) r = cands[Math.floor(rand() * cands.length)]!;
    else for (const c of cands) if (needOf[c.pos] < needOf[r.pos] || (needOf[c.pos] === needOf[r.pos] && c.cost > r.cost)) r = c;
    left.delete(r);
    // Bids. Open spots don't change until this sale is settled, so count them once.
    const opens = state.map(open);
    const spotsLeft = opens.reduce((x, o) => x + Math.max(0, o), 0);
    // Money pressure: an owner with more money per open spot than the league bids up, one with less
    // bids down (real teams spend nearly all $200). dials.pressure sets how hard.
    const moneyLeft = state.reduce((x, t, i) => x + (opens[i]! > 0 ? t.left : 0), 0);
    const perSpot = spotsLeft ? moneyLeft / spotsLeft : 1;
    const phase = filledSoFar / Math.max(1, total); // pressure builds as the draft goes: none at the opening bid
    let best = 0, second = 0, win = -1, run = -1;
    state.forEach((t, i) => {
      const o = opens[i]!, take = canTake(t, r, o);
      if (!take.ok) return;
      const maxBid = t.left - (o - 1);
      if (maxBid < 1) return;
      let w: number;
      const must = take.need || t === by || left.size < 2 * spotsLeft; // a lineup need, his own nomination, or the pool running out
      // Roster shape: less interest past his starters, much less past a usual roster, none past the shape cap.
      const usual = usualOf(t, r.pos), cap = capOf(t, r.pos);
      const shaped = (x: number) => {
        if (t.filled[r.pos] >= cap) return 0;
        if (t.filled[r.pos] >= usual) x *= extraBid(dials, r.pos); else if (t.filled[r.pos] >= Math.min(usual, STARTERS[r.pos])) x *= dials.deep;
        // Under $1 of interest: he bids the $1 minimum only that share of the time (so a lukewarm owner
        // doesn't win every $1 coin flip).
        if (x < 1) { if (!must && rand() >= x) return 0; x = 1; }
        return x;
      };
      const isPlanned = t.planned?.has(keyOf(r)) ?? false;
      if (t.bid && (isPlanned || !t.market)) {
        w = isPlanned ? t.bid(r) : shaped(t.bid(r));
        if (t === by) w = Math.max(1, w); // the nominator opens at $1
      } else {
        w = (r.cost / calibOf(calib, r)) * Math.exp(dials.noise * gauss()) * Math.min(MAX_PRESSURE, Math.max(1 / MAX_PRESSURE, (t.left / o / perSpot) ** (dials.pressure * phase)));
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
      // Off-plan buys keep back the money and the roster spots his planned players still need (Nic, Nov 18:
      // the rest of the team is filled around the players he wants, without spending their money). Without
      // the spots, market buys filled his roster before his late $1 targets came up (Nov 19).
      if (t.bid && !isPlanned && t.planned?.size) {
        let keep = 0, wanted = 0;
        for (const x of left) if (t.planned.has(keyOf(x))) { keep += Math.max(0, t.bid(x) - 1); wanted++; }
        if (o <= wanted) return; // every open spot is spoken for by a planned player still to come
        w = Math.min(w, Math.max(t === by ? 1 : 0, maxBid - keep));
      }
      w = Math.min(maxBid, w);
      if (w < 1) return;
      if (w > best || (w === best && rand() < 0.5)) { second = best; run = win; best = w; win = i; } else if (w > second) { second = w; run = i; }
    });
    const price = win < 0 ? 0 : Math.max(1, Math.min(Math.floor(best), Math.floor(second) + 1));
    const sale: Sale = { n: log.length + 1, by: by.name, key: keyOf(r), name: r.name, pos: r.pos, winner: win < 0 ? null : state[win]!.name, price, winBid: Math.floor(best), runnerUp: run < 0 ? null : state[run]!.name, runnerBid: Math.floor(second) };
    if (win >= 0) { const w = state[win]!; w.left -= price; w.filled[r.pos]++; filledSoFar++; }
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
// teams: the persona-driven teams (Nic's own bids are left out, as before).
export function calibrate(teams: { persona: Persona | null }[], seed = 8, noise = DEFAULT_DIALS.noise): Calib {
  const out = {} as Record<PrepPos, [number, number]>;
  for (const pos of ['QB', 'RB', 'WR', 'TE'] as PrepPos[]) {
    const m = (star: boolean) => teams.map((t) => (t.persona ? t.persona.lean[pos] * t.persona.overpay * (star ? t.persona.stars : 1) : 1));
    out[pos] = [secondHighest(m(false), rng(seed), noise), secondHighest(m(true), rng(seed), noise)];
  }
  return out;
}

// rows: the priced board (keepers and Nic's planned buys already taken). myMax: what Nic would pay per
// player (his planned bid, else the expected cost; the ceiling is only a reference, Nic Nov 18).
// plan: Nic's planned (non-keeper) players, for plan odds. Nic is not in these auctions: they measure
// what everyone else would pay.
export function simulate(rows: PrepRow[], teams: SimTeam[], myMax: (r: PrepRow) => number, keyOf: (r: PrepRow) => string, plan: string[] = [], runs = 200, seed = 7, nomination: Nomination = DEFAULT_NOMINATION, dials: MockDials = DEFAULT_DIALS): SimOut {
  const pool = poolOf(rows);
  // mine: Nic's max for him, the same every run, so asked once.
  const stats = new Map<string, { get: number; price: number; buyers: Map<string, number>; mine: number; planned: boolean }>();
  const byKey = new Map(rows.map((r) => [keyOf(r), r]));
  const inPlan = new Set(plan);
  for (const r of rows) if (!r.keeper) { const key = keyOf(r); stats.set(key, { get: 0, price: 0, buyers: new Map(), mine: myMax(byKey.get(key)!), planned: inPlan.has(key) }); }
  const rand = rng(seed), calib = calibrate(teams, 8, dials.noise);
  // Gettable: Nic gets him if his bid beats the most anyone else would pay (the winner's bid).
  let planHits = 0;
  for (let run = 0; run < runs; run++) {
    const sales = new Map(runAuction(pool, teams, keyOf, rand, nomination, calib, dials).log.map((x) => [x.key, x]));
    let ok = true;
    for (const [key, st] of stats) {
      const sale = sales.get(key), mine = st.mine;
      const top = sale?.winner ? sale.winBid : 0;
      if (mine > top) st.get++; else if (mine === top) st.get += 0.5; // a tie: a coin flip on who bid first
      if (mine < top && st.planned) ok = false;
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

// ---------- plain-data entry points (for the auction worker) ----------
// A worker only gets copies of plain data, never functions, so the pages describe a team's bidding
// as data and these turn it back into the functions above. Players are keyed by name and position,
// as on the Board.
export const auctionKey = (r: PrepRow) => playerKey(r.name, r.pos);

// A team as plain data. bids: his planned top bid per player key; rest: what he bids on everyone else
// ('one': $1, else an auto-fill strategy). No bids: a persona team.
export interface PlainTeam { name: string; budget: number; filled: SimTeam['filled']; persona: Persona | null; bids?: Record<string, number>; rest?: 'one' | Strategy; market?: boolean }

export function liveTeam(t: PlainTeam): SimTeam {
  const { bids, rest, ...team } = t;
  if (!bids) return team;
  return { ...team, bid: (r) => bids[auctionKey(r)] ?? (!rest || rest === 'one' ? 1 : strategyBid(rest, r)), planned: new Set(Object.keys(bids)) };
}

// The Board's Get %: the other teams' auctions, with Nic's max = his planned bid, else the expected cost.
export function simulateBoard(rows: PrepRow[], teams: SimTeam[], myBids: Record<string, number>, runs: number, seed = 7, nomination?: Nomination, dials?: MockDials): SimOut {
  return simulate(rows, teams, (r) => myBids[auctionKey(r)] ?? Math.round(r.cost), auctionKey, Object.keys(myBids), runs, seed, nomination, dials);
}

// ---------- the Mock draft page: your draft outlook ----------
// Plays n auctions with Nic's team in them and sums them up in his terms: how often his whole plan comes
// together, each planned player's chance and who usually beats him to it, what his team usually looks
// like, and a few of the drafts themselves to watch.
export const playerTeam = (key: string, team: string | null) => `${key}\u0000${team}`;
export const OUTLOOK_EXAMPLES = 12; // the typical draft plus 11 more to browse (all 100 would cost ~17 ms to hand back)

export interface TargetOutlook {
  key: string; name: string; pos: PrepPos; bid: number;
  get: number; // share of drafts he ends up on Nic's team
  rival: string | null; rivalShare: number; // the team that takes him most often when Nic doesn't, and how often
  rivalPrice: number | null; // what that team usually pays (median)
  toWin: number | null; // the bid that would have beaten the winner, in the median draft Nic lost him
}
export interface DraftOutlook {
  run: number; // which set of drafts this is (the page's Re-Roll Draft count)
  n: number;
  examples: Auction[]; // examples[0] is the most typical draft
  freq: Map<string, number>; // playerTeam(key, team): share of drafts that team landed him
  planOdds: number | null; // share of drafts Nic gets every planned player (null: no plan)
  landed: number | null; // how many of his planned players he usually gets (median; null: no plan)
  targets: TargetOutlook[]; // his planned players, least likely first
  usual: { bought: number; left: number } | null; // Nic's median players bought and money left
}

const median = (xs: number[]) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

// The most typical draft is a real single draft (nobody on two teams, every budget and roster rule kept):
// the one where the most players went where they usually go, scored by summing freq over its sales.
export function draftOutlook(pool: PrepRow[], teams: SimTeam[], me: string | null, plan: Record<string, number>, run: number, n: number, nomination: Nomination | undefined, calib: Calib, dials: MockDials): DraftOutlook {
  const rand = rng(run * 104729);
  const drafts = Array.from({ length: n }, () => runAuction(pool, teams, auctionKey, rand, nomination, calib, dials));
  const freq = new Map<string, number>();
  for (const a of drafts) for (const x of a.log) if (x.winner) freq.set(playerTeam(x.key, x.winner), (freq.get(playerTeam(x.key, x.winner)) ?? 0) + 1 / n);
  const score = (a: Auction) => a.log.reduce((t, x) => t + (x.winner ? freq.get(playerTeam(x.key, x.winner))! : 0), 0);
  let best = 0;
  drafts.forEach((a, i) => { if (score(a) > score(drafts[best]!)) best = i; });
  const examples = [drafts[best]!, ...drafts.filter((_, i) => i !== best).slice(0, OUTLOOK_EXAMPLES - 1)];

  const inPool = new Map(pool.map((r) => [auctionKey(r), r]));
  const planned = me ? Object.keys(plan).filter((k) => inPool.has(k)) : [];
  const sales = drafts.map((a) => new Map(a.log.map((x) => [x.key, x])));
  const targets: TargetOutlook[] = planned.map((key) => {
    const r = inPool.get(key)!;
    let mine = 0;
    const others = new Map<string, number[]>(), beat: number[] = [];
    for (const s of sales) {
      const x = s.get(key);
      if (x?.winner === me) { mine++; continue; }
      if (!x?.winner) continue;
      (others.get(x.winner) ?? others.set(x.winner, []).get(x.winner)!).push(x.price);
      beat.push(x.winBid + 1);
    }
    const [rival, paid] = [...others].sort((a, b) => b[1].length - a[1].length)[0] ?? [null, []];
    return { key, name: r.name, pos: r.pos, bid: plan[key]!, get: mine / n, rival, rivalShare: paid.length / n, rivalPrice: median(paid), toWin: median(beat) };
  }).sort((a, b) => a.get - b.get || b.bid - a.bid);
  const got = sales.map((s) => planned.filter((k) => s.get(k)?.winner === me).length);
  const planOdds = planned.length ? got.filter((g) => g === planned.length).length / n : null;
  const landed = planned.length ? median(got) : null;
  const usual = me ? { bought: median(drafts.map((a) => a.rosters.get(me)?.length ?? 0))!, left: median(drafts.map((a) => a.left.get(me) ?? 0))! } : null;
  return { run, n, examples, freq, planOdds, landed, targets, usual };
}
