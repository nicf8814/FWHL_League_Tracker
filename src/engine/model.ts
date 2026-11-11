import { POSITIONS, type PlayerId, type Pos, type Settings, type TeamId } from '../data/schema.ts';
import { weekOfDate, type Index } from './league.ts';
import type { SimResult } from './sim.ts';

// Ported from the Sandbox engine (League DNA on, production ramp, stretch-run weighting, real
// free-agent replacement, stud premium). Split in two so the expensive season sim depends only on
// what really changes it (audit PERF-1):
//   Base   = projections, availability, team strength.  Feeds the sim.
//   Values = chart blend, model, keepers.               Depends on settings + sim odds.

const RAMP_BACK = 0.75; // first game back from injury counts at 75%
const STRETCH_W = 1.25; // weeks 12-14
const PLAYOFF_W = 1.5; // weeks 15-17, times playoff odds
const DEPTH_W = 0.1; // bench depth credit
const FAIR_RANGE = 5; // partner's on-paper edge that still reads as fair
const WEEKLY_LOSS_OK = 1; // pts/wk you can lose and still call it fair

export interface Base {
  idx: Index;
  ramp: boolean; // productionRamp it was built with
  now: number;
  proj: Map<PlayerId, number>; // pts/wk after the production ramp
  stale: Map<PlayerId, number>; // missed-games rule: games in a row with 0 points and no projection
  isOut: (p: PlayerId) => boolean; // out of lineups now
  outTag: (p: PlayerId) => boolean; // ESPN lists Out or IR
  returnWeek: (p: PlayerId) => number; // 0 = available, 18 = out for the season
  strength: Record<TeamId, number>; // projected starting lineup this week (sim input)
}

// Weight of season average vs ESPN projection by games played: 0 at 0, 50% at 7, 70% by 12.
export const rampWeight = (g: number) => (g <= 0 ? 0 : g <= 7 ? (0.5 * g) / 7 : 0.5 + (0.2 * Math.min(g - 7, 5)) / 5);

export function buildBase(idx: Index, productionRamp: boolean): Base {
  const now = idx.currentWeek;
  const proj = new Map<PlayerId, number>();
  for (const [pid, s] of idx.stats) {
    const wk0 = s.projPerWeek ?? 0;
    let wk = wk0;
    if (productionRamp && s.seasonAvg && s.seasonAvg > 0 && s.seasonPoints && s.seasonPoints > 0 && wk0 > 0) {
      const w = rampWeight(s.seasonPoints / s.seasonAvg);
      wk = (1 - w) * wk0 + w * s.seasonAvg;
    }
    proj.set(pid, wk);
  }
  // Missed-games rule: an injury-tagged player with 0 points and no projection in his last 2+
  // non-bye weeks counts as out until he plays.
  const stale = new Map<PlayerId, number>();
  const finals = [...idx.weeks.keys()].filter((w) => w <= idx.scoresThrough).sort((a, b) => b - a);
  for (const pid of idx.injury.keys()) {
    let n = 0;
    for (const w of finals) {
      const r = idx.weeks.get(w)!.get(pid);
      if (!r || r.opponent === 'BYE' || (r.points === null && !r.projection)) continue;
      if (r.points === 0 && !r.projection) { n++; continue; }
      break;
    }
    if (n >= 2) stale.set(pid, n);
  }
  const outTag = (p: PlayerId) => {
    const s = idx.injury.get(p)?.status;
    return s === 'OUT' || s === 'IR';
  };
  const isOut = (p: PlayerId) => outTag(p) || stale.has(p);
  const ret = new Map<PlayerId, number>();
  const returnWeek = (p: PlayerId) => {
    const hit = ret.get(p);
    if (hit !== undefined) return hit;
    const inj = idx.injury.get(p);
    let r: number | null = inj?.returnWeek ?? null;
    if (r !== null && r >= 15) r = 18;
    if (inj?.status === 'IR') {
      const since = inj.since ? weekOfDate(inj.since, idx.ds.season.week1EndsUtc) : null;
      if (since !== null) r = Math.max(r ?? 0, since + 4); // ESPN IR minimum is 4 weeks
      else if (r === null || r <= now) r = now + 4;
    } else if (inj?.status === 'OUT' && r === null) r = now + 1;
    else if (r === null) r = 0;
    if (outTag(p) && r < 18) r = Math.max(r, now + 1); // never in the past while still out
    if (stale.has(p)) r = Math.max(r, now + 2);
    ret.set(p, r);
    return r;
  };
  const base: Base = { idx, ramp: productionRamp, now, proj, stale, isOut, outTag, returnWeek, strength: {} };
  for (const t of idx.teamIds) base.strength[t] = lineup(base, (idx.roster.get(t) ?? []).filter((p) => !isOut(p)), () => 1).start;
  return base;
}

