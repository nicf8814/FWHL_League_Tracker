// League history: every season since 2010 plus the live one, careers, rivalries, records, awards.
// Points are compared within a season ("index": 1.00 = that season's league average per team-game)
// because scoring changed over time (Sleeper years score about a third more).
import type { History, HistOwner, HistSeason, OwnerKey } from '../data/history.ts';
import type { Index } from './league.ts';
import { standings } from './league.ts';
import { luck, type Luck, type Row } from './luck.ts';

export const LIFER_SEASONS = 5;

export interface SeasonRow {
  owner: OwnerKey;
  team: string;
  finish: number | null;
  w: number;
  l: number;
  t: number;
  pf: number;
  pa: number;
  games: number;
  xw: number;
  luck: number; // official wins - expected wins
  allPlay: Luck['allPlay'];
  index: number; // points per game / league average
}

export interface Season {
  year: number;
  platform: HistSeason['platform'];
  live: boolean;
  regularWeeks: number;
  playoffTeams: number;
  top6Weeks: number[];
  roster: string;
  podium: OwnerKey[];
  notes: string[];
  avg: number; // league average points per team-game, regular season
  rows: SeasonRow[]; // final order (or current seed order while live)
  games: Game[];
}

export interface Game {
  year: number;
  week: number;
  home: OwnerKey;
  away: OwnerKey;
  hs: number;
  as: number;
  winner: OwnerKey | null; // null = tie
  kind: 'regular' | 'playoff' | 'consolation';
}

export interface Hist {
  owners: Map<OwnerKey, HistOwner>;
  seasons: Season[]; // oldest first; the live one last
  byYear: Map<number, Season>;
}

const POD = 3;

function finishSeason(s: Omit<Season, 'rows' | 'avg'>, teams: { owner: OwnerKey; team: string; finish: number | null; w: number; l: number; t: number }[]): Season {
  const regular = s.games.filter((g) => g.kind === 'regular');
  const rows: Row<OwnerKey>[] = regular.map((g) => [g.week, g.home, g.away, g.hs, g.as, true]);
  const L = luck(teams.map((t) => t.owner), rows, s.top6Weeks);
  const pts = new Map<OwnerKey, { pf: number; pa: number; n: number }>();
  for (const g of regular)
    for (const [o, f, a] of [[g.home, g.hs, g.as], [g.away, g.as, g.hs]] as const) {
      const p = pts.get(o) ?? { pf: 0, pa: 0, n: 0 };
      pts.set(o, { pf: p.pf + f, pa: p.pa + a, n: p.n + 1 });
    }
  const total = [...pts.values()].reduce((a, p) => ({ pf: a.pf + p.pf, n: a.n + p.n }), { pf: 0, n: 0 });
  const avg = total.n ? total.pf / total.n : 0;
  return {
    ...s,
    avg,
    rows: teams.map((t) => {
      const l = L.get(t.owner)!;
      const p = pts.get(t.owner) ?? { pf: 0, pa: 0, n: 0 };
      const wins = t.w + t.t / 2;
      return { ...t, pf: p.pf, pa: p.pa, games: p.n, xw: l.xw, luck: wins - l.xw, allPlay: l.allPlay, index: p.n && avg ? p.pf / p.n / avg : 0 };
    }),
  };
}

function pastSeason(s: HistSeason): Season {
  const finish = new Map(s.teams.map((t) => [t.owner, t.finish]));
  const bracket = (o: OwnerKey) => (finish.get(o) ?? 99) <= s.playoffTeams;
  const games: Game[] = s.games.map(([week, home, away, hs, as, fix]) => ({
    year: s.year, week, home, away, hs, as,
    winner: fix ?? (hs > as ? home : as > hs ? away : null),
    kind: week <= s.regularWeeks ? 'regular' : bracket(home) && bracket(away) ? 'playoff' : 'consolation',
  }));
  const teams = [...s.teams].sort((a, b) => (a.finish ?? 99) - (b.finish ?? 99)).map((t) => ({ owner: t.owner, team: t.name, finish: t.finish, w: t.w, l: t.l, t: t.t }));
  return finishSeason({ year: s.year, platform: s.platform, live: false, regularWeeks: s.regularWeeks, playoffTeams: s.playoffTeams, top6Weeks: [], roster: s.roster, podium: s.podium, notes: s.notes, games }, teams);
}

