// Grades a past season's trade from the weekly lineup files. Runs at build time (scripts/trades.ts);
// the page only reads the results. Each side is graded on its own, so both sides can win.
//
// Five parts, each scaled by how big that part runs across every trade (SCALE_PCT of the sizes),
// so a typical big swing counts as 1, then capped at -1..1 and weighted (WEIGHTS):
//   deal (20%)   A fair deal at the trade, in dollars, got minus gave: projected points above
//                replacement for the rest of the season at that draft's dollars per point, plus each
//                player's keeper right (what his projected pace would be worth next season minus his
//                keeper price, never below 0). There are no trade-chart values for past seasons.
//   wins (30%)   Each week replayed with the trade undone (best lineup with and without the players),
//                seeded by that season's rules (data/history/rules.csv): wins gained, plus 3 for making
//                or missing the playoffs (the points-for 6th seed included) and 1 for a bye.
//   points (15%) Points for gained for the rest of the season, from the same replay: the team's best
//                lineup each week with the trade minus without it. Only points a lineup would have used
//                count, net of whoever would have started instead; it also drives the points-for 6th seed.
//   (shown, not graded) Points per week above replacement, got minus gave: the 12th QB, 31st RB, 34th
//                WR and 7th TE among rostered players that week; a week a player didn't play is even.
//   keep (25%)   Keeper value in dollars (worth - keeper price): players this side kept the next season,
//                good keeps and bad, then the season after at 60% if kept again. Minus the keeper rights it
//                gave up: each player it traded away who was kept the next season, at what he was worth
//                over his keeper price when that was more than 0. Counted once each season is over.
//   next (10%)   The next season replayed for each player this side kept, with him swapped for what his
//                keeper price would have bought at auction: wins, playoffs and bye, as above.
import type { OwnerKey } from '../data/history.ts';
import type { Lineups } from '../data/lineups.ts';
import type { KeeperLine, TradePart, TradePlayerLine, TradeSide } from '../data/trades.ts';
import { letter } from './replay.ts';

export const REPL_RANK: Record<string, number> = { QB: 12, RB: 31, WR: 34, TE: 7, K: 12, 'D/ST': 12 };
export const WEIGHTS: Record<TradePart, number> = { deal: 0.2, wins: 0.3, points: 0.15, keep: 0.25, next: 0.1 };
export const SCALE_PCT = 0.9; // a part's scale: this share of the nonzero sizes across all trades
export const PLAYOFF_UNITS = 3, BYE_UNITS = 1, BYE_SEEDS = 2;
export const YEAR2 = 0.6; // the second season after the trade counts this much
export const ESCALATOR = [10, 15, 10]; // keeper price over last season's: 1st, 2nd and 3rd straight keep
const DPP_FALLBACK = 0.35; // dollars per point when a draft has no basis
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

export interface SeasonInput {
  year: number;
  L: Lineups;
  key: (name: string, pos: string) => string; // player identity across files
  slots: string[][]; // starting slots, each the positions allowed
  games: { week: number; home: OwnerKey; away: OwnerKey; hs: number; as: number }[]; // regular season
  playoffTeams: number;
  lastWeek: number; // last week with games
  finish: Map<OwnerKey, number | null>;
  rules: SeasonRules;
}
// The league's playoff rules that season (data/history/rules.csv).
export interface SeasonRules {
  seedsByRecord: number; // seeds 1..N by record; the rest of the playoff field by points for
  tiebreak: 'pf' | 'h2h'; // ties on record: points for, or head-to-head win % among the tied teams then points for
  top6Weeks: number[]; // weeks scored top 6 = W, bottom 6 = L instead of head to head
}
export interface TradeInput { week: number; sides: [{ owner: OwnerKey; gets: string[] }, { owner: OwnerKey; gets: string[] }] }
// What happened after the trade season: the drafts and the seasons that followed.
export interface DraftFacts { owner: OwnerKey; price: number; keeper: boolean; value: number | null; worth: number | null }
export interface Future {
  current: number; // the season being played; seasons before it are over
  pick: (year: number, key: string) => DraftFacts | null; // the player's pick in that season's draft
  dpp: (year: number) => number | null; // that draft's dollars per point over replacement
  season: (year: number) => { S: SeasonInput; W: Map<number, WeekIndex> } | null; // null: no weekly lineups
}
// What gradeTrade measures for one side, before scaling.
export interface RawSide { deal: number; wins: number[]; points: number[]; keep: number; next: number } // wins/points: after week 1..n

