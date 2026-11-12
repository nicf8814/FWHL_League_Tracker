// Who trades well (Nov 12, item 2). One line per side of every trade, then a career per manager:
// the grade his trades earned, the chart value he came out ahead on, and the points he gained both
// raw (what the players he got actually scored, minus what he gave up) and above replacement (the
// same thing measured against a startable player at the position, per week).
//
// Past seasons come from public/seed/trades.json, graded at build time (engine/tradeHistory.ts).
// The live season is handed in by the page from the Tracker's own grades, so one table covers both.
// Chart values only exist for the live season: past-season lines leave value null and the page says so.
import type { OwnerKey } from '../data/history.ts';
import type { TeamId } from '../data/schema.ts';
import type { Trades } from '../data/trades.ts';
import type { Values } from './model.ts';
import { evaluate, letter, scenarioOf } from './replay.ts';

export interface TradeLine {
  id: string;
  year: number;
  week: number;
  live: boolean;
  owner: OwnerKey;
  partner: OwnerKey;
  score: number | null; // -1..1, 0 = even; null = nothing to grade
  grade: string | null;
  got: string[]; // player names, for the page
  gave: string[];
  rawGot: number | null; // points the players he got scored after the trade
  rawGave: number | null;
  parWk: number | null; // points per week above replacement, got minus gave
  weeks: number; // weeks the grade counted
  value: number | null; // chart value received minus sent, at the trade (live season only)
  keep: number; // next season's keeper value kept, his minus the partner's ($)
}

export interface TraderCareer {
  owner: OwnerKey;
  trades: number;
  graded: number;
  score: number | null; // average score across graded trades
  grade: string | null; // that average as a letter
  wins: number; // trades he won (score > 0.04, a C+ or better)
  losses: number;
  rawGain: number | null; // total points gained
  parGain: number | null; // total points gained above replacement
  parWk: number | null; // above-replacement points per week, averaged over his trades
  value: number | null; // chart value gained, where there is any
  keep: number; // keeper value gained ($)
  best: TradeLine | null;
  worst: TradeLine | null;
  years: number[];
  lines: TradeLine[];
}

const round = (n: number, d = 1) => { const m = 10 ** d; return Math.round(n * m) / m; };
const sum = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? v.reduce((a, b) => a + b, 0) : null; };

// Every side of every finished-season trade as a line.
export function historyLines(T: Trades): TradeLine[] {
  const out: TradeLine[] = [];
  for (const t of T.trades)
    for (const [i, s] of t.sides.entries()) {
      const op = t.sides[1 - i]!;
      const raw = (side: typeof s) => { const v = side.gets.map((g) => (g.ptsWk === null ? null : g.ptsWk * g.weeks)); return v.length ? sum(v) : 0; };
      out.push({
        id: t.id, year: t.year, week: t.week, live: false, owner: s.owner, partner: op.owner,
        score: s.score, grade: s.grade,
        got: s.gets.map((g) => T.players[g.p]![0]), gave: op.gets.map((g) => T.players[g.p]![0]),
        rawGot: raw(s), rawGave: raw(op), parWk: s.prod, weeks: s.gets[0]?.weeks ?? op.gets[0]?.weeks ?? 0,
        value: null, keep: s.keepFinal ? s.keep : 0,
      });
    }
  return out;
}

