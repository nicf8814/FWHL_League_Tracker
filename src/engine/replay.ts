import type { PlayerId, PlayerWeek, Pos, TeamId, Transaction } from '../data/schema.ts';
import type { Index } from './league.ts';
import { lineup, type Values } from './model.ts';
import { rank6, seed, tally, type GameRow, type SimInput } from './sim.ts';

// Trade tracker and What if, ported from the Sandbox (Nov 10 build).
// A scenario either rewinds a real trade ("what if it never happened") or applies a vetoed one
// ("what if it went through"). Either way, every later trade that moved one of the same players
// onward is undone too, down the chain. Each replayed week = the team's real score + (best possible
// lineup with the changed roster - best possible lineup with its real roster), so the manager's real
// start/sit choices still count. Empty slots take the average of the top 3 free agents at the
// position that week (by projection).

export interface Scenario {
  id: string;
  tx: Transaction;
  veto: boolean; // true: apply a vetoed trade; false: rewind a real one
}

export const scenarioOf = (tx: Transaction): Scenario => ({ id: tx.id, tx, veto: tx.type === 'veto' });

const GRADES: [number, string][] = [[0.8, 'A+'], [0.6, 'A'], [0.45, 'A-'], [0.33, 'B+'], [0.22, 'B'], [0.12, 'B-'], [0.04, 'C+'], [-0.04, 'C'], [-0.12, 'C-'], [-0.22, 'D+'], [-0.33, 'D'], [-0.45, 'D-'], [-9, 'F']];
export const letter = (s: number) => GRADES.find((g) => s >= g[0])![1];
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
const teamsOf = (tx: Transaction) => [...new Set(tx.legs.flatMap((l) => [l.fromTeamId, l.toTeamId]))];

export interface Record3 { w: number; l: number; t: number; pf: number; seed: number }

export function seedsFrom(idx: Index, games: readonly GameRow[]): Map<TeamId, Record3> {
  const T = tally(idx.teamIds, games, idx.ds.season.top6Weeks);
  const order = seed(idx.teamIds, (i) => T.get(i)!.w + T.get(i)!.t / 2, (i) => T.get(i)!.pf, (i, j) => T.get(i)!.h2h.get(j) ?? 0, idx.ds.season.seedsByRecord);
  return new Map(order.map((id, k) => { const r = T.get(id)!; return [id, { w: r.w, l: r.l, t: r.t, pf: r.pf, seed: k + 1 }]; }));
}

// Every later trade that moved a player onward from one already being undone.
function undoChain(idx: Index, s: Scenario): Transaction[] {
  const trades = idx.ds.transactions.filter((t) => t.type === 'trade' && teamsOf(t).length === 2);
  const after = (u: Transaction, x: Transaction) => u.date > x.date || (u.date === x.date && u.effectiveWeek >= x.effectiveWeek && u !== x);
  const set: Transaction[] = s.veto ? [] : [s.tx];
  if (s.veto) for (const u of trades) if (u.date >= s.tx.date && u.legs.some((l) => s.tx.legs.some((x) => x.playerId === l.playerId))) set.push(u);
  for (let grew = true; grew; ) {
    grew = false;
    for (const u of trades) {
      if (set.includes(u)) continue;
      if (set.some((x) => after(u, x) && u.legs.some((l) => x.legs.some((xl) => xl.playerId === l.playerId && l.fromTeamId === xl.toTeamId)))) { set.push(u); grew = true; }
    }
  }
  return set;
}
const newestFirst = (a: Transaction[]) => a.slice().sort((x, y) => y.date.localeCompare(x.date) || y.effectiveWeek - x.effectiveWeek);

// Who owns each changed player in this scenario in week w (only players that differ from real life).
function ownersAt(s: Scenario, undo: Transaction[], w: number): Map<PlayerId, TeamId> {
  const m = new Map<PlayerId, TeamId>();
  for (const u of newestFirst(undo)) if (w >= u.effectiveWeek) for (const l of u.legs) m.set(l.playerId, l.fromTeamId);
  if (s.veto && w >= s.tx.effectiveWeek) for (const l of s.tx.legs) m.set(l.playerId, l.toTeamId);
  return m;
}

