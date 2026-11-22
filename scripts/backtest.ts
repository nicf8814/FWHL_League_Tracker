// Backtest (Nov 22): do the Peaked and Menton charts tell us anything our own value doesn't?
//
// For every week W with a chart, rebuild each player's value as it stood before Week W's games, using
// only what was known then, and rank-correlate it with what he did next: points above replacement in
// Weeks W+1 to the last final week (weeks he missed count 0). Run: npm run backtest [-- --json]
//
// Predictors at Week W:
//   peaked, menton, charts  the chart values that week (charts = average of the two)
//   espn                    ESPN's Week W projection, as points above replacement
//   seasonAvg               points per game before Week W, above replacement
//   ours                    our value: ESPN's projection ramped toward the season average, 0.6 PAR + 0.4 WAR
//   ours+charts             ours and charts, ranks averaged 50/50 (do the charts add anything?)
//   oursRos                 ours on a rest-of-season stand-in: the mean of his positive projections over
//                           Weeks W-3..W (no matchup swing, and a player out in Week W keeps his healthy rate,
//                           as the live app does with ESPN's rest-of-season projection before its injury discount)
//   preseason               the preseason full-season projection per game (data/draft-prep/2026/board.csv)
//   espnSeason              ESPN's weekly projections averaged over Weeks 1..W; a week he was projected 0 while
//                           injured (not a bye) counts as his season average instead (Nic, Nov 22)
//   oursPre, oursSeason     ours (ramp toward the season average, 0.6 PAR + 0.4 WAR) on those two rates
//
// Limits: ESPN's stored projection is its single-week number for Week W, so a player out that week reads 0
// even if he returns soon (the charts don't have that problem). The "played Week W" rows drop those players.
import { readFileSync } from 'node:fs';
import type { Dataset, PlayerId, Pos, TeamId } from '../src/data/schema.ts';
import { rampWeight } from '../src/engine/model.ts';
import { projectedWar, type Starter } from '../src/engine/war.ts';

const ds: Dataset = JSON.parse(readFileSync(new URL('../public/seed/fwhl-2026.json', import.meta.url), 'utf8'));
const S = ds.season;
const slots = S.lineup as Pos[][];
const pos = new Map(ds.players.map((p) => [p.id, p.pos as Pos]));
const last = Math.max(...ds.games.filter((g) => g.status === 'final').map((g) => g.week));
const rows = new Map<number, Map<PlayerId, Dataset['playerWeeks'][number]>>();
for (const r of ds.playerWeeks) { if (!rows.has(r.week)) rows.set(r.week, new Map()); rows.get(r.week)!.set(r.playerId, r); }
const played = (r: Dataset['playerWeeks'][number] | undefined) => !!r && r.opponent !== 'BYE' && r.points !== null && !(r.points === 0 && !r.projection);

// Replacement level by position from a list of (pos, value): the replacementRank-th best.
const replOf = (xs: { pos: Pos; v: number }[]) => Object.fromEntries((['QB', 'RB', 'WR', 'TE'] as Pos[]).map((p) => {
  const a = xs.filter((x) => x.pos === p).map((x) => x.v).sort((x, y) => y - x);
  return [p, a[S.replacementRank[p] - 1] ?? a[a.length - 1] ?? 0];
})) as Record<Pos, number>;
const weekRepl = new Map<number, Record<Pos, number>>();
for (const [w, m] of rows) weekRepl.set(w, replOf([...m.values()].filter(played).map((r) => ({ pos: pos.get(r.playerId)!, v: r.points! }))));

function rank(xs: number[]): number[] {
  const o = xs.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const r = new Array<number>(xs.length);
  for (let i = 0; i < o.length;) { let j = i; while (j + 1 < o.length && o[j + 1]![0] === o[i]![0]) j++; for (let k = i; k <= j; k++) r[o[k]![1]] = (i + j) / 2; i = j + 1; }
  return r;
}
function spearman(a: number[], b: number[]): number {
  const ra = rank(a), rb = rank(b), n = a.length, m = (n - 1) / 2;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { num += (ra[i]! - m) * (rb[i]! - m); da += (ra[i]! - m) ** 2; db += (rb[i]! - m) ** 2; }
  return da && db ? num / Math.sqrt(da * db) : 0;
}
const z = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1; return xs.map((x) => (x - m) / sd); };