function liveSeason(h: History, idx: Index): Season | null {
  const byTeam = new Map(h.owners.filter((o) => o.teamId !== null && !o.filler).map((o) => [o.teamId!, o.key]));
  const own = (id: number) => byTeam.get(id);
  if (idx.teamIds.some((id) => !own(id))) return null; // owners.csv does not cover this league yet
  const year = h.current.year;
  const games: Game[] = idx.games
    .filter(([, , , hs, as, fin]) => fin && hs !== null && as !== null)
    .map(([week, hi, ai, hs, as]) => {
      const [home, away] = [own(hi)!, own(ai)!];
      return { year, week, home, away, hs: hs!, as: as!, winner: hs! > as! ? home : as! > hs! ? away : null, kind: 'regular' as const };
    });
  const teams = standings(idx).map((r) => ({ owner: own(r.teamId)!, team: h.current.teamNames[own(r.teamId)!] ?? idx.teams.get(r.teamId)?.name ?? '', finish: null, w: r.w, l: r.l, t: r.t }));
  const s = idx.ds.season;
  return finishSeason({ year, platform: 'ESPN', live: true, regularWeeks: Math.max(0, ...idx.games.map((g) => g[0])), playoffTeams: s.seedsByRecord + 1, top6Weeks: s.top6Weeks, roster: '', podium: [], notes: [], games }, teams);
}

export function buildHist(h: History, idx?: Index): Hist {
  const seasons = h.seasons.map(pastSeason);
  const live = idx ? liveSeason(h, idx) : null;
  if (live && !seasons.some((s) => s.year === live.year)) seasons.push(live);
  return { owners: new Map(h.owners.map((o) => [o.key, o])), seasons, byYear: new Map(seasons.map((s) => [s.year, s])) };
}

export const ownerName = (H: Hist, o: OwnerKey) => H.owners.get(o)?.name ?? o;
const counts = (H: Hist, o: OwnerKey) => !H.owners.get(o)?.filler;

// ---------- Seats ----------
// The team key that stands for an owner in a season: their own row, or the team they co-own.
export function seatOf(H: Hist, o: OwnerKey, s: Season): OwnerKey | null {
  if (s.rows.some((r) => r.owner === o)) return o;
  const c = H.owners.get(o)?.coOwns?.find((x) => s.year >= x.from && (x.to === undefined || s.year <= x.to));
  return c && s.rows.some((r) => r.owner === c.team) ? c.team : null;
}
// Everyone who ran a team key's team in a season, the export owner first.
export function crew(H: Hist, team: OwnerKey, year: number): OwnerKey[] {
  const s = H.byYear.get(year);
  return s ? [team, ...[...H.owners.keys()].filter((o) => o !== team && seatOf(H, o, s) === team)] : [team];
}
export const crewName = (H: Hist, team: OwnerKey, year: number) => crew(H, team, year).map((o) => ownerName(H, o)).join(' & ');

// ---------- Careers ----------
export interface CareerSeason extends SeasonRow { year: number; live: boolean; with: OwnerKey[] } // with: co-owners that season
export interface Career {
  owner: OwnerKey;
  name: string;
  seasons: CareerSeason[];
  w: number;
  l: number;
  t: number;
  xw: number;
  luck: number;
  index: number; // average season index
  titles: number[];
  runnerUps: number[];
  thirds: number[];
  playoffs: number; // completed seasons finishing inside the playoff field
  completed: number; // seasons with a final place
  lifer: boolean;
  active: boolean; // in the latest season
  drought: number | null; // completed seasons since the last title (null = never won)
}

