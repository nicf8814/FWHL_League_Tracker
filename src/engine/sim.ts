import type { SimConfig, TeamId } from '../data/schema.ts';

// Pure season math shared by the standings table, the playoff simulation (in a Web Worker) and tests.
// No DOM, no imports beyond types, so the worker bundle stays tiny.

export type GameRow = readonly [week: number, home: TeamId, away: TeamId, homePts: number | null, awayPts: number | null, final: boolean];

export interface SimInput {
  teamIds: TeamId[];
  games: GameRow[];
  strength: Record<TeamId, number>; // projected starting-lineup points per week
  cfg: SimConfig;
  top6Weeks: number[];
  seedsByRecord: number;
  thru?: number | null; // pretend only weeks <= thru are played (odds history)
  runs?: number;
}

export interface SimResult {
  odds: Record<TeamId, number>;
  byRecord: Record<TeamId, number>; // made it as a top-N record seed
  byPf: Record<TeamId, number>; // made it as the points-for seed
}

// Top-6 weeks: W if fewer than 6 teams outscore you, L if 6 or more do, T when you straddle the line.
export function rank6(score: number, others: number[]): 'W' | 'L' | 'T' {
  const hi = others.filter((x) => x > score + 1e-9).length;
  const eq = others.filter((x) => Math.abs(x - score) <= 1e-9).length;
  return hi + eq < 6 ? 'W' : hi >= 6 ? 'L' : 'T';
}

export interface Tally {
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  h2h: Map<TeamId, number>; // head-to-head wins against each opponent
}

// Records from final games: head-to-head weeks by score, top-6 weeks by rank6.
export function tally(teamIds: TeamId[], games: readonly GameRow[], top6Weeks: readonly number[], thru?: number | null): Map<TeamId, Tally> {
  const T = new Map<TeamId, Tally>(teamIds.map((i) => [i, { w: 0, l: 0, t: 0, pf: 0, pa: 0, h2h: new Map() }]));
  const top6 = new Map<number, [TeamId, number][]>();
  for (const [w, h, a, hs, as, fin] of games) {
    if (!fin || hs === null || as === null || (thru && w > thru)) continue;
    const H = T.get(h), A = T.get(a);
    if (!H || !A) continue;
    H.pf += hs; H.pa += as; A.pf += as; A.pa += hs;
    if (top6Weeks.includes(w)) {
      const arr = top6.get(w) ?? [];
      arr.push([h, hs], [a, as]);
      top6.set(w, arr);
      continue;
    }
    if (hs > as) { H.w++; A.l++; H.h2h.set(a, (H.h2h.get(a) ?? 0) + 1); }
    else if (as > hs) { A.w++; H.l++; A.h2h.set(h, (A.h2h.get(h) ?? 0) + 1); }
    else { H.t++; A.t++; }
  }
  for (const arr of top6.values())
    for (const [i, sc] of arr) {
      const r = rank6(sc, arr.filter((x) => x[0] !== i).map((x) => x[1]));
      const x = T.get(i)!;
      if (r === 'W') x.w++; else if (r === 'L') x.l++; else x.t++;
    }
  return T;
}

// League seeding: wins, ties inside a win group broken by head-to-head wins within the group, then
// points for. Seeds 1..N by record; the next seed is the best points-for among everyone else.
export function seed(ids: TeamId[], wins: (i: TeamId) => number, pf: (i: TeamId) => number, h2h: (i: TeamId, j: TeamId) => number, byRecord: number): TeamId[] {
  const order = [...ids].sort((a, b) => wins(b) - wins(a) || pf(b) - pf(a));
  const seeded: TeamId[] = [];
  for (let i = 0; i < order.length; ) {
    let j = i;
    while (j < order.length && wins(order[j]!) === wins(order[i]!)) j++;
    const g = order.slice(i, j);
    if (g.length > 1) {
      const hh = (t: TeamId) => g.reduce((s, o) => s + (o !== t ? h2h(t, o) : 0), 0);
      g.sort((a, b) => hh(b) - hh(a) || pf(b) - pf(a));
    }
    seeded.push(...g);
    i = j;
  }
  const top = seeded.slice(0, byRecord);
  const rest = seeded.slice(byRecord);
  const wc = [...rest].sort((a, b) => pf(b) - pf(a))[0];
  return wc === undefined ? top : [...top, wc, ...rest.filter((x) => x !== wc)];
}

// Deterministic PRNG (fixed seed) so the same inputs always give the same odds.
function rng(seed0: number) {
  let s = seed0 | 0;
  const rnd = () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const normal = () => {
    let u = 0;
    while (!u) u = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rnd());
  };
  return normal;
}