// Preseason projections (17 games), matched by name and position.
const nameKey = (n: string) => n.toLowerCase().replace(/[^a-z]/g, '').replace(/(jr|sr|iii|ii)$/, '');
const board = new Map(readFileSync(new URL('../data/draft-prep/2026/board.csv', import.meta.url), 'utf8').trim().split('\n').slice(1)
  .map((l) => l.split(',')).map((c) => [nameKey(c[0]!) + c[2], Number(c[3]) / 17] as const));
const preOf = new Map(ds.players.map((p) => [p.id, board.get(nameKey(p.name) + p.pos) ?? null]));

const chartAt = (src: string, w: number) => new Map(ds.valuations.filter((v) => v.source === src && v.week === w).map((v) => [v.playerId, v.value]));
const PRED = ['peaked', 'menton', 'charts', 'espn', 'seasonAvg', 'ours', 'oursRos', 'preseason', 'espnSeason', 'oursPre', 'oursSeason', 'ours+charts'] as const;
type Pred = (typeof PRED)[number];
type Result = { week: number; n: number; horizon: number; all: Record<Pred, number>; playedW: Record<Pred, number>; byPos: Record<Pred, number>; byPosPlayed: Record<Pred, number> };
const results: Result[] = [];
const h2h: { week: number; agreeAll: number; agreePos: number; pairs: number; disagree: number; oursRight: number; chartsRight: number }[] = [];