export interface Lineup {
  slots: { slot: Pos[]; pid: PlayerId | null; v: number }[];
  start: number;
  score: number; // start + small credit for bench depth
}

// Greedy fill in slot order (QB, RB, RB, WR, WR, WR/TE, FLEX): the one lineup optimizer for the app.
export function lineup(base: Base, keys: PlayerId[], adj: (p: PlayerId) => number): Lineup {
  const pool = keys
    .map((k) => ({ k, pos: base.idx.players.get(k)?.pos, v: (base.proj.get(k) ?? 0) * adj(k) }))
    .filter((x): x is { k: PlayerId; pos: Pos; v: number } => !!x.pos)
    .sort((a, b) => b.v - a.v);
  const used = new Set<PlayerId>();
  const slots = base.idx.ds.season.lineup.map((slot) => {
    const p = pool.find((x) => !used.has(x.k) && slot.includes(x.pos));
    if (p) used.add(p.k);
    return { slot, pid: p?.k ?? null, v: p?.v ?? 0 };
  });
  const start = slots.reduce((s, x) => s + x.v, 0);
  const depth = pool.filter((x) => !used.has(x.k) && x.pos !== 'QB').slice(0, 3).reduce((s, x) => s + x.v, 0) * DEPTH_W;
  return { slots, start, score: start + depth };
}

export interface Blend {
  v: number; // trade value (current owner's view, keeper premium included)
  ev: number; // value without keeper premium
  market: number | null;
  model: number | null;
  keeper: number;
  sources: number; // how many charts rate him
}

export interface Values {
  base: Base;
  settings: Settings;
  sim: SimResult | null;
  oddsReady: boolean;
  teamOdds: (t: TeamId | undefined) => number;
  keepWeight: (t: TeamId) => number;
  blend: (p: PlayerId) => Blend;
  bv: (p: PlayerId) => number;
  chart: (p: PlayerId, source: 'peaked' | 'menton' | 'fantasypros') => number | null;
  aboveReplacement: (p: PlayerId) => number | null;
  replacement: Record<Pos, number>;
  replacementHealthy: Record<Pos, number>; // same ranks, Out/IR players left out
  faReplacement: Record<Pos, number>;
  faFill: PlayerId[];
  keeperValue: (keys: PlayerId[]) => number;
  keepConv: number;
  studPremium: (out: PlayerId[], inn: PlayerId[]) => number;
  injuryCorrection: (p: PlayerId, team: TeamId) => number;
  availFor: (p: PlayerId, team: TeamId | undefined) => number;
  weekGain: (team: TeamId, out: PlayerId[], inn: PlayerId[]) => number;
  rosterAfter: (team: TeamId, out: PlayerId[], inn: PlayerId[]) => PlayerId[];
  autoDrops: (team: TeamId, out: PlayerId[], inn: PlayerId[]) => PlayerId[];
  FAIR_RANGE: number;
  WEEKLY_LOSS_OK: number;
}

