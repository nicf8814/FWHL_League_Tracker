// Grades a past season's trade the way the Trade Tracker grades a live one, from the weekly lineup
// files. Runs at build time (scripts/trades.ts); the page only reads the results.
//
//   At the trade: projected points per week above replacement for the rest of the season, got minus
//     gave (the weekly projections in the lineups). There are no trade-chart values for past seasons.
//   As weeks are played the grade moves toward production: weeks / (weeks + 4) of it is points per week
//     above replacement, got minus gave. Replacement is the 12th QB, 31st RB, 34th WR and 7th TE among
//     rostered players that week (the Tracker's ranks; past seasons have no free-agent scores). A week a
//     player didn't play (no points and no projection, or off every roster) counts as even: his team
//     started someone else. The live Tracker skips those weeks the same way (no score that week).
//   Keepers: what really happened the next season, kept value (worth - keeper price) by this side minus
//     by the partner, weighted 25%, counted only once that next season is over.
//   Replay: each week again with the trade undone (best lineup with and without the players), for the
//     record, seed and playoff spot.
import type { OwnerKey } from '../data/history.ts';
import type { Lineups } from '../data/lineups.ts';
import type { KeeperLine, TradePlayerLine, TradeSide } from '../data/trades.ts';
import { letter } from './replay.ts';

export const REPL_RANK: Record<string, number> = { QB: 12, RB: 31, WR: 34, TE: 7, K: 12, 'D/ST': 12 };
export const KEEPER_WEIGHT = 0.25;
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
}
export interface TradeInput { week: number; sides: [{ owner: OwnerKey; gets: string[] }, { owner: OwnerKey; gets: string[] }] }
export interface NextKeepers { final: boolean; kept: (owner: OwnerKey, key: string) => { price: number; value: number | null } | null }

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

