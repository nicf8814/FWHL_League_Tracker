// All-time players: every career in the league since 2010, from public/seed/careers.json plus the
// live season off the league seed.
//
// The ranking number is points scored while in an FWHL starting lineup. It is the only number every
// season has: ESPN kept starters only for 2010-2017, so bench points and weeks rostered start in
// 2018 and are marked partial. Championship rosters count a player once per title: he was on the
// winner's roster at the end of that season.
import type { CareerRow, Careers } from '../data/careers.ts';
import { playerKey } from '../data/drafts.ts';
import type { OwnerKey } from '../data/history.ts';
import type { Index } from './league.ts';

export interface CareerSeasonRow {
  year: number;
  owner: OwnerKey;
  startPts: number;
  weeks: number;
  benchPts: number | null;
  rosterWeeks: number | null;
  ring: boolean;
  live: boolean;
}

export interface PlayerCareer {
  i: number;
  name: string;
  pos: string;
  seasons: CareerSeasonRow[];
  years: number[]; // seasons he was on a roster, oldest first
  first: number;
  last: number;
  startPts: number; // the all-time ranking number
  weeks: number; // weeks started
  ppw: number | null; // points per week started
  benchPts: number | null; // 2018 on
  rosterWeeks: number | null; // 2018 on
  rings: number; // championship rosters
  ringYears: number[];
  owners: OwnerKey[]; // every manager who started or rostered him, most weeks first
  best: { year: number; pts: number } | null; // his best season in this league
}

export interface CareerBook {
  through: number; // last finished season in the file
  full: number[]; // seasons with bench detail
  live: number | null; // the season added from the seed, if any
  players: PlayerCareer[];
  byKey: Map<string, PlayerCareer>;
}

const round = (n: number) => Math.round(n * 100) / 100;

// The live season from the league seed: starter points by team, the same shape as a file row.
function liveRows(idx: Index, owner: (teamId: number) => OwnerKey | undefined): { key: string; name: string; pos: string; row: Omit<CareerSeasonRow, 'live'> }[] {
  const acc = new Map<string, { name: string; pos: string; o: OwnerKey; start: number; weeks: number; bench: number; rost: number }>();
  for (const [w, m] of idx.weeks) {
    if (w > idx.scoresThrough) continue;
    for (const [pid, pw] of m) {
      const p = idx.players.get(pid);
      if (!p || pw.teamId === null || pw.slot === 'fa') continue;
      const o = owner(pw.teamId);
      if (!o) continue;
      const k = `${playerKey(p.name, p.pos)}|${o}`;
      const a = acc.get(k) ?? { name: p.name, pos: p.pos, o, start: 0, weeks: 0, bench: 0, rost: 0 };
      if (pw.slot === 'start') { a.start += pw.points ?? 0; a.weeks++; } else if (pw.slot === 'bench') a.bench += pw.points ?? 0;
      if (pw.slot !== 'ir') a.rost++;
      acc.set(k, a);
    }
  }
  const year = idx.ds.meta.season;
  return [...acc.values()].map((a) => ({
    key: playerKey(a.name, a.pos), name: a.name, pos: a.pos,
    row: { year, owner: a.o, startPts: round(a.start), weeks: a.weeks, benchPts: round(a.bench), rosterWeeks: a.rost, ring: false },
  }));
}