export function careers(H: Hist): Career[] {
  const latest = H.seasons.at(-1)?.year;
  const out: Career[] = [];
  for (const owner of H.owners.keys()) {
    if (!counts(H, owner)) continue;
    const ss: CareerSeason[] = [];
    const placed: [number[], number[], number[]] = [[], [], []];
    for (const s of H.seasons) {
      const seat = seatOf(H, owner, s);
      if (!seat) continue;
      ss.push({ ...s.rows.find((r) => r.owner === seat)!, year: s.year, live: s.live, with: crew(H, seat, s.year).filter((o) => o !== owner) });
      const p = s.podium.indexOf(seat);
      if (p >= 0 && p < POD) placed[p]!.push(s.year);
    }
    if (!ss.length) continue;
    const sum = (f: (x: CareerSeason) => number) => ss.reduce((a, x) => a + f(x), 0);
    const [titles, runnerUps, thirds] = placed;
    const done = ss.filter((x) => x.finish !== null);
    const lastTitle = titles.at(-1);
    out.push({
      owner, name: ownerName(H, owner), seasons: ss,
      w: sum((x) => x.w), l: sum((x) => x.l), t: sum((x) => x.t), xw: sum((x) => x.xw), luck: sum((x) => x.luck),
      index: sum((x) => x.index) / ss.length,
      titles, runnerUps, thirds,
      playoffs: done.filter((x) => x.finish! <= H.byYear.get(x.year)!.playoffTeams).length,
      completed: done.length,
      lifer: ss.length >= LIFER_SEASONS,
      active: ss.some((x) => x.year === latest),
      drought: lastTitle === undefined ? null : done.filter((x) => x.year > lastTitle).length,
    });
  }
  return out;
}

// ---------- Head to head ----------
export interface H2H { w: number; l: number; t: number; pf: number; pa: number; playoffW: number; playoffL: number; games: Game[] }
// Regular season and playoff bracket games; consolation games are left out. Follows each owner's
// seat, so co-owned seasons count, and two co-owners never play each other in those seasons.
export function headToHead(H: Hist, a: OwnerKey, b: OwnerKey): H2H {
  const out: H2H = { w: 0, l: 0, t: 0, pf: 0, pa: 0, playoffW: 0, playoffL: 0, games: [] };
  for (const s of H.seasons) {
    const [sa, sb] = [seatOf(H, a, s), seatOf(H, b, s)];
    if (!sa || !sb || sa === sb) continue;
    for (const g of s.games) {
      if (g.kind === 'consolation' || !((g.home === sa && g.away === sb) || (g.home === sb && g.away === sa))) continue;
      out.games.push(g);
      out.pf += g.home === sa ? g.hs : g.as;
      out.pa += g.home === sa ? g.as : g.hs;
      if (g.winner === sa) { out.w++; if (g.kind === 'playoff') out.playoffW++; }
      else if (g.winner === sb) { out.l++; if (g.kind === 'playoff') out.playoffL++; }
      else out.t++;
    }
  }
  return out;
}

// ---------- Records ----------
export interface ScoreRec { year: number; week: number; owner: OwnerKey; opp: OwnerKey; pts: number; oppPts: number; index: number; kind: Game['kind'] }
export interface Streak { owner: OwnerKey; len: number; from: string; to: string; live: boolean }
export interface Records {
  high: ScoreRec[];
  low: ScoreRec[];
  blowouts: ScoreRec[]; // index = margin / league average
  closest: ScoreRec[];
  heartbreaks: (ScoreRec & { rank: number })[]; // lost with a top-2 score that week
  robberies: (ScoreRec & { rank: number })[]; // won with a bottom-2 score that week
  winStreaks: Streak[];
  lossStreaks: Streak[];
}