// Today's rosters in the scenario's world (for keeper value and playoff odds).
export function scenarioRosters(idx: Index, s: Scenario, undo: Transaction[]): Map<TeamId, PlayerId[]> {
  const R = new Map([...idx.roster].map(([t, r]) => [t, r.slice()]));
  const move = (p: PlayerId, to: TeamId) => {
    const from = [...R].find(([, r]) => r.includes(p))?.[0];
    if (from === undefined || from === to || !R.has(to)) return;
    R.set(from, R.get(from)!.filter((z) => z !== p));
    R.get(to)!.push(p);
  };
  for (const u of newestFirst(undo)) for (const l of u.legs) move(l.playerId, l.fromTeamId);
  if (s.veto) for (const l of s.tx.legs) move(l.playerId, l.toTeamId);
  return R;
}

interface Slotted { pos: Pos; pts: number }
function bestLineup(idx: Index, c: Slotted[], fa: (pos: Pos) => number): number {
  const used = new Set<Slotted>();
  let tot = 0;
  for (const slot of idx.ds.season.lineup) {
    let best: Slotted | null = null;
    for (const x of c) if (!used.has(x) && slot.includes(x.pos) && (!best || x.pts > best.pts)) best = x;
    if (best) { used.add(best); tot += best.pts; continue; }
    tot += slot.reduce((m, p) => Math.max(m, fa(p)), -Infinity);
  }
  return tot;
}

export interface WeekCalc { real: number; alt: number; bestReal: number; bestAlt: number; opp: TeamId }

export interface Calc {
  undo: Transaction[];
  aff: TeamId[];
  thru: number;
  W: Map<number, Map<TeamId, WeekCalc>>;
  games: GameRow[]; // schedule with the scenario's scores
  real: Map<TeamId, Record3>;
  alt: Map<TeamId, Record3>;
}

export function calc(idx: Index, s: Scenario): Calc {
  const undo = undoChain(idx, s);
  const aff = [...new Set([...teamsOf(s.tx), ...undo.flatMap(teamsOf)])];
  const thru = idx.scoresThrough;
  const W = new Map<number, Map<TeamId, WeekCalc>>();
  for (let w = s.tx.effectiveWeek; w <= thru; w++) {
    const rows = idx.weeks.get(w);
    if (!rows) continue;
    const m = ownersAt(s, undo, w);
    const fa = faAverage(rows, m, idx);
    const score = teamScores(idx, w);
    const wk = new Map<TeamId, WeekCalc>();
    for (const tm of aff) {
      const sc = score.get(tm);
      if (!sc) continue;
      const br = bestLineup(idx, roster(idx, rows, tm, null), fa), ba = bestLineup(idx, roster(idx, rows, tm, m), fa);
      wk.set(tm, { real: sc.pts, alt: sc.pts + ba - br, bestReal: br, bestAlt: ba, opp: sc.opp });
    }
    W.set(w, wk);
  }
  const games = idx.games.map((g) => {
    const wk = W.get(g[0]);
    if (!g[5] || !wk) return g;
    const h = wk.get(g[1])?.alt ?? g[3]!, a = wk.get(g[2])?.alt ?? g[4]!;
    return [g[0], g[1], g[2], h, a, true] as const;
  });
  return { undo, aff, thru, W, games, real: seedsFrom(idx, idx.games), alt: seedsFrom(idx, games) };
}

function roster(idx: Index, rows: Map<PlayerId, PlayerWeek>, tm: TeamId, m: Map<PlayerId, TeamId> | null): Slotted[] {
  const out: Slotted[] = [];
  for (const [k, r] of rows) {
    const own = m && m.has(k) ? m.get(k) : r.teamId;
    if (own !== tm || r.slot === 'ir') continue;
    const pos = idx.players.get(k)?.pos;
    if (pos) out.push({ pos, pts: r.points ?? 0 });
  }
  if (m) for (const [k, t] of m) if (t === tm && !rows.has(k) && idx.players.has(k)) out.push({ pos: idx.players.get(k)!.pos, pts: 0 });
  return out;
}

function faAverage(rows: Map<PlayerId, PlayerWeek>, m: Map<PlayerId, TeamId>, idx: Index) {
  const cache = new Map<Pos, number>();
  return (pos: Pos) => {
    if (!cache.has(pos)) {
      const a = [...rows.values()].filter((r) => r.slot === 'fa' && idx.players.get(r.playerId)?.pos === pos && !m.has(r.playerId)).sort((x, y) => (y.projection ?? 0) - (x.projection ?? 0)).slice(0, 3);
      cache.set(pos, a.length ? a.reduce((s, r) => s + (r.points ?? 0), 0) / a.length : 0);
    }
    return cache.get(pos)!;
  };
}