const nudgeFor = (pos: Pos, r: number) =>
  pos === 'RB' ? (r <= 6 ? 0.07 : r <= 13 ? 0 : r <= 24 ? -0.06 : 0)
  : pos === 'WR' ? (r <= 6 ? 0.07 : r <= 20 ? -0.05 : 0)
  : pos === 'QB' ? (r <= 4 ? 0.06 : 0)
  : r <= 4 ? -0.07 : 0;

export function buildValues(base: Base, settings: Settings, sim: SimResult | null): Values {
  const { idx, now } = base;
  const { season } = idx.ds;
  const regEnd = season.regularSeasonWeeks;
  const ids = [...idx.players.keys()];
  const posOf = (p: PlayerId) => idx.players.get(p)!.pos;
  const teamOdds = (t: TeamId | undefined) => (t !== undefined && sim ? sim.odds[t] ?? 0.5 : 0.5);
  const keepWeight = (t: TeamId) => (sim ? 0.12 + 0.48 * (1 - (sim.odds[t] ?? 0.5)) : 0.3);

  // --- market side: position-matched consensus of the charts
  const curves = new Map<Pos, number[][]>();
  const rankIn = { peaked: new Map<PlayerId, number>(), menton: new Map<PlayerId, number>() };
  for (const src of ['peaked', 'menton'] as const) {
    for (const pos of POSITIONS) {
      const arr = [...idx.chart[src]].filter(([p]) => idx.players.get(p)?.pos === pos).sort((a, b) => b[1] - a[1]);
      arr.forEach(([p], i) => rankIn[src].set(p, i));
      curves.set(pos, [...(curves.get(pos) ?? []), arr.map(([, v]) => v)]);
    }
  }
  const cons = new Map<Pos, number[]>();
  for (const [pos, cs] of curves) {
    const n = Math.max(0, ...cs.map((c) => c.length));
    cons.set(pos, Array.from({ length: n }, (_, i) => {
      const v = cs.filter((c) => i < c.length).map((c) => c[i]!);
      return v.reduce((a, b) => a + b, 0) / v.length;
    }));
  }
  const at = (c: number[], i: number) => (!c.length ? 0 : i < c.length ? c[i]! : c[c.length - 1]! * Math.pow(0.95, i - c.length + 1));
  const chart = (p: PlayerId, src: 'peaked' | 'menton' | 'fantasypros'): number | null => {
    const c = cons.get(posOf(p)) ?? [];
    if (src === 'fantasypros') { const r = idx.fpRank.get(p); return r === undefined ? null : at(c, r - 1); }
    const r = rankIn[src].get(p);
    return r === undefined ? null : at(c, r);
  };
  // shortcut: the Sandbox's chart-accuracy tilt is left out; it moved nothing on the Nov 10 data. Revisit once ESPN projections are scored weekly.
  const W = settings.chartWeights;
  const market = new Map<PlayerId, { raw: number; n: number }>();
  for (const p of ids) {
    let s = 0, w = 0, n = 0;
    for (const src of ['peaked', 'menton', 'fantasypros'] as const) {
      const v = chart(p, src), wt = W[src];
      if (v !== null && wt > 0) { s += v * wt; w += wt; n++; }
    }
    if (w) market.set(p, { raw: s / w, n });
  }

  // --- model side: points above replacement, mapped to value units by a fit on healthy players
  const all = ids.filter((p) => idx.stats.get(p)?.projPerWeek != null).map((p) => ({ p, pos: posOf(p), v: base.proj.get(p) ?? 0 })).sort((a, b) => b.v - a.v);
  const levelAt = (pos: Pos, healthyOnly: boolean) => {
    const arr = all.filter((x) => x.pos === pos && (!healthyOnly || !base.isOut(x.p)));
    return (arr[season.replacementRank[pos] - 1] ?? arr[arr.length - 1])?.v ?? 0;
  };
  const replacement = Object.fromEntries(POSITIONS.map((pos) => [pos, levelAt(pos, false)])) as Record<Pos, number>;
  const replPlay = Object.fromEntries(POSITIONS.map((pos) => [pos, levelAt(pos, true)])) as Record<Pos, number>;
  const vorp = (x: { pos: Pos; v: number }) => x.v - replacement[x.pos];
  const pts = all.filter((x) => x.pos !== 'QB' && vorp(x) > 0 && !base.isOut(x.p) && market.has(x.p)).map((x) => [vorp(x), market.get(x.p)!.raw] as const);
  const mx = pts.reduce((a, b) => a + b[0], 0) / (pts.length || 1), my = pts.reduce((a, b) => a + b[1], 0) / (pts.length || 1);
  const den = pts.reduce((a, [x]) => a + (x - mx) ** 2, 0);
  const slope = pts.length >= 2 && den > 0 ? pts.reduce((a, [x, y]) => a + (x - mx) * (y - my), 0) / den : 0;
  const icpt = my - slope * mx;
  const model0 = new Map<PlayerId, number>(slope ? all.map((x) => [x.p, Math.max(0, icpt + slope * vorp(x))]) : []);

  // --- availability (scoring side only; the charts already price injuries)
  const effWeek = (p: PlayerId, w: number) => {
    const r = base.returnWeek(p);
    if (r >= 18) return 0;
    const f = Math.max(r, now + 1);
    return w < f ? 0 : w === f ? RAMP_BACK : 1;
  };
  const injNow = (p: PlayerId) => base.isOut(p) || base.outTag(p);
  const availFor = (p: PlayerId, team: TeamId | undefined) => {
    if (!injNow(p)) return 1;
    const o = teamOdds(team);
    let s = 0, t = 0;
    for (let w = now; w <= 17; w++) {
      const wt = w <= regEnd ? (season.top6Weeks.includes(w) ? STRETCH_W : 1) : o * PLAYOFF_W;
      if (wt <= 0) continue;
      s += wt * effWeek(p, w);
      t += wt;
    }
    return t ? s / t : 1;
  };
  const injStr = settings.injuryStrength;
  const model = new Map<PlayerId, number>();
  for (const [p, m] of model0) {
    const f = injNow(p) && base.returnWeek(p) >= 18 ? 0 : 1 - injStr * (1 - availFor(p, idx.owner.get(p)));
    model.set(p, m * f);
  }
  const mult = (p: PlayerId) => {
    let m = model.has(p) ? 1 : 1 - injStr * (1 - availFor(p, idx.owner.get(p)));
    const n = idx.news.get(p);
    if (settings.useNews && n) m *= 1 + n.pct / 100;
    return m;
  };

  // --- League DNA: light tier nudge on the market side, keeper surplus from the auction curve
  const nudge = new Map<PlayerId, number>(), proxy = new Map<PlayerId, number>();
  for (const pos of POSITIONS) {
    const curve = season.keeper.auctionCurve[pos];
    const arr = [...market].filter(([p, m]) => posOf(p) === pos && m.raw > 0).sort((a, b) => b[1].raw - a[1].raw);
    arr.forEach(([p], i) => {
      nudge.set(p, nudgeFor(pos, i + 1));
      proxy.set(p, i < curve.length ? curve[i]! : Math.max(0.5, curve[curve.length - 1] ?? 0.5));
    });
  }
  const share = settings.marketShare / 100;
  const engineOf = (mk: number | null, md: number | null) => (md === null ? mk : mk === null ? md : share * mk + (1 - share) * md);
  const mkAdj = (p: PlayerId) => {
    const m = market.get(p);
    return m ? m.raw * mult(p) * (1 + (nudge.get(p) ?? 0)) : null;
  };
  let sv = 0, sp = 0;
  for (const p of ids) {
    const px = proxy.get(p);
    if (!px || px < 5) continue;
    const e = engineOf(mkAdj(p), model.get(p) ?? null);
    if (e) { sv += e; sp += px; }
  }
  const keepConv = sp ? sv / sp : 1; // value units per auction dollar
  const keepD = (p: PlayerId) => {
    const K = idx.keeper.get(p);
    if (!K || K.cost === null) return null;
    const s = (proxy.get(p) ?? 0) - K.cost;
    const locked = K.contractYear === 2;
    return { locked, s: locked ? s : Math.max(0, s) };
  };
  // Best keepers a roster can carry: locked contracts count in full, then the top optional ones.
  const keeperValue = (keys: PlayerId[]) => {
    const e = keys.map(keepD).filter((x): x is { locked: boolean; s: number } => !!x);
    const locked = e.filter((x) => x.locked).map((x) => x.s);
    const opt = e.filter((x) => !x.locked).map((x) => x.s).sort((a, b) => b - a);
    return locked.reduce((a, b) => a + b, 0) + opt.slice(0, Math.max(0, season.keeper.slots - locked.length)).reduce((a, b) => a + b, 0);
  };
  const blends = new Map<PlayerId, Blend>();
  for (const p of ids) {
    const mk = mkAdj(p), md = model.get(p) ?? null;
    const ev = engineOf(mk, md) ?? 0;
    const t = idx.owner.get(p);
    const r = t !== undefined ? idx.roster.get(t) ?? [] : [];
    const kb = t !== undefined ? keepWeight(t) * keepConv * (keeperValue(r) - keeperValue(r.filter((z) => z !== p))) : 0;
    blends.set(p, { v: ev + kb, ev, market: mk, model: md, keeper: kb, sources: market.get(p)?.n ?? (md !== null ? 1 : 0) });
  }
  const zero: Blend = { v: 0, ev: 0, market: null, model: null, keeper: 0, sources: 0 };
  const blend = (p: PlayerId) => blends.get(p) ?? zero;
  const bv = (p: PlayerId) => blend(p).v;

  // --- free agents: the replacement for an extra player in an uneven trade, and roster refills
  // Free agents = every player ESPN lists who is on no roster (ESPN's own flag lags a day after drops).
  const fas = ids.filter((p) => idx.stats.has(p) && !idx.owner.has(p) && !base.isOut(p));
  const faReplacement = Object.fromEntries(POSITIONS.map((pos) => [pos, Math.max(0, ...fas.filter((p) => posOf(p) === pos).map(bv))])) as Record<Pos, number>;
  const faFill = fas.filter((p) => posOf(p) !== 'QB').sort((a, b) => (base.proj.get(b) ?? 0) - (base.proj.get(a) ?? 0)).slice(0, 6);

  const ev = (p: PlayerId) => blend(p).ev;
  const studPremium = (out: PlayerId[], inn: PlayerId[]) => {
    if (!out.length || !inn.length || out.length === inn.length) return 0;
    const mo = Math.max(...out.map(ev)), mi = Math.max(...inn.map(ev)), x = Math.min(2, Math.abs(out.length - inn.length));
    if (inn.length < out.length && mi - mo >= 5) return ((0.1 * mi * mi) / 100) * x;
    if (out.length < inn.length && mo - mi >= 5) return ((-0.1 * mo * mo) / 100) * x;
    return 0;
  };
  // An injured player is worth more to a team that expects to play more weeks (playoff odds differ).
  const injuryCorrection = (p: PlayerId, team: TeamId) => {
    const m0 = model0.get(p);
    const o = idx.owner.get(p);
    if (m0 === undefined || !injNow(p) || o === team || base.returnWeek(p) >= 18) return 0;
    return (1 - share) * m0 * injStr * (availFor(p, team) - availFor(p, o));
  };

  // --- weekly lineup gains through the regular season (+ playoff weeks by odds)
  const sos = season.playoffScheduleRank;
  const sosFactor = (p: PlayerId) => {
    const pl = idx.players.get(p);
    if (!pl?.nflTeam) return 1;
    const tm = pl.nflTeam === 'WSH' ? 'WAS' : pl.nflTeam;
    const r = (pl.pos === 'RB' ? sos.rush : sos.pass)[tm];
    return r ? 1 + (0.06 * (16.5 - r)) / 15.5 : 1;
  };
  const availWeek = (p: PlayerId, w: number) => {
    if (idx.players.get(p)?.bye === w) return false;
    if (!base.isOut(p)) return true;
    const r = base.returnWeek(p);
    return r < 18 && w >= Math.max(r, now + 1);
  };
  const backWeek = (p: PlayerId) => {
    if (!base.isOut(p)) return 0;
    const r = base.returnWeek(p);
    if (r >= 18) return 0;
    let w = Math.max(r, now + 1);
    if (idx.players.get(p)?.bye === w) w++;
    return w;
  };
  const weekLineup = (keys: PlayerId[], w: number) =>
    lineup(base, keys.filter((k) => availWeek(k, w)), (k) => (backWeek(k) === w ? RAMP_BACK : 1) * (w >= season.playoffWeeks[0]! ? sosFactor(k) : 1)).score;
  const baseCache = new Map<string, number>();
  const baseWeek = (team: TeamId, w: number) => {
    const key = `${team}|${w}`;
    let v = baseCache.get(key);
    if (v === undefined) baseCache.set(key, (v = weekLineup(idx.roster.get(team) ?? [], w)));
    return v;
  };
  // LOGIC-5: rosters stay the same size. Short: the best free agents fill in. Long: the team cuts its
  // lowest-valued players it already had (never one it just got).
  const autoDrops = (team: TeamId, out: PlayerId[], inn: PlayerId[]): PlayerId[] => {
    const r = idx.roster.get(team) ?? [];
    const kept = r.filter((k) => !out.includes(k));
    const extra = kept.length + inn.filter((k) => !r.includes(k)).length - r.length;
    if (extra <= 0) return [];
    return [...kept].sort((x, y) => bv(x) - bv(y) || x.localeCompare(y)).slice(0, extra);
  };
  const rosterAfter = (team: TeamId, out: PlayerId[], inn: PlayerId[]) => {
    const r = idx.roster.get(team) ?? [];
    const drop = autoDrops(team, out, inn);
    const a = r.filter((k) => !out.includes(k) && !drop.includes(k)).concat(inn.filter((k) => !r.includes(k)));
    return a.length >= r.length ? a : a.concat(faFill.filter((k) => !a.includes(k)).slice(0, r.length - a.length));
  };
  const weekGain = (team: TeamId, out: PlayerId[], inn: PlayerId[]) => {
    const after = rosterAfter(team, out, inn);
    const wts: [number, number][] = [];
    for (let w = now; w <= regEnd; w++) wts.push([w, season.top6Weeks.includes(w) ? STRETCH_W : 1]);
    const p = teamOdds(team);
    if (p > 0.02) for (const w of season.playoffWeeks) wts.push([w, PLAYOFF_W * p]);
    const sw = wts.reduce((s, [, x]) => s + x, 0);
    return sw ? wts.reduce((s, [w, x]) => s + x * (weekLineup(after, w) - baseWeek(team, w)), 0) / sw : 0;
  };
  const aboveReplacement = (p: PlayerId) => {
    const pos = idx.players.get(p)?.pos;
    return pos && base.proj.has(p) ? base.proj.get(p)! - replPlay[pos] : null;
  };

  return {
    base, settings, sim, oddsReady: !!sim, teamOdds, keepWeight, blend, bv, chart, aboveReplacement, replacement, replacementHealthy: replPlay, faReplacement, faFill,
    keeperValue, keepConv, studPremium, injuryCorrection, availFor, weekGain, rosterAfter, autoDrops, FAIR_RANGE, WEEKLY_LOSS_OK,
  };
}