// This season's trades, graded the way the Tracker grades them, as the same kind of line. Chart
// value exists here (it is snapshotted when the trade is logged), so these lines carry it.
export function liveLines(V: Values, owner: (teamId: TeamId) => OwnerKey | undefined): TradeLine[] {
  const idx = V.base.idx;
  const year = idx.ds.meta.season;
  const out: TradeLine[] = [];
  for (const tx of idx.ds.transactions) {
    if (tx.type !== 'trade') continue;
    const teams = [...new Set(tx.legs.flatMap((l) => [l.fromTeamId, l.toTeamId]))];
    if (teams.length !== 2) continue; // shortcut: three-way trades are not graded; none in the data yet
    const ev = evaluate(V, scenarioOf(tx));
    const name = (p: string) => idx.players.get(p)?.name ?? p;
    // What the players actually scored from the week the trade took effect.
    const since = (p: string) => {
      let total = 0, any = false;
      for (const [w, m] of idx.weeks) {
        if (w < tx.effectiveWeek || w > idx.scoresThrough) continue;
        const r = m.get(p);
        if (r?.points != null) { total += r.points; any = true; }
      }
      return any ? total : null;
    };
    const weeks = Math.max(0, idx.scoresThrough - tx.effectiveWeek + 1);
    for (const tm of teams) {
      const op = teams.find((x) => x !== tm)!;
      const [a, b] = [owner(tm), owner(op)];
      const g = ev.res.get(tm);
      if (!a || !b || !g) continue;
      const got = tx.legs.filter((l) => l.toTeamId === tm), gave = tx.legs.filter((l) => l.fromTeamId === tm);
      const pts = (ls: typeof got) => { const v = ls.map((l) => since(l.playerId)); return v.every((x) => x === null) && v.length ? null : v.reduce<number>((s, x) => s + (x ?? 0), 0); };
      const val = (ls: typeof got) => { const v = ls.map((l) => l.valueAtTrade); return v.some((x) => x == null) ? null : v.reduce<number>((s, x) => s + x!, 0); };
      const mine = val(got), theirs = val(gave);
      out.push({
        id: tx.id, year, week: tx.week, live: true, owner: a, partner: b,
        score: g.score, grade: g.grade,
        got: got.map((l) => name(l.playerId)), gave: gave.map((l) => name(l.playerId)),
        rawGot: pts(got), rawGave: pts(gave), parWk: g.par, weeks,
        value: mine === null || theirs === null ? null : Math.round((mine - theirs) * 10) / 10,
        keep: 0, // 2027 keepers are graded after the season, like the finished ones
      });
    }
  }
  return out;
}

export function traderCareers(lines: TradeLine[]): TraderCareer[] {
  const by = new Map<OwnerKey, TradeLine[]>();
  for (const l of lines) by.set(l.owner, [...(by.get(l.owner) ?? []), l]);
  const out: TraderCareer[] = [];
  for (const [owner, ls] of by) {
    const graded = ls.filter((l) => l.score !== null);
    const score = graded.length ? graded.reduce((a, l) => a + l.score!, 0) / graded.length : null;
    const raw = ls.map((l) => (l.rawGot === null || l.rawGave === null ? null : l.rawGot - l.rawGave));
    const par = ls.map((l) => (l.parWk === null ? null : l.parWk * l.weeks));
    const parWk = graded.filter((l) => l.parWk !== null);
    const vals = ls.filter((l) => l.value !== null);
    const sorted = [...graded].sort((a, b) => b.score! - a.score!);
    out.push({
      owner, trades: ls.length, graded: graded.length,
      score: score === null ? null : round(score, 3), grade: score === null ? null : letter(score),
      wins: graded.filter((l) => l.score! > 0.04).length, losses: graded.filter((l) => l.score! < -0.04).length,
      rawGain: sum(raw) === null ? null : round(sum(raw)!),
      parGain: sum(par) === null ? null : round(sum(par)!),
      parWk: parWk.length ? round(parWk.reduce((a, l) => a + l.parWk!, 0) / parWk.length, 2) : null,
      value: vals.length ? round(vals.reduce((a, l) => a + l.value!, 0)) : null,
      keep: round(ls.reduce((a, l) => a + l.keep, 0)),
      best: sorted[0] ?? null, worst: sorted.at(-1) ?? null,
      years: [...new Set(ls.map((l) => l.year))].sort((a, b) => a - b),
      lines: [...ls].sort((a, b) => b.year - a.year || b.week - a.week),
    });
  }
  return out.sort((a, b) => (b.score ?? -9) - (a.score ?? -9));
}

// The headline: who comes out ahead and who doesn't, on whichever measure is being read.
export type TraderMetric = 'score' | 'rawGain' | 'parGain' | 'value' | 'keep';
export function bestAndWorst(cs: TraderCareer[], metric: TraderMetric, minTrades = 3): { best: TraderCareer | null; worst: TraderCareer | null } {
  const ok = cs.filter((c) => c.trades >= minTrades && c[metric] !== null);
  const sorted = [...ok].sort((a, b) => (b[metric] as number) - (a[metric] as number));
  return { best: sorted[0] ?? null, worst: sorted.length > 1 ? sorted.at(-1)! : null };
}
