import type { Dataset, Injury, Keeper, News, Player, PlayerId, PlayerStats, PlayerWeek, Pos, Team, TeamId } from '../data/schema.ts';
import { seed, tally, type GameRow, type Tally } from './sim.ts';

// Lookup tables built once per dataset. Everything downstream reads these, never the raw lists.
export interface Index {
  ds: Dataset;
  players: Map<PlayerId, Player>;
  teams: Map<TeamId, Team>;
  teamIds: TeamId[];
  roster: Map<TeamId, PlayerId[]>;
  owner: Map<PlayerId, TeamId>;
  irSlot: Set<PlayerId>;
  stats: Map<PlayerId, PlayerStats>;
  injury: Map<PlayerId, Injury>;
  news: Map<PlayerId, News>;
  keeper: Map<PlayerId, Keeper>;
  chart: { peaked: Map<PlayerId, number>; menton: Map<PlayerId, number> };
  fpRank: Map<PlayerId, number>;
  weeks: Map<number, Map<PlayerId, PlayerWeek>>;
  games: GameRow[];
  scoresThrough: number; // last week with every game final
  currentWeek: number; // first week that still has an unplayed game (audit LOGIC-2)
}

export function buildIndex(ds: Dataset): Index {
  const roster = new Map<TeamId, PlayerId[]>(ds.teams.map((t) => [t.id, []]));
  const owner = new Map<PlayerId, TeamId>();
  const irSlot = new Set<PlayerId>();
  for (const r of ds.rosters) {
    roster.get(r.teamId)?.push(r.playerId);
    owner.set(r.playerId, r.teamId);
    if (r.slot === 'ir') irSlot.add(r.playerId);
  }
  // A chart's "current" values are the week its source says it is from, else its latest week.
  const chartWeek = (id: string) =>
    ds.meta.sources.find((s) => s.id === id)?.week ?? Math.max(0, ...ds.valuations.filter((v) => v.source === id).map((v) => v.week));
  const chartMap = (id: string) => {
    const w = chartWeek(id);
    return new Map(ds.valuations.filter((v) => v.source === id && v.week === w).map((v) => [v.playerId, v.value]));
  };
  const weeks = new Map<number, Map<PlayerId, PlayerWeek>>();
  for (const pw of ds.playerWeeks) {
    if (!weeks.has(pw.week)) weeks.set(pw.week, new Map());
    weeks.get(pw.week)!.set(pw.playerId, pw);
  }
  const games: GameRow[] = ds.games.map((g) => [g.week, g.homeId, g.awayId, g.homePts, g.awayPts, g.status === 'final'] as const);
  const allWeeks = [...new Set(ds.games.map((g) => g.week))].sort((a, b) => a - b);
  const open = allWeeks.filter((w) => ds.games.some((g) => g.week === w && g.status !== 'final'));
  const lastWeek = allWeeks[allWeeks.length - 1] ?? 0;
  const currentWeek = open[0] ?? lastWeek + 1;
  return {
    ds,
    players: new Map(ds.players.map((p) => [p.id, p])),
    teams: new Map(ds.teams.map((t) => [t.id, t])),
    teamIds: ds.teams.map((t) => t.id),
    roster,
    owner,
    irSlot,
    stats: new Map(ds.playerStats.map((s) => [s.playerId, s])),
    injury: new Map(ds.injuries.map((i) => [i.playerId, i])),
    news: new Map(ds.news.map((n) => [n.playerId, n])),
    keeper: new Map(ds.keepers.map((k) => [k.playerId, k])),
    chart: { peaked: chartMap('peaked'), menton: chartMap('menton') },
    fpRank: new Map(ds.rankings.filter((r) => r.source === 'fantasypros').map((r) => [r.playerId, r.rank])),
    weeks,
    games,
    scoresThrough: currentWeek - 1,
    currentWeek,
  };
}