function teamScores(idx: Index, w: number) {
  const out = new Map<TeamId, { pts: number; opp: TeamId }>();
  for (const [wk, h, a, hs, as, fin] of idx.games) {
    if (wk !== w || !fin || hs === null || as === null) continue;
    out.set(h, { pts: hs, opp: a });
    out.set(a, { pts: as, opp: h });
  }
  return out;
}

// ---------- week cards ----------
export interface WeekRow {
  w: number;
  top6: boolean;
  opp: TeamId | null;
  vsPartner: boolean; // the opponent was replayed too
  act: number; // the side being judged: the real week for a rewind, the what-if week for a veto
  cf: number; // the other world
  oppAct: number; // opponent's score (or the 6th-place score in a top-6 week) in the "act" world
  oppCf: number;
  rAct: 'W' | 'L' | 'T';
  rCf: 'W' | 'L' | 'T';
  bAct: number; // perfect lineups
  bCf: number;
  pAct?: number; // place in a top-6 week
  pCf?: number;
  bump?: { team: TeamId; act: 'W' | 'L' | 'T'; cf: 'W' | 'L' | 'T' }[]; // others whose top-6 result flips
}

export function weekRows(idx: Index, s: Scenario, C: Calc): Map<TeamId, WeekRow[]> {
  const res = (a: number, b: number) => (a > b ? 'W' : a < b ? 'L' : 'T') as 'W' | 'L' | 'T';
  const out = new Map<TeamId, WeekRow[]>(teamsOf(s.tx).map((t) => [t, []]));
  for (const tm of out.keys())
    for (const w of [...C.W.keys()].sort((a, b) => a - b)) {
      const wk = C.W.get(w)!, c = wk.get(tm);
      if (!c) continue;
      if (idx.ds.season.top6Weeks.includes(w)) {
        const score = teamScores(idx, w);
        const RS = new Map([...score].map(([t, v]) => [t, v.pts])), AS = new Map([...RS].map(([t, v]) => [t, wk.get(t)?.alt ?? v]));
        const rk = (S: Map<TeamId, number>, n: TeamId) => rank6(S.get(n)!, [...S].filter(([x]) => x !== n).map(([, v]) => v));
        const place = (S: Map<TeamId, number>, n: TeamId) => 1 + [...S].filter(([x, v]) => x !== n && v > S.get(n)!).length;
        const sixth = (S: Map<TeamId, number>) => [...S.values()].sort((a, b) => b - a)[5] ?? 0;
        const [A, B] = s.veto ? [AS, RS] : [RS, AS];
        const bump = [...RS.keys()].filter((n) => !out.has(n) && rk(A, n) !== rk(B, n)).map((n) => ({ team: n, act: rk(A, n), cf: rk(B, n) }));
        out.get(tm)!.push({ w, top6: true, opp: null, vsPartner: false, act: A.get(tm)!, cf: B.get(tm)!, oppAct: sixth(A), oppCf: sixth(B), rAct: rk(A, tm), rCf: rk(B, tm), pAct: place(A, tm), pCf: place(B, tm), bAct: s.veto ? c.bestAlt : c.bestReal, bCf: s.veto ? c.bestReal : c.bestAlt, bump });
        continue;
      }
      const oc = wk.get(c.opp), oReal = teamScores(idx, w).get(c.opp)?.pts ?? 0, oAlt = oc ? oc.alt : oReal;
      const [act, cf, oa, ocf, ba, bc] = s.veto ? [c.alt, c.real, oAlt, oReal, c.bestAlt, c.bestReal] : [c.real, c.alt, oReal, oAlt, c.bestReal, c.bestAlt];
      out.get(tm)!.push({ w, top6: false, opp: c.opp, vsPartner: !!oc, act, cf, oppAct: oa, oppCf: ocf, rAct: res(act, oa), rCf: res(cf, ocf), bAct: ba, bCf: bc });
    }
  return out;
}