interface WeekIndex {
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

function standings(S: SeasonInput, score: (week: number, o: OwnerKey, real: number) => number) {
  const T = new Map<OwnerKey, { w: number; l: number; t: number; pf: number }>();
  for (const g of S.games) {
    const h = score(g.week, g.home, g.hs), a = score(g.week, g.away, g.as);
    for (const [o, f, x] of [[g.home, h, a], [g.away, a, h]] as const) {
      const r = T.get(o) ?? { w: 0, l: 0, t: 0, pf: 0 };
      if (f > x) r.w++; else if (f < x) r.l++; else r.t++;
      r.pf += f; T.set(o, r);
    }
  }
  // shortcut: seeds by win share then points for; the league's real tiebreaks can differ in rare ties.
  const order = [...T].sort((a, b) => (b[1].w + b[1].t / 2) - (a[1].w + a[1].t / 2) || b[1].pf - a[1].pf).map(([o]) => o);
  return (o: OwnerKey) => { const r = T.get(o)!; const seed = order.indexOf(o) + 1; return { w: r.w, l: r.l, t: r.t, seed, playoffs: seed <= S.playoffTeams }; };
}

export function gradeTrade(S: SeasonInput, W: Map<number, WeekIndex>, t: TradeInput, next: NextKeepers | null, playerIdx: (k: string) => number):
  { eff: number; sides: Omit<TradeSide, 'faab'>[] } {
  const [A, B] = t.sides;
  // First week the receiving team used one of its new players.
  let eff = t.week;
  for (let w = t.week; w <= S.lastWeek; w++) { const wk = W.get(w); if (wk && [A, B].some((s) => s.gets.some((k) => wk.at.get(k)?.owner === s.owner))) { eff = w; break; } }
  const weeks = [...W.keys()].filter((w) => w >= eff && w <= S.lastWeek).sort((a, b) => a - b);
  const pos = new Map<string, string>();
  for (const k of [...A.gets, ...B.gets]) pos.set(k, posOf(W, k, k.split('|')[1] ?? ''));

  const par = (k: string, upto: number) => {
    const ws = weeks.filter((w) => w <= upto);
    if (!ws.length) return null;
    return ws.reduce((a, w) => {
      const wk = W.get(w)!, x = wk.at.get(k);
      if (!x || ((x.pts ?? 0) === 0 && !x.proj)) return a; // didn't play: even with a replacement
      return a + (x.pts ?? 0) - (wk.repl.get(pos.get(k)!) ?? 0);
    }, 0) / ws.length;
  };
  const projRate = (k: string) => {
    const vals = weeks.map((w) => { const wk = W.get(w)!; const x = wk.at.get(k); return x?.proj == null ? null : x.proj - (wk.replProj.get(pos.get(k)!) ?? 0); }).filter((v): v is number => v !== null);
    return vals.length ? Math.max(0, vals.reduce((a, b) => a + b, 0) / vals.length) : null;
  };
  const sum = (ks: string[], f: (k: string) => number | null) => { const v = ks.map(f); return v.some((x) => x === null) ? null : v.reduce<number>((a, x) => a + x!, 0); };

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

  const keepFor = (o: OwnerKey, ks: string[]): KeeperLine[] => (next ? ks.flatMap((k) => { const kk = next.kept(o, k); return kk ? [{ p: playerIdx(k), owner: o, price: kk.price, value: kk.value }] : []; }) : []);
  const keptA = keepFor(A.owner, A.gets), keptB = keepFor(B.owner, B.gets);
  const keepVal = (ls: KeeperLine[]) => ls.reduce((a, x) => a + (x.value ?? 0), 0);

  const side = (me: typeof A, op: typeof B, kept: KeeperLine[], opKept: KeeperLine[]): Omit<TradeSide, 'faab'> => {
    const lines: TradePlayerLine[] = me.gets.map((k) => {
      const ws = weeks.map((w) => W.get(w)!.at.get(k));
      const proj = ws.map((x) => x?.proj).filter((v): v is number => v != null);
      return { p: playerIdx(k), ptsWk: weeks.length ? Math.round((ws.reduce((a, x) => a + (x?.pts ?? 0), 0) / weeks.length) * 10) / 10 : null, projWk: proj.length ? Math.round((proj.reduce((a, b) => a + b, 0) / proj.length) * 10) / 10 : null, starts: ws.filter((x) => x?.owner === me.owner && x.started).length, weeks: weeks.length };
    });
    const keep = next?.final ? keepVal(kept) - keepVal(opKept) : 0; // a keeper season still in progress doesn't count yet
    const graded = me.gets.length + op.gets.length > 0;
    const pGain = graded ? (() => { const g = sum(me.gets, projRate), o = sum(op.gets, projRate); return g === null || o === null ? null : g - o; })() : null;
    const init = pGain === null ? 0 : clamp(pGain / 8, -1, 1);
    const at = (n: number) => {
      if (!n) return init;
      const upto = weeks[n - 1]!;
      const prod = (sum(me.gets, (k) => par(k, upto)) ?? 0) - (sum(op.gets, (k) => par(k, upto)) ?? 0);
      const w = n / (n + 4);
      return clamp((1 - w) * init + w * clamp(prod / 12, -1, 1) + KEEPER_WEIGHT * clamp(keep / 30, -1, 1) * (n === weeks.length ? 1 : 0), -1, 1);
    };
    const n = weeks.length;
    const score = graded ? at(n) : null;
    const prod = n ? (sum(me.gets, (k) => par(k, weeks.at(-1)!)) ?? 0) - (sum(op.gets, (k) => par(k, weeks.at(-1)!)) ?? 0) : null;
    return {
      owner: me.owner, gets: lines,
      grade: score === null ? null : letter(score), initGrade: graded ? letter(clamp(init + 0, -1, 1)) : null, score: score === null ? null : Math.round(score * 1000) / 1000,
      path: graded ? Array.from({ length: n + 1 }, (_, i) => letter(at(i))) : [],
      prod: prod === null || !graded ? null : Math.round(prod * 10) / 10, projGain: pGain === null ? null : Math.round(pGain * 10) / 10,
      keep, keepFinal: next?.final ?? true, kept, record: realStand(me.owner), alt: altStand(me.owner), finish: S.finish.get(me.owner) ?? null,
    };
  };
  return { eff, sides: [side(A, B, keptA, keptB), side(B, A, keptB, keptA)] };
}