// NFL week a calendar date falls in (Monday night closes a week).
export function weekOfDate(iso: string, week1EndsUtc: string): number {
  const d = Date.parse(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
  const mon = Date.parse(`${week1EndsUtc}T23:59:59Z`);
  if (!Number.isFinite(d) || !Number.isFinite(mon)) return 1;
  return Math.max(1, Math.ceil((d - mon) / 864e5 / 7) + 1);
}

// Best possible lineup by actual points that week, from the team's non-IR players.
export function bestActual(idx: Index, team: TeamId, week: number): number | null {
  const rows = [...(idx.weeks.get(week)?.values() ?? [])].filter((r) => r.teamId === team && r.slot !== 'ir' && r.points !== null);
  if (!rows.length) return null;
  const pool = rows.map((r) => ({ pos: idx.players.get(r.playerId)?.pos, v: r.points! })).sort((a, b) => b.v - a.v);
  const used = new Set<number>();
  let total = 0;
  for (const slot of idx.ds.season.lineup) {
    const i = pool.findIndex((p, k) => !used.has(k) && !!p.pos && slot.includes(p.pos as Pos));
    if (i >= 0) { used.add(i); total += pool[i]!.v; }
  }
  return total;
}

export interface StandingRow extends Tally {
  teamId: TeamId;
  seed: number;
  maxPf: number | null; // sum of best possible lineups (never below the real score)
  efficiency: number | null; // PF / max PF over the weeks with data
}

export function standings(idx: Index): StandingRow[] {
  const { season } = idx.ds;
  const T = tally(idx.teamIds, idx.games, season.top6Weeks);
  const max = new Map<TeamId, { mx: number; pf: number; n: number }>();
  for (const [w, h, a, hs, as, fin] of idx.games) {
    if (!fin) continue;
    for (const [t, sc] of [[h, hs], [a, as]] as const) {
      const m = bestActual(idx, t, w);
      if (m === null || sc === null) continue;
      const cur = max.get(t) ?? { mx: 0, pf: 0, n: 0 };
      max.set(t, { mx: cur.mx + Math.max(m, sc), pf: cur.pf + sc, n: cur.n + 1 });
    }
  }
  const order = seed(idx.teamIds, (i) => T.get(i)!.w + T.get(i)!.t / 2, (i) => T.get(i)!.pf, (i, j) => T.get(i)!.h2h.get(j) ?? 0, season.seedsByRecord);
  return order.map((teamId, k) => {
    const m = max.get(teamId);
    return { ...T.get(teamId)!, teamId, seed: k + 1, maxPf: m ? m.mx : null, efficiency: m && m.mx ? m.pf / m.mx : null };
  });
}

// Freshness from each source's own as-of stamp (audit LOGIC-1): dated sources go stale after 3 days,
// weekly charts once they are 2+ weeks behind the current week.
export function freshness(idx: Index, today = new Date()) {
  return idx.ds.meta.sources.map((s) => {
    let stale = false, age = '';
    if (s.week !== undefined) {
      const behind = idx.currentWeek - s.week;
      stale = behind >= 2;
      age = behind <= 0 ? 'current' : `${behind} week${behind === 1 ? '' : 's'} behind`;
    } else {
      const d = Date.parse(`${s.asOf}T12:00:00`);
      const days = Number.isFinite(d) ? Math.max(0, Math.floor((today.getTime() - d) / 864e5)) : NaN;
      stale = !(days <= 3);
      age = Number.isNaN(days) ? 'unknown date' : days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
    }
    return { ...s, stale, age };
  });
}

export function deadlineInfo(idx: Index, now = Date.now()) {
  const d = Date.parse(idx.ds.season.tradeDeadline);
  const ms = d - now;
  const days = Math.ceil(ms / 864e5);
  return { passed: ms <= 0, days, label: ms <= 0 ? 'Deadline passed' : `${days} day${days === 1 ? '' : 's'} to deadline (${new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`, date: new Date(d) };
}

export const teamName =(idx: Index, id: TeamId | null | undefined) => (id == null ? 'Free agent' : idx.teams.get(id)?.name ?? `Team ${id}`);

// LOGIC-14: what the data is missing, so a thin number can be traced to its cause.
export interface Gap { what: string; count: number; total: number; fix: string; names?: string[] }
export function dataGaps(idx: Index): Gap[] {
  const rostered = [...idx.owner.keys()];
  const name = (p: PlayerId) => idx.players.get(p)?.name ?? p;
  const gaps: Gap[] = [];
  const add = (what: string, ids: PlayerId[], fix: string, total = rostered.length) => { if (ids.length) gaps.push({ what, count: ids.length, total, fix, names: ids.map(name).sort() }); };
  add('Rostered players without an ESPN id', rostered.filter((p) => idx.players.get(p)?.espnId == null), 'Filled in by any ESPN task run (results, projections or quick refresh).');
  add('Rostered players without a rest-of-season projection', rostered.filter((p) => idx.stats.get(p)?.projRestOfSeason == null && !idx.injury.get(p)), 'Run the Projections task.');
  add('Rostered players on no trade chart or rank list', rostered.filter((p) => !idx.chart.peaked.has(p) && !idx.chart.menton.has(p) && !idx.fpRank.has(p)), 'Usually deep bench; check spelling in the next chart if a starter is listed.');
  const thin = [...idx.weeks].filter(([w, m]) => w <= idx.scoresThrough && ![...m.values()].some((r) => r.slot === 'fa')).map(([w]) => w).sort((a, b) => a - b);
  if (thin.length) gaps.push({ what: `Weeks with no free-agent scores (${thin.map((w) => `Wk ${w}`).join(', ')})`, count: thin.length, total: idx.scoresThrough, fix: 'Run the "FWHL 5 - Backfill Weeks 1-6" task; trade grades in those weeks use a rougher replacement level.' });
  const missing = Array.from({ length: idx.scoresThrough }, (_, i) => i + 1).filter((w) => !idx.weeks.has(w));
  if (missing.length) gaps.push({ what: `Played weeks with no player scores (${missing.map((w) => `Wk ${w}`).join(', ')})`, count: missing.length, total: idx.scoresThrough, fix: 'Run the Weekly Results task for those weeks.' });
  if (!idx.ds.usage?.length) gaps.push({ what: 'No volume vs production (usage) data', count: 1, total: 1, fix: 'Runs on its own every Tuesday (FantasyPros Stats task).' });
  return gaps;
}