export function records(H: Hist, n = 10): Records {
  const sides: ScoreRec[] = [];
  const heart: (ScoreRec & { rank: number })[] = [], rob: (ScoreRec & { rank: number })[] = [];
  for (const s of H.seasons) {
    const byWeek = new Map<number, number[]>();
    for (const g of s.games) {
      if (g.kind === 'consolation') continue;
      for (const [o, p, op, q] of [[g.home, g.hs, g.away, g.as], [g.away, g.as, g.home, g.hs]] as const) {
        if (!counts(H, o)) continue;
        sides.push({ year: s.year, week: g.week, owner: o, opp: op, pts: p, oppPts: q, index: p / s.avg, kind: g.kind });
      }
      if (g.kind === 'regular' && !s.top6Weeks.includes(g.week)) byWeek.set(g.week, [...(byWeek.get(g.week) ?? []), g.hs, g.as]);
    }
    for (const r of sides.filter((x) => x.year === s.year && x.kind === 'regular' && byWeek.has(x.week))) {
      const all = byWeek.get(r.week)!;
      const rank = all.filter((x) => x > r.pts).length + 1;
      if (r.pts < r.oppPts && rank <= 2) heart.push({ ...r, rank });
      if (r.pts > r.oppPts && rank >= all.length - 1) rob.push({ ...r, rank });
    }
  }
  const top = <T,>(xs: T[], f: (x: T) => number) => [...xs].sort((a, b) => f(b) - f(a)).slice(0, n);
  const margins = sides.filter((x) => x.pts > x.oppPts).map((x) => ({ ...x, index: (x.pts - x.oppPts) / H.byYear.get(x.year)!.avg }));
  // Streaks over regular-season games in order, across seasons.
  const win: Streak[] = [], loss: Streak[] = [];
  const latest = H.seasons.at(-1);
  for (const o of H.owners.keys()) {
    if (!counts(H, o)) continue;
    let cur: { kind: 'W' | 'L' | 'T'; len: number; from: string; to: string } | null = null;
    const push = () => { if (cur && cur.kind !== 'T') (cur.kind === 'W' ? win : loss).push({ owner: o, len: cur.len, from: cur.from, to: cur.to, live: false }); };
    let last = '';
    for (const s of H.seasons) {
      const seat = seatOf(H, o, s);
      if (!seat) continue;
      for (const g of [...s.games].filter((g) => g.kind === 'regular' && !s.top6Weeks.includes(g.week) && (g.home === seat || g.away === seat)).sort((a, b) => a.week - b.week)) {
        const k = g.winner === seat ? 'W' : g.winner === null ? 'T' : 'L';
        const at = `${s.year} Wk ${g.week}`;
        if (cur && cur.kind === k) { cur.len++; cur.to = at; } else { push(); cur = { kind: k, len: 1, from: at, to: at }; }
        last = at;
      }
    }
    push();
    const mine = [...win, ...loss].filter((x) => x.owner === o && x.to === last);
    if (latest?.live) mine.forEach((x) => { if (x.to.startsWith(String(latest.year))) x.live = true; });
  }
  return {
    high: top(sides, (x) => x.index),
    low: top(sides, (x) => -x.index),
    blowouts: top(margins, (x) => x.index),
    closest: top(margins.filter((x) => x.pts !== x.oppPts), (x) => -(x.pts - x.oppPts)),
    heartbreaks: [...heart].sort((a, b) => b.pts / H.byYear.get(b.year)!.avg - a.pts / H.byYear.get(a.year)!.avg),
    robberies: [...rob].sort((a, b) => a.pts / H.byYear.get(a.year)!.avg - b.pts / H.byYear.get(b.year)!.avg),
    winStreaks: top(win, (x) => x.len),
    lossStreaks: top(loss, (x) => x.len),
  };
}

// ---------- Season awards ----------
// luckiest: most wins above what the scores earned; unluckiest: most below.
export interface Awards { year: number; live: boolean; champion?: SeasonRow; runnerUp?: SeasonRow; luckiest: SeasonRow; unluckiest: SeasonRow; mostPoints: SeasonRow; last?: SeasonRow }
export function seasonAwards(H: Hist, s: Season): Awards {
  const rows = s.rows.filter((r) => counts(H, r.owner));
  const best = (f: (r: SeasonRow) => number) => rows.reduce((a, b) => (f(b) > f(a) ? b : a));
  const at = (o?: OwnerKey) => s.rows.find((r) => r.owner === o);
  const lastPlace = s.live ? undefined : s.rows.find((r) => r.finish === s.rows.length);
  return { year: s.year, live: s.live, champion: at(s.podium[0]), runnerUp: at(s.podium[1]), luckiest: best((r) => r.luck), unluckiest: best((r) => -r.luck), mostPoints: best((r) => r.index), last: lastPlace };
}

// Cumulative career luck after each season, for the chart.
export function luckPath(c: Career): { year: number; total: number }[] {
  let t = 0;
  return c.seasons.map((s) => ({ year: s.year, total: (t += s.luck) }));
}