export function buildCareerBook(c: Careers, live?: { idx: Index; owner: (teamId: number) => OwnerKey | undefined }): CareerBook {
  const byKey = new Map<string, PlayerCareer>();
  const players: PlayerCareer[] = [];
  const blank = (i: number, name: string, pos: string): PlayerCareer => ({
    i, name, pos, seasons: [], years: [], first: 0, last: 0, startPts: 0, weeks: 0, ppw: null,
    benchPts: null, rosterWeeks: null, rings: 0, ringYears: [], owners: [], best: null,
  });
  const get = (name: string, pos: string) => {
    const k = playerKey(name, pos);
    let p = byKey.get(k);
    if (!p) { p = blank(players.length, name, pos); players.push(p); byKey.set(k, p); }
    return p;
  };
  for (const [i, [name, pos]] of c.players.entries()) { const p = get(name, pos); if (p.seasons.length === 0) p.i = i; }
  const push = (name: string, pos: string, row: CareerSeasonRow) => get(name, pos).seasons.push(row);
  for (const r of c.rows as CareerRow[]) {
    const [pi, year, owner, startPts, weeks, benchPts, rosterWeeks, ring] = r;
    const [name, pos] = c.players[pi]!;
    push(name, pos, { year, owner, startPts, weeks, benchPts, rosterWeeks, ring: ring === 1, live: false });
  }
  const liveYear = live ? live.idx.ds.meta.season : null;
  if (live) for (const x of liveRows(live.idx, live.owner)) push(x.name, x.pos, { ...x.row, live: true });

  for (const p of players) {
    p.seasons.sort((a, b) => a.year - b.year || a.owner.localeCompare(b.owner));
    p.years = [...new Set(p.seasons.map((s) => s.year))];
    p.first = p.years[0] ?? 0;
    p.last = p.years.at(-1) ?? 0;
    p.startPts = round(p.seasons.reduce((a, s) => a + s.startPts, 0));
    p.weeks = p.seasons.reduce((a, s) => a + s.weeks, 0);
    p.ppw = p.weeks ? round(p.startPts / p.weeks) : null;
    const withBench = p.seasons.filter((s) => s.benchPts !== null);
    p.benchPts = withBench.length ? round(withBench.reduce((a, s) => a + (s.benchPts ?? 0), 0)) : null;
    p.rosterWeeks = withBench.length ? withBench.reduce((a, s) => a + (s.rosterWeeks ?? 0), 0) : null;
    p.ringYears = [...new Set(p.seasons.filter((s) => s.ring).map((s) => s.year))];
    p.rings = p.ringYears.length;
    const byOwner = new Map<OwnerKey, number>();
    for (const s of p.seasons) byOwner.set(s.owner, (byOwner.get(s.owner) ?? 0) + s.weeks + (s.rosterWeeks ?? 0));
    p.owners = [...byOwner].sort((a, b) => b[1] - a[1]).map(([o]) => o);
    const perYear = new Map<number, number>();
    for (const s of p.seasons) perYear.set(s.year, round((perYear.get(s.year) ?? 0) + s.startPts));
    const best = [...perYear].sort((a, b) => b[1] - a[1])[0];
    p.best = best ? { year: best[0], pts: best[1] } : null;
  }
  return { through: c.through, full: c.full, live: liveYear, players, byKey };
}

// Championship rosters, most first: who keeps turning up on a winner.
export const ringLeaders = (book: CareerBook, n = 25) =>
  book.players.filter((p) => p.rings > 0).sort((a, b) => b.rings - a.rings || b.startPts - a.startPts).slice(0, n);

// Every title a manager won, with the players who were on that roster.
export interface RingRoster { year: number; owner: OwnerKey; players: PlayerCareer[] }
export function ringRosters(book: CareerBook): RingRoster[] {
  const m = new Map<string, RingRoster>();
  for (const p of book.players)
    for (const s of p.seasons) {
      if (!s.ring) continue;
      const k = `${s.year}|${s.owner}`;
      const r = m.get(k) ?? { year: s.year, owner: s.owner, players: [] };
      r.players.push(p);
      m.set(k, r);
    }
  for (const r of m.values()) r.players.sort((a, b) => { const ay = a.seasons.find((s) => s.year === r.year)?.startPts ?? 0, by = b.seasons.find((s) => s.year === r.year)?.startPts ?? 0; return by - ay; });
  return [...m.values()].sort((a, b) => b.year - a.year);
}