// "QB x1, RB x2, RB/WR/TE x1, ... BE x6, IR x1" -> starting slots
export function parseSlots(roster: string): string[][] {
  const out: string[][] = [];
  for (const part of roster.split(',')) {
    const m = part.trim().match(/^(.+) x(\d+)$/);
    if (!m || m[1] === 'BE' || m[1] === 'IR') continue;
    for (let i = 0; i < Number(m[2]); i++) out.push(m[1]!.split('/').map((p) => (p === 'DEF' ? 'D/ST' : p)));
  }
  return out;
}

// Best possible lineup score: tightest slots first, each takes the best player left that fits.
export function bestLineup(slots: string[][], players: { pos: string; pts: number }[]): number {
  const left = [...players].sort((a, b) => b.pts - a.pts);
  let total = 0;
  for (const s of [...slots].sort((a, b) => a.length - b.length)) {
    const i = left.findIndex((p) => s.includes(p.pos));
    if (i >= 0) { total += left[i]!.pts; left.splice(i, 1); }
  }
  return total;
}

export interface WeekIndex {
  at: Map<string, { owner: OwnerKey; pts: number | null; proj: number | null; started: boolean }>; // player key -> where he was
  roster: Map<OwnerKey, { key: string; pos: string; pts: number }[]>;
  repl: Map<string, number>; // position -> replacement points
  replProj: Map<string, number>;
}

export function indexSeason(S: SeasonInput): Map<number, WeekIndex> {
  const out = new Map<number, WeekIndex>();
  for (const [w, teams] of Object.entries(S.L.weeks)) {
    const at: WeekIndex['at'] = new Map(), roster: WeekIndex['roster'] = new Map();
    const byPos = new Map<string, number[]>(), projByPos = new Map<string, number[]>();
    for (const [o, t] of Object.entries(teams)) {
      const r: { key: string; pos: string; pts: number }[] = [];
      for (const [x, started] of [...t.s.map((x) => [x, true] as const), ...t.b.filter((x) => x[1] !== 'IR').map((x) => [x, false] as const)]) {
        if (x[0] < 0) continue;
        const [nm, pos] = S.L.players[x[0]]!;
        const k = S.key(nm, pos);
        at.set(k, { owner: o, pts: x[2], proj: x[3], started });
        r.push({ key: k, pos, pts: x[2] ?? 0 });
        byPos.set(pos, [...(byPos.get(pos) ?? []), x[2] ?? 0]);
        if (x[3] !== null) projByPos.set(pos, [...(projByPos.get(pos) ?? []), x[3]]);
      }
      roster.set(o, r);
    }
    const nth = (m: Map<string, number[]>) => new Map([...m].map(([pos, v]) => { const s = v.sort((a, b) => b - a); return [pos, s[Math.min((REPL_RANK[pos] ?? 12) - 1, s.length - 1)]!]; }));
    out.set(Number(w), { at, roster, repl: nth(byPos), replProj: nth(projByPos) });
  }
  return out;
}

const posOf = (W: Map<number, WeekIndex>, k: string, fallback: string) => { for (const wk of W.values()) { const a = wk.roster; for (const r of a.values()) { const f = r.find((x) => x.key === k); if (f) return f.pos; } } return fallback; };