for (const W of [...new Set(ds.valuations.map((v) => v.week))].sort((a, b) => a - b)) {
  if (W + 1 > last || !rows.has(W)) continue;
  const pk = chartAt('peaked', W), mn = chartAt('menton', W);
  const wk = rows.get(W)!;
  // What was known before Week W: earlier scores, ESPN's Week W projection, Week W rosters.
  const info = new Map<PlayerId, { pos: Pos; proj: number; avg: number | null; games: number; ramped: number; healthy: number; pre: number; season: number; team: TeamId | null }>();
  for (const r of wk.values()) {
    const p = pos.get(r.playerId);
    if (!p) continue;
    const prev: number[] = [];
    for (let w = 1; w < W; w++) { const x = rows.get(w)?.get(r.playerId); if (played(x)) prev.push(x!.points!); }
    const avg = prev.length ? prev.reduce((a, b) => a + b, 0) / prev.length : null;
    const proj = r.projection ?? 0;
    // Stand-in for ESPN's rest-of-season rate (what the live app uses): the mean of his positive weekly
    // projections over Weeks W-3..W, which smooths out matchups and ignores a week he's out; else his last one.
    const recent: number[] = [];
    for (let w = Math.max(1, W - 3); w <= W; w++) { const x = rows.get(w)?.get(r.playerId)?.projection ?? 0; if (x > 0) recent.push(x); }
    let hp = recent.length ? recent.reduce((x, y) => x + y, 0) / recent.length : 0;
    for (let w = W - 4; hp <= 0 && w >= 1; w--) hp = rows.get(w)?.get(r.playerId)?.projection ?? 0;
    const rs = Number(process.env.RAMP ?? 1), rw = avg !== null && proj > 0 ? rs * rampWeight(prev.length) : 0, hw = avg !== null && hp > 0 ? rs * rampWeight(prev.length) : 0;
    // Season-long ESPN rate: mean weekly projection over Weeks 1..W, injured 0s filled with his season average.
    const sp: number[] = [];
    for (let w = 1; w <= W; w++) {
      const x = rows.get(w)?.get(r.playerId);
      if (!x || x.opponent === 'BYE') continue;
      if ((x.projection ?? 0) > 0) sp.push(x.projection!);
      else if (avg !== null) sp.push(avg);
    }
    const season = sp.length ? sp.reduce((a, b) => a + b, 0) / sp.length : hp;
    const pre = preOf.get(r.playerId) ?? hp;
    info.set(r.playerId, { pos: p, proj, avg, games: prev.length, ramped: (1 - rw) * proj + rw * (avg ?? 0), healthy: (1 - hw) * hp + hw * (avg ?? 0), pre, season, team: r.slot !== 'fa' ? r.teamId ?? null : null });
  }
  const list = [...info].map(([pid, x]) => ({ pid, ...x }));
  const replE = replOf(list.map((x) => ({ pos: x.pos, v: x.proj }))), replR = replOf(list.map((x) => ({ pos: x.pos, v: x.ramped })));
  const replA = replOf(list.filter((x) => x.avg !== null).map((x) => ({ pos: x.pos, v: x.avg! })));
  // Our value at W: projected WAR from each team's best Week W lineup on the ramped projection.
  const teams = new Map<TeamId, typeof list>();
  for (const x of list) if (x.team !== null) teams.set(x.team, [...(teams.get(x.team) ?? []), x]);
  const lineups = new Map<TeamId, Starter[]>();
  for (const [t, xs] of teams) {
    const used = new Set<PlayerId>();
    const pool = xs.filter((x) => x.proj > 0).sort((a, b) => b.ramped - a.ramped);
    lineups.set(t, slots.flatMap((sl) => { const p = pool.find((x) => !used.has(x.pid) && sl.includes(x.pos)); if (!p) return []; used.add(p.pid); return [{ pos: p.pos, v: p.ramped, pid: p.pid }]; }));
  }
  const war = projectedWar(slots, lineups, list.map((x) => ({ pid: x.pid, pos: x.pos, v: x.ramped })), S.sim.weeklySd);
  const zPar = z(list.map((x) => x.ramped - replR[x.pos])), zWar = z(list.map((x) => war.get(x.pid) ?? 0));
  const ours = new Map(list.map((x, i) => [x.pid, 0.6 * zPar[i]! + 0.4 * zWar[i]!]));
  const replH = replOf(list.map((x) => ({ pos: x.pos, v: x.healthy })));
  const warH = projectedWar(slots, lineups, list.map((x) => ({ pid: x.pid, pos: x.pos, v: x.healthy })), S.sim.weeklySd);
  const zParH = z(list.map((x) => x.healthy - replH[x.pos])), zWarH = z(list.map((x) => warH.get(x.pid) ?? 0));
  const oursH = new Map(list.map((x, i) => [x.pid, 0.6 * zParH[i]! + 0.4 * zWarH[i]!]));
  // Ours on any per-week rate: ramp toward the season average, then 0.6 z(PAR) + 0.4 z(WAR).
  const rs = Number(process.env.RAMP ?? 1);
  const oursOn = (rate: (x: (typeof list)[number]) => number) => {
    const v = list.map((x) => { const b = rate(x); const w = x.avg !== null && b > 0 ? rs * rampWeight(x.games) : 0; return (1 - w) * b + w * (x.avg ?? 0); });
    const rp = replOf(list.map((x, i) => ({ pos: x.pos, v: v[i]! })));
    const wr = projectedWar(slots, lineups, list.map((x, i) => ({ pid: x.pid, pos: x.pos, v: v[i]! })), S.sim.weeklySd);
    const zp = z(list.map((x, i) => v[i]! - rp[x.pos])), zw = z(list.map((x) => wr.get(x.pid) ?? 0));
    return new Map(list.map((x, i) => [x.pid, 0.6 * zp[i]! + 0.4 * zw[i]!]));
  };
  const oursPre = oursOn((x) => x.pre), oursSeason = oursOn((x) => x.season);
  const replP = replOf(list.map((x) => ({ pos: x.pos, v: x.pre }))), replS = replOf(list.map((x) => ({ pos: x.pos, v: x.season })));
  // Outcome: points above replacement over Weeks W+1..last, missed weeks 0.
  const future = (p: PlayerId) => { let s = 0; for (let w = W + 1; w <= last; w++) { const r = rows.get(w)?.get(p); if (played(r)) s += r!.points! - weekRepl.get(w)![pos.get(p)!]; } return s; };
  const ids = list.filter((x) => pk.has(x.pid) && mn.has(x.pid)).map((x) => x.pid);
  if (ids.length < 30) continue;
  const val = (p: PlayerId): Record<Exclude<Pred, 'ours+charts'>, number> => {
    const x = info.get(p)!;
    return { peaked: pk.get(p)!, menton: mn.get(p)!, charts: (pk.get(p)! + mn.get(p)!) / 2, espn: x.proj - replE[x.pos], seasonAvg: x.avg === null ? -99 : x.avg - replA[x.pos], ours: ours.get(p)!, oursRos: oursH.get(p)!, preseason: x.pre - replP[x.pos], espnSeason: x.season - replS[x.pos], oursPre: oursPre.get(p)!, oursSeason: oursSeason.get(p)! };
  };
  const corrFor = (sub: PlayerId[]): Record<Pred, number> => {
    const y = sub.map(future), v = sub.map(val);
    const rOurs = rank(v.map((x) => x.ours)), rCh = rank(v.map((x) => x.charts));
    const out = {} as Record<Pred, number>;
    for (const k of PRED) out[k] = k === 'ours+charts' ? spearman(rOurs.map((r, i) => r + rCh[i]!), y) : spearman(v.map((x) => x[k]), y);
    return out;
  };
  const posAvg = (pool: PlayerId[]) => {
    const out = {} as Record<Pred, number>;
    let n = 0;
    for (const p of ['QB', 'RB', 'WR', 'TE'] as Pos[]) {
      const sub = pool.filter((x) => pos.get(x) === p);
      if (sub.length < 8) continue;
      const c = corrFor(sub);
      for (const k of PRED) out[k] = (out[k] ?? 0) + c[k] * sub.length;
      n += sub.length;
    }
    for (const k of PRED) out[k] = (out[k] ?? 0) / (n || 1);
    return out;
  };
  const playedIds = ids.filter((p) => played(wk.get(p)));
  results.push({ week: W, n: ids.length, horizon: last - W, all: corrFor(ids), playedW: corrFor(playedIds), byPos: posAvg(ids), byPosPlayed: posAvg(playedIds) });
  // Head to head with the charts: how closely ours (on the preseason projection) tracks them, and for every
  // two players at the same position that ours and the charts order differently, which one got it right.
  const ch = (p: PlayerId) => (pk.get(p)! + mn.get(p)!) / 2;
  const agreeAll = spearman(ids.map((p) => oursPre.get(p)!), ids.map(ch));
  let agreePos = 0, nPos = 0, oursRight = 0, chartsRight = 0, disagree = 0, pairs = 0;
  for (const ps of ['QB', 'RB', 'WR', 'TE'] as Pos[]) {
    const sub = ids.filter((x) => pos.get(x) === ps);
    if (sub.length < 8) continue;
    agreePos += spearman(sub.map((p) => oursPre.get(p)!), sub.map(ch)) * sub.length; nPos += sub.length;
    const fut = new Map(sub.map((p) => [p, future(p)]));
    for (let i = 0; i < sub.length; i++) for (let j = i + 1; j < sub.length; j++) {
      const a = sub[i]!, b = sub[j]!;
      const so = Math.sign(oursPre.get(a)! - oursPre.get(b)!), sc = Math.sign(ch(a) - ch(b)), sf = Math.sign(fut.get(a)! - fut.get(b)!);
      if (!so || !sc || !sf) continue;
      pairs++;
      if (so === sc) continue;
      disagree++;
      if (so === sf) oursRight++; else chartsRight++;
    }
  }
  h2h.push({ week: W, agreeAll, agreePos: agreePos / (nPos || 1), pairs, disagree, oursRight, chartsRight });
}