// ---------- grades ----------
// Starts from the trade itself (value received, projected pts/wk above replacement), then moves toward
// production as weeks are played: weeks / (weeks + 4) of the grade. Keeper value for 2027 is added on top,
// weighted by how much the team should care about next year. C is even.
export interface SideGrade {
  grade: string;
  initL: string; // grade at the trade
  score: number;
  init: number;
  season: number; // this-season grade before keepers
  w: number; // share of the grade that is real production
  act: number | null; // pts/wk vs the other world
  par: number | null; // production above replacement, got minus gave, per week
  val: number; // value received at the trade
  pGain: number | null;
  keep: number; // keeper surplus change ($)
  kw: number; // keeper weight
  rows: WeekRow[];
}

export interface Evaluation { n: number; calc: Calc; res: Map<TeamId, SideGrade> }

export function evaluate(V: Values, s: Scenario, upto?: number, C0?: Calc): Evaluation {
  const idx = V.base.idx;
  const C = C0 ?? calc(idx, s);
  const T = teamsOf(s.tx);
  const last = upto == null ? C.thru : Math.min(C.thru, s.tx.effectiveWeek + upto - 1);
  const n = Math.max(0, last - s.tx.effectiveWeek + 1);
  const rows = weekRows(idx, s, C);
  const replW = replacementByWeek(idx);
  const parAvg = (k: PlayerId, pos: Pos, from: number, to: number) => {
    let sum = 0, c = 0;
    for (let w = from; w <= to; w++) {
      const wk = idx.weeks.get(w);
      if (!wk || w > idx.scoresThrough) continue;
      const r = wk.get(k);
      if (r && r.points === null) continue;
      sum += (r ? r.points ?? 0 : 0) - replW(w)[pos];
      c++;
    }
    return c ? sum / c : null;
  };
  const healthyRepl = (pos: Pos) => V.replacementHealthy[pos];
  const pRate = (k: PlayerId, ros: number | null | undefined) => {
    const pos = idx.players.get(k)!.pos;
    let r: number | null = null;
    if (ros != null) r = ros / Math.max(1, 18 - s.tx.week);
    else {
      const pre = [...idx.weeks].filter(([w, m]) => w < s.tx.effectiveWeek && m.get(k)?.points != null && m.get(k)?.opponent !== 'BYE').map(([, m]) => m.get(k)!.points!);
      if (pre.length >= 2) r = pre.reduce((a, b) => a + b, 0) / pre.length;
    }
    return r == null ? null : Math.max(0, r - healthyRepl(pos));
  };
  // A vetoed trade has no snapshot, so it is judged on today's value and projection.
  const rosOf = (k: PlayerId, snap: number | null | undefined) => (s.veto ? rosNow(V, k) : snap);
  const valueOf = (k: PlayerId, snap: number | null | undefined) => (s.veto ? V.bv(k) : snap ?? null);
  const side = (tm: TeamId) => {
    const got = s.tx.legs.filter((l) => l.toTeamId === tm), gave = s.tx.legs.filter((l) => l.fromTeamId === tm);
    const rates = got.map((l) => pRate(l.playerId, rosOf(l.playerId, l.rosAtTrade)));
    const vals = got.map((l) => valueOf(l.playerId, l.valueAtTrade));
    const sum = (ls: typeof got) => ls.reduce((a, l) => a + (n ? parAvg(l.playerId, idx.players.get(l.playerId)!.pos, s.tx.effectiveWeek, last) ?? 0 : 0), 0);
    const wk = (rows.get(tm) ?? []).filter((x) => x.w <= last);
    return {
      val: vals.reduce<number>((a, v) => a + (v ?? 0), 0),
      valNK: got.reduce((a, l, i) => a + Math.max(0, (vals[i] ?? 0) - (idx.owner.has(l.playerId) ? V.blend(l.playerId).keeper : 0)), 0),
      hasVal: vals.some((v) => v != null),
      rate: rates.some((r) => r == null) ? null : rates.reduce<number>((a, r) => a + r!, 0),
      par: sum(got) - sum(gave),
      imp: wk.length ? wk.reduce((a, x) => a + x.act - x.cf, 0) / wk.length : null,
      wk,
    };
  };
  const [a, b] = T as [TeamId, TeamId];
  const A = side(a), B = side(b);
  const ke = keeperEdge(V, s, C);
  const res = new Map<TeamId, SideGrade>();
  for (const [tm, me, op] of [[a, A, B], [b, B, A]] as const) {
    const vEdge = me.hasVal && op.hasVal ? (me.valNK - op.valNK) / Math.max(me.valNK + op.valNK, 1) : null;
    const pGain = me.rate != null && op.rate != null ? me.rate - op.rate : null;
    const parts: number[] = [];
    if (vEdge != null) parts.push(clamp(vEdge / 0.5, -1, 1));
    if (pGain != null) parts.push(clamp(pGain / 8, -1, 1));
    const init = parts.length ? parts.reduce((x, y) => x + y, 0) / parts.length : 0;
    const w = n / (n + 4);
    const prod = n ? me.par : null;
    const season = prod == null ? init : (1 - w) * init + w * clamp(prod / 12, -1, 1);
    const kw = V.keepWeight(tm), keep = ke.get(tm) ?? 0;
    const score = clamp(season + kw * clamp(keep / 30, -1, 1), -1, 1);
    res.set(tm, { grade: letter(score), initL: letter(init), score, init, season, w, act: me.imp, par: prod, val: me.val, pGain, keep, kw, rows: me.wk });
  }
  return { n, calc: C, res };
}