// Records and seeds under that season's rules, with each team's weekly score from `score`.
// shortcut: these rules give the real playoff field in every season but 2011, where a three-way tie
// at 7-6 (each 1-1 against the others) went a way no rule here explains. Revisit if Nic finds it.
export function standings(S: SeasonInput, score: (week: number, o: OwnerKey, real: number) => number) {
  const T = new Map<OwnerKey, { w: number; l: number; t: number; pf: number }>();
  const rec = (o: OwnerKey) => { let r = T.get(o); if (!r) { r = { w: 0, l: 0, t: 0, pf: 0 }; T.set(o, r); } return r; };
  const h2h = new Map<string, [number, number]>(); // "a|b" -> [a's wins against b, games]
  const top6 = new Map<number, [OwnerKey, number][]>();
  for (const g of S.games) {
    const h = score(g.week, g.home, g.hs), a = score(g.week, g.away, g.as);
    rec(g.home).pf += h; rec(g.away).pf += a;
    if (S.rules.top6Weeks.includes(g.week)) { top6.set(g.week, [...(top6.get(g.week) ?? []), [g.home, h], [g.away, a]]); continue; }
    for (const [o, p, f, x] of [[g.home, g.away, h, a], [g.away, g.home, a, h]] as const) {
      const r = rec(o), m = h2h.get(`${o}|${p}`) ?? [0, 0];
      if (f > x) { r.w++; m[0]++; } else if (f < x) r.l++; else { r.t++; m[0] += 0.5; }
      m[1]++; h2h.set(`${o}|${p}`, m);
    }
  }
  for (const arr of top6.values()) for (const [o, sc] of arr) {
    const above = arr.filter((x) => x[1] > sc).length, level = arr.filter((x) => x[1] === sc).length; // level counts o too
    const r = rec(o);
    if (above + level <= 6) r.w++; else if (above >= 6) r.l++; else r.t++; // a tie across the line is a tie
  }
  const wins = (o: OwnerKey) => T.get(o)!.w + T.get(o)!.t / 2, pf = (o: OwnerKey) => T.get(o)!.pf;
  const byRecord = [...T.keys()].sort((a, b) => wins(b) - wins(a) || pf(b) - pf(a));
  const order: OwnerKey[] = [];
  for (let i = 0; i < byRecord.length;) {
    let j = i;
    while (j < byRecord.length && wins(byRecord[j]!) === wins(byRecord[i]!)) j++;
    const g = byRecord.slice(i, j);
    if (S.rules.tiebreak === 'h2h' && g.length > 1) {
      const pct = (o: OwnerKey) => { let w = 0, n = 0; for (const p of g) { const m = h2h.get(`${o}|${p}`); if (p !== o && m) { w += m[0]; n += m[1]; } } return n ? w / n : 0.5; };
      g.sort((a, b) => pct(b) - pct(a) || pf(b) - pf(a));
    }
    order.push(...g);
    i = j;
  }
  const top = order.slice(0, S.rules.seedsByRecord);
  const wild = order.slice(S.rules.seedsByRecord).sort((a, b) => pf(b) - pf(a)).slice(0, Math.max(0, S.playoffTeams - S.rules.seedsByRecord));
  const seeds = [...top, ...wild, ...order.filter((o) => !top.includes(o) && !wild.includes(o))];
  return (o: OwnerKey) => { const r = T.get(o)!; const seed = seeds.indexOf(o) + 1; return { w: r.w, l: r.l, t: r.t, seed, playoffs: seed <= S.playoffTeams }; };
}

type Rec = { w: number; l: number; t: number; seed: number; playoffs: boolean };
// A record in wins, plus playoff and bye units once the season is complete.
const units = (r: Rec, full: boolean) => r.w + r.t / 2 + (full ? PLAYOFF_UNITS * +r.playoffs + BYE_UNITS * +(r.playoffs && r.seed <= BYE_SEEDS) : 0);
const upTo = (S: SeasonInput, week: number): SeasonInput => ({ ...S, games: S.games.filter((g) => g.week <= week) });
const r1 = (x: number) => Math.round(x * 10) / 10, r3 = (x: number) => Math.round(x * 1000) / 1000;

export type GradedSide = Omit<TradeSide, 'faab'>;