if (process.argv.includes('--json')) { console.log(JSON.stringify({ last, results, h2h }, null, 1)); process.exit(0); }
const f = (x: number) => x.toFixed(2).padStart(6);
const table = (title: string, key: 'all' | 'playedW' | 'byPos' | 'byPosPlayed') => {
  console.log(`\n${title}\nweek  n  wks ${PRED.map((k) => k.padStart(11)).join('')}`);
  for (const r of results) console.log(`${String(r.week).padStart(4)} ${String(r.n).padStart(3)} ${String(r.horizon).padStart(3)}  ${PRED.map((k) => f(r[key][k]).padStart(11)).join('')}`);
  const wsum = results.reduce((s, r) => s + r.horizon, 0);
  console.log(`avg (weighted by weeks ahead) ${PRED.map((k) => f(results.reduce((s, r) => s + r[key][k] * r.horizon, 0) / (wsum || 1)).padStart(11)).join('')}`);
};
console.log(`Rank correlation with points above replacement from Week W+1 to Week ${last} (missed weeks 0). Players both charts rate.`);
table('All positions together', 'all');
table('Only players who played Week W (no injury effect)', 'playedW');
table('Within each position (weighted average)', 'byPos');
table('Within each position, only players who played Week W', 'byPosPlayed');
console.log('\nOurs on the preseason projection vs the charts: agreement, and who was right when they disagree');
console.log('week  agree(all) agree(in pos)  same-pos pairs  disagree  ours right  charts right');
for (const h of h2h) console.log(`${String(h.week).padStart(4)}  ${f(h.agreeAll).padStart(10)} ${f(h.agreePos).padStart(13)}  ${String(h.pairs).padStart(14)}  ${String(h.disagree).padStart(8)}  ${String(h.oursRight).padStart(10)}  ${String(h.chartsRight).padStart(12)}   ours ${(100 * h.oursRight / (h.disagree || 1)).toFixed(0)}%`);
const tot = h2h.reduce((t, h) => ({ d: t.d + h.disagree, o: t.o + h.oursRight }), { d: 0, o: 0 });
console.log(`all weeks: ours right in ${tot.o} of ${tot.d} disagreements (${(100 * tot.o / (tot.d || 1)).toFixed(1)}%)`);