// Monte Carlo of the remaining schedule. Team strength = half projected lineup (scaled to league
// scoring), half actual points per game, shrunk toward the league average.
export function simulate(inp: SimInput): SimResult {
  const { teamIds: ids, cfg } = inp;
  const runs = inp.runs ?? cfg.runs;
  const base = tally(ids, inp.games, inp.top6Weeks, inp.thru);
  const played = new Map<TeamId, number>(ids.map((i) => [i, 0]));
  const left: GameRow[] = [];
  for (const g of inp.games) {
    if (!g[5] || (inp.thru && g[0] > inp.thru)) left.push(g);
    else { played.set(g[1], (played.get(g[1]) ?? 0) + 1); played.set(g[2], (played.get(g[2]) ?? 0) + 1); }
  }
  const avgRaw = ids.reduce((s, i) => s + (inp.strength[i] ?? 0), 0) / ids.length || 1;
  const mean = new Map<TeamId, number>();
  for (const i of ids) {
    const proj = ((inp.strength[i] ?? 0) * cfg.avgScore) / avgRaw;
    const g = played.get(i) ?? 0;
    const actual = g ? base.get(i)!.pf / g : cfg.avgScore;
    mean.set(i, cfg.avgScore + cfg.shrink * ((proj + actual) / 2 - cfg.avgScore));
  }
  const weeks = [...new Set(left.map((g) => g[0]))].sort((a, b) => a - b);
  const byWeek = new Map(weeks.map((w) => [w, left.filter((g) => g[0] === w)]));
  const normal = rng(cfg.seed);
  const made = new Map<TeamId, number>(ids.map((i) => [i, 0]));
  const m5 = new Map(made), m6 = new Map(made);

  for (let s = 0; s < runs; s++) {
    const W = new Map<TeamId, number>(), PF = new Map<TeamId, number>(), H = new Map<TeamId, Map<TeamId, number>>(), off = new Map<TeamId, number>();
    for (const i of ids) {
      const b = base.get(i)!;
      W.set(i, b.w + b.t / 2); PF.set(i, b.pf); H.set(i, new Map(b.h2h)); off.set(i, cfg.teamSd * normal());
    }
    for (const w of weeks) {
      const sc = new Map<TeamId, number>();
      for (const i of ids) {
        const v = mean.get(i)! + off.get(i)! + cfg.weeklySd * normal();
        sc.set(i, v);
        PF.set(i, PF.get(i)! + v);
      }
      // LOGIC-17: an exact tie is a tie (half a win each), same as in the real standings.
      if (inp.top6Weeks.includes(w)) {
        for (const i of ids) { const r = rank6(sc.get(i)!, ids.filter((j) => j !== i).map((j) => sc.get(j)!)); if (r !== 'L') W.set(i, W.get(i)! + (r === 'W' ? 1 : 0.5)); }
      } else {
        for (const [, h, a] of byWeek.get(w)!) {
          if (sc.get(h) === sc.get(a)) { W.set(h, W.get(h)! + 0.5); W.set(a, W.get(a)! + 0.5); continue; }
          const x = sc.get(h)! > sc.get(a)! ? h : a, y = x === h ? a : h;
          W.set(x, W.get(x)! + 1);
          H.get(x)!.set(y, (H.get(x)!.get(y) ?? 0) + 1);
        }
      }
    }
    const order = seed(ids, (i) => W.get(i)!, (i) => PF.get(i)!, (i, j) => H.get(i)!.get(j) ?? 0, inp.seedsByRecord);
    order.slice(0, inp.seedsByRecord).forEach((t) => { made.set(t, made.get(t)! + 1); m5.set(t, m5.get(t)! + 1); });
    const wc = order[inp.seedsByRecord];
    if (wc !== undefined) { made.set(wc, made.get(wc)! + 1); m6.set(wc, m6.get(wc)! + 1); }
  }
  const pct = (m: Map<TeamId, number>) => Object.fromEntries(ids.map((i) => [i, m.get(i)! / runs]));
  return { odds: pct(made), byRecord: pct(m5), byPf: pct(m6) };
}

// Odds as they stood after each played week (today's rosters, so early weeks are approximate).
export function oddsHistory(inp: SimInput, thru: number, runs = 1000): Record<number, Record<TeamId, number>> {
  const out: Record<number, Record<TeamId, number>> = {};
  for (let w = 1; w <= thru; w++) out[w] = simulate({ ...inp, thru: w, runs }).odds;
  return out;
}