// One trade: both sides measured (RawSide), not yet scaled into grades (finishSide does that).
export function gradeTrade(S: SeasonInput, W: Map<number, WeekIndex>, t: TradeInput, F: Future, playerIdx: (k: string) => number):
  { eff: number; sides: [{ side: GradedSide; raw: RawSide | null }, { side: GradedSide; raw: RawSide | null }] } {
  const [A, B] = t.sides;
  const Y = S.year, dpp = F.dpp(Y) ?? DPP_FALLBACK;
  // First week the receiving team used one of its new players.
  let eff = t.week;
  for (let w = t.week; w <= S.lastWeek; w++) { const wk = W.get(w); if (wk && [A, B].some((s) => s.gets.some((k) => wk.at.get(k)?.owner === s.owner))) { eff = w; break; } }
  const weeks = [...W.keys()].filter((w) => w >= eff && w <= S.lastWeek).sort((a, b) => a - b);
  const pos = new Map<string, string>();
  for (const k of [...A.gets, ...B.gets]) pos.set(k, posOf(W, k, k.split('|')[1] ?? ''));

  // Points above replacement through a week; a week he didn't play is even with a replacement.
  const parTot = (k: string, upto: number) => weeks.filter((w) => w <= upto).reduce((a, w) => {
    const wk = W.get(w)!, x = wk.at.get(k);
    if (!x || ((x.pts ?? 0) === 0 && !x.proj)) return a;
    return a + (x.pts ?? 0) - (wk.repl.get(pos.get(k)!) ?? 0);
  }, 0);
  const projRate = (k: string) => {
    const vals = weeks.map((w) => { const wk = W.get(w)!; const x = wk.at.get(k); return x?.proj == null ? null : x.proj - (wk.replProj.get(pos.get(k)!) ?? 0); }).filter((v): v is number => v !== null);
    return vals.length ? Math.max(0, vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const sumOf = (ks: string[], f: (k: string) => number | null) => ks.reduce((a, k) => a + (f(k) ?? 0), 0);

  // Replay: each team's week with the trade undone = real score + best lineup without - best lineup with.
  const theirs = new Map<OwnerKey, { lose: string[]; regain: string[] }>([[A.owner, { lose: A.gets, regain: B.gets }], [B.owner, { lose: B.gets, regain: A.gets }]]);
  const alt = (week: number, o: OwnerKey, real: number) => {
    const x = theirs.get(o), wk = W.get(week);
    if (!x || !wk || week < eff) return real;
    const ros = wk.roster.get(o) ?? [];
    const without = ros.filter((r) => !x.lose.includes(r.key));
    const back = x.regain.map((k) => ({ key: k, pos: pos.get(k)!, pts: wk.at.get(k)?.pts ?? 0 }));
    return real + bestLineup(S.slots, [...without, ...back]) - bestLineup(S.slots, ros);
  };
  const realStand = standings(S, (_w, _o, r) => r), altStand = standings(S, alt);
  // Points for gained, running total after each week: the team's best lineup with the trade minus
  // without it, so only points a lineup would have used count, net of who would have started instead.
  const pfGained = (o: OwnerKey) => { let run = 0; return weeks.map((w) => (run -= alt(w, o, 0))); }; // alt(.., 0) = without - with
  const winsAfter = (o: OwnerKey, n: number) => {
    if (n === weeks.length) return units(realStand(o), true) - units(altStand(o), true);
    const S2 = upTo(S, weeks[n - 1]!);
    return units(standings(S2, (_w, _o, r) => r)(o), false) - units(standings(S2, alt)(o), false);
  };

  // Keeper rights. shortcut: a player with no pick this season (a waiver pickup) is priced from $0,
  // so his keeper price is $10; the league prices him at max(draft, waiver) + $10. Revisit with waiver bids.
  const streak = (y: number, k: string) => { let n = 0; while (n < 5 && F.pick(y - n, k)?.keeper) n++; return n; };
  const keeperPrice = (k: string) => { const s = streak(Y, k); return s >= ESCALATOR.length ? null : (F.pick(Y, k)?.price ?? 0) + ESCALATOR[s]!; };
  const option = (k: string) => { const price = keeperPrice(k); return price === null ? 0 : Math.max(0, 1 + (projRate(k) ?? 0) * S.lastWeek * dpp - price); };
  const dealOf = (me: typeof A, op: typeof B) => dpp * weeks.length * (sumOf(me.gets, projRate) - sumOf(op.gets, projRate)) + sumOf(me.gets, option) - sumOf(op.gets, option);

  const f1 = Y + 1 < F.current, f2 = Y + 2 < F.current;
  const keepOf = (me: typeof A, op: typeof B) => {
    const kept: KeeperLine[] = [], rights: KeeperLine[] = [];
    let v = 0, final = f1;
    for (const k of me.gets) { // kept by this side: good keeps and bad
      const p1 = F.pick(Y + 1, k);
      if (!p1?.keeper || p1.owner !== me.owner) continue;
      kept.push({ p: playerIdx(k), owner: me.owner, price: p1.price, value: p1.value, year: Y + 1 });
      if (f1) v += p1.value ?? 0;
      const p2 = F.pick(Y + 2, k);
      if (p2?.keeper && p2.owner === me.owner) {
        kept.push({ p: playerIdx(k), owner: me.owner, price: p2.price, value: p2.value, year: Y + 2 });
        if (f2) v += YEAR2 * (p2.value ?? 0); else final = false;
      }
    }
    // Rights given up: a player this side traded away who was kept the next season (by anyone), at
    // what he was worth over his keeper price, when that was more than 0. A player nobody kept counts
    // 0 for both sides: keeper calls are made before the season, and passing on him was the league's call.
    for (const k of op.gets) {
      const p1 = F.pick(Y + 1, k);
      if (!p1?.keeper) continue;
      const v1 = p1.value ?? 0;
      if (v1 > 0) { rights.push({ p: playerIdx(k), owner: p1.owner, price: p1.price, value: Math.round(v1), year: Y + 1 }); if (f1) v -= v1; }
      const p2 = p1?.keeper ? F.pick(Y + 2, k) : null;
      if (p2?.keeper && p2.owner === p1!.owner && (p2.value ?? 0) > 0) {
        rights.push({ p: playerIdx(k), owner: p2.owner, price: p2.price, value: p2.value, year: Y + 2 });
        if (f2) v -= YEAR2 * p2.value!; else final = false;
      }
    }
    return { v, kept, rights, final };
  };

  // Next season, replayed with each player this side kept swapped for what his price would have bought:
  // a player at that week's replacement level plus (price - $1) of points at that draft's going rate.
  const nextOf = (me: typeof A) => {
    const N = f1 ? F.season(Y + 1) : null;
    if (!N || !N.S.games.some((g) => g.home === me.owner || g.away === me.owner)) return 0;
    const mine = me.gets.flatMap((k) => { const p1 = F.pick(Y + 1, k); return p1?.keeper && p1.owner === me.owner ? [{ k, price: p1.price }] : []; });
    if (!mine.length) return 0;
    const bonus = (price: number) => Math.max(0, price - 1) / (F.dpp(Y + 1) ?? DPP_FALLBACK) / N.S.lastWeek;
    const swap = (week: number, o: OwnerKey, real: number) => {
      const wk = N.W.get(week);
      if (o !== me.owner || !wk) return real;
      const ros = wk.roster.get(o) ?? [];
      const out = ros.map((r) => { const m = mine.find((x) => x.k === r.key); return m ? { key: `${r.key}#`, pos: r.pos, pts: (wk.repl.get(r.pos) ?? 0) + bonus(m.price) } : r; });
      return real + bestLineup(N.S.slots, out) - bestLineup(N.S.slots, ros);
    };
    return units(standings(N.S, (_w, _o, r) => r)(me.owner), true) - units(standings(N.S, swap)(me.owner), true);
  };

  const side = (me: typeof A, op: typeof B): { side: GradedSide; raw: RawSide | null } => {
    const lines: TradePlayerLine[] = me.gets.map((k) => {
      const ws = weeks.map((w) => W.get(w)!.at.get(k));
      const proj = ws.map((x) => x?.proj).filter((v): v is number => v != null);
      return { p: playerIdx(k), ptsWk: weeks.length ? r1(ws.reduce((a, x) => a + (x?.pts ?? 0), 0) / weeks.length) : null, projWk: proj.length ? r1(proj.reduce((a, b) => a + b, 0) / proj.length) : null, starts: ws.filter((x) => x?.owner === me.owner && x.started).length, weeks: weeks.length };
    });
    const graded = me.gets.length + op.gets.length > 0;
    const K = keepOf(me, op);
    const n = weeks.length;
    const raw: RawSide | null = graded ? {
      deal: dealOf(me, op),
      wins: Array.from({ length: n }, (_, i) => winsAfter(me.owner, i + 1)),
      points: pfGained(me.owner),
      keep: K.v, next: nextOf(me),
    } : null;
    const pg = graded ? sumOf(me.gets, projRate) - sumOf(op.gets, projRate) : null;
    return {
      side: {
        owner: me.owner, gets: lines, grade: null, initGrade: null, score: null, path: [], parts: null,
        prod: raw && n ? r1((sumOf(me.gets, (k) => parTot(k, weeks[n - 1]!)) - sumOf(op.gets, (k) => parTot(k, weeks[n - 1]!))) / n) : null, projGain: pg === null ? null : r1(pg),
        deal: raw ? Math.round(raw.deal) : null, winsGain: raw ? r1(raw.wins.at(-1) ?? 0) : null, ptsGain: raw ? Math.round(raw.points.at(-1) ?? 0) : null, next: raw ? r1(raw.next) : null,
        keep: Math.round(K.v), keepFinal: K.final, kept: K.kept, rights: K.rights,
        record: realStand(me.owner), alt: altStand(me.owner), finish: S.finish.get(me.owner) ?? null,
      },
      raw,
    };
  };
  return { eff, sides: [side(A, B), side(B, A)] };
}

// Each part's scale: SCALE_PCT of its nonzero sizes across all trades, so a typical big swing is 1.
// Then the same for the weighted total, so that size of trade grades A (TOP_SCORE) or F.
export const TOP_SCORE = 0.6;
export type Scales = Record<TradePart, number> & { total: number };
const weighted = (raw: RawSide, sc: Record<TradePart, number>) => {
  const part = (x: number, k: TradePart) => clamp(x / sc[k], -1, 1);
  const parts: Record<TradePart, number> = { deal: part(raw.deal, 'deal'), wins: part(raw.wins.at(-1) ?? 0, 'wins'), points: part(raw.points.at(-1) ?? 0, 'points'), keep: part(raw.keep, 'keep'), next: part(raw.next, 'next') };
  return { part, parts, sum: (Object.keys(WEIGHTS) as TradePart[]).reduce((a, k) => a + WEIGHTS[k] * parts[k], 0) };
};
export function partScales(raws: RawSide[]): Scales {
  const pct = (xs: number[]) => { const v = xs.map(Math.abs).filter((x) => x > 1e-9).sort((a, b) => a - b); return v.length ? r3(v[Math.min(v.length - 1, Math.floor(SCALE_PCT * v.length))]!) : 1; };
  const sc = { deal: pct(raws.map((r) => r.deal)), wins: pct(raws.map((r) => r.wins.at(-1) ?? 0)), points: pct(raws.map((r) => r.points.at(-1) ?? 0)), keep: pct(raws.map((r) => r.keep)), next: pct(raws.map((r) => r.next)) };
  return { ...sc, total: r3(pct(raws.map((r) => weighted(r, sc).sum)) / TOP_SCORE) };
}

// The grade: each part scaled and capped at -1..1, then weighted. The weekly path shows the deal,
// wins and points known after each week; keepers and next season join at the end.
export function finishSide(s: GradedSide, raw: RawSide | null, sc: Scales): GradedSide {
  if (!raw) return s;
  const { part, parts, sum } = weighted(raw, sc);
  const n = raw.points.length;
  const score = clamp(sum / sc.total, -1, 1);
  const known = WEIGHTS.deal + WEIGHTS.wins + WEIGHTS.points;
  const mid = (i: number) => clamp((WEIGHTS.deal * parts.deal + WEIGHTS.wins * part(raw.wins[i]!, 'wins') + WEIGHTS.points * part(raw.points[i]!, 'points')) / known / sc.total, -1, 1);
  return {
    ...s, grade: letter(score), initGrade: letter(parts.deal), score: r3(score),
    path: [letter(parts.deal), ...Array.from({ length: n }, (_, i) => letter(i === n - 1 ? score : mid(i)))],
    parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, r3(v)])) as Record<TradePart, number>,
  };
}