// The grade as it stood after each week since the trade (index 0 = at the trade).
export function gradePath(V: Values, s: Scenario, ev: Evaluation): Map<TeamId, string[]> {
  const out = new Map<TeamId, string[]>([...ev.res].map(([t, r]) => [t, [r.initL]]));
  for (let i = 1; i <= ev.n; i++) for (const [t, r] of evaluate(V, s, i, ev.calc).res) out.get(t)!.push(r.grade);
  return out;
}

// Change in each team's best two 2027 keepers: with the trade vs without (rewind), or if it went through vs real (veto).
function keeperEdge(V: Values, s: Scenario, C: Calc): Map<TeamId, number> {
  const idx = V.base.idx;
  const R = new Map([...idx.roster].map(([t, r]) => [t, r.slice()]));
  const mv = (k: PlayerId, from: TeamId, to: TeamId) => {
    if (!R.get(from)?.includes(k) || !R.has(to)) return;
    R.set(from, R.get(from)!.filter((z) => z !== k));
    R.get(to)!.push(k);
  };
  for (const l of s.tx.legs) {
    if (s.veto) { const c = [...R].find(([, r]) => r.includes(l.playerId))?.[0]; if (c !== undefined && c !== l.toTeamId) mv(l.playerId, c, l.toTeamId); }
    else mv(l.playerId, l.toTeamId, l.fromTeamId);
  }
  void C;
  return new Map(teamsOf(s.tx).map((tm) => {
    const now = V.keeperValue(idx.roster.get(tm) ?? []), alt = V.keeperValue(R.get(tm) ?? []);
    return [tm, s.veto ? alt - now : now - alt];
  }));
}

// Each position's replacement starter by actual points that week (QB12, RB31, WR34, TE7).
function replacementByWeek(idx: Index) {
  const cache = new Map<number, Record<Pos, number>>();
  return (w: number) => {
    if (!cache.has(w)) {
      const pts = [...(idx.weeks.get(w)?.values() ?? [])].filter((r) => r.points !== null);
      const o = {} as Record<Pos, number>;
      for (const pos of ['QB', 'RB', 'WR', 'TE'] as const) {
        const a = pts.filter((r) => idx.players.get(r.playerId)?.pos === pos).map((r) => r.points!).sort((x, y) => y - x);
        o[pos] = a[idx.ds.season.replacementRank[pos] - 1] ?? 0;
      }
      cache.set(w, o);
    }
    return cache.get(w)!;
  };
}

// Today's rest-of-season projection with the production ramp applied (what the Sandbox used for vetoes).
function rosNow(V: Values, k: PlayerId): number | null {
  const st = V.base.idx.stats.get(k);
  if (!st || st.projRestOfSeason == null) return null;
  const f = st.projPerWeek ? (V.base.proj.get(k) ?? st.projPerWeek) / st.projPerWeek : 1;
  return st.projRestOfSeason * f;
}

// Inputs for the league ripple's two playoff simulations (run in the worker; audit PERF-9).
export function rippleInputs(V: Values, s: Scenario, C: Calc, base: SimInput): { now: SimInput; alt: SimInput } {
  const R = scenarioRosters(V.base.idx, s, C.undo);
  const strength = Object.fromEntries([...R].map(([t, r]) => [t, Math.round(lineup(V.base, r.filter((p) => !V.base.isOut(p)), () => 1).start * 100) / 100]));
  return { now: { ...base, runs: 2000 }, alt: { ...base, games: C.games, strength, runs: 2000 } };
}
