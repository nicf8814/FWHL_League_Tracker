// Numbers behind the History charts (Nov 18): finishes by season, head to head for one owner,
// career luck, scoring by season and who started each all-time player. Pure functions over the
// built history, so the views only draw and the tests can pin the numbers.
import type { OwnerKey } from '../data/history.ts';
import type { PlayerCareer } from './careers.ts';
import { headToHead, luckPath, ownerName, type Career, type Hist } from './history.ts';

// First name when it is unique in the league ("Clint"), the full name when it is not. Charts on a
// phone have room for one short word per owner.
export function shortName(H: Hist, o: OwnerKey): string {
  const full = ownerName(H, o);
  const first = full.split(/\s+/)[0]!;
  const clash = [...H.owners.values()].some((x) => x.key !== o && x.name.split(/\s+/)[0] === first);
  return clash ? full : first;
}

// ---------- H1: every finish, every season ----------
export type Tier = 'title' | 'podium' | 'playoffs' | 'out';
export const tier = (finish: number, playoffTeams: number): Tier => (finish === 1 ? 'title' : finish <= 3 ? 'podium' : finish <= playoffTeams ? 'playoffs' : 'out');

export interface FinishCell { year: number; finish: number | null; tier: Tier | null } // null: not in the league that season
export interface FinishRow { owner: OwnerKey; name: string; short: string; active: boolean; titles: number[]; cells: FinishCell[]; playoffs: number; completed: number; luck: number }

// Finished seasons only; the live one has no final place yet. Lifers, most titles first, then win %.
export function finishGrid(H: Hist, cs: Career[]): { years: number[]; rows: FinishRow[] } {
  const done = H.seasons.filter((s) => !s.live);
  const pct = (c: Career) => (c.w + c.l + c.t ? (c.w + c.t / 2) / (c.w + c.l + c.t) : 0);
  const rows = cs
    .filter((c) => c.lifer)
    .sort((a, b) => b.titles.length - a.titles.length || pct(b) - pct(a))
    .map((c) => ({
      owner: c.owner, name: c.name, short: shortName(H, c.owner), active: c.active, titles: c.titles, playoffs: c.playoffs, completed: c.completed, luck: c.luck,
      cells: done.map((s) => {
        const f = c.seasons.find((x) => x.year === s.year)?.finish ?? null;
        return { year: s.year, finish: f, tier: f === null ? null : tier(f, s.playoffTeams) };
      }),
    }));
  return { years: done.map((s) => s.year), rows };
}

// ---------- H2 on a phone: one owner against everyone ----------
export interface RivalRow { owner: OwnerKey; name: string; short: string; w: number; l: number; t: number; games: number; pct: number }
export function rivalRows(H: Hist, owner: OwnerKey, others: Career[]): RivalRow[] {
  return others
    .filter((x) => x.owner !== owner)
    .map((x) => {
      const h = headToHead(H, owner, x.owner);
      const games = h.games.length;
      return { owner: x.owner, name: x.name, short: shortName(H, x.owner), w: h.w, l: h.l, t: h.t, games, pct: games ? (h.w + h.t / 2) / games : 0.5 };
    })
    .filter((r) => r.games > 0)
    .sort((a, b) => b.pct - a.pct || b.games - a.games);
}

// ---------- H3: career luck ----------
export interface LuckLine { owner: OwnerKey; name: string; short: string; total: number; path: { year: number; total: number }[]; best: { year: number; v: number }; worst: { year: number; v: number }; seasons: number }
export function luckLines(H: Hist, cs: Career[]): LuckLine[] {
  return cs
    .filter((c) => c.seasons.length)
    .map((c) => {
      const each = c.seasons.map((s) => ({ year: s.year, v: s.luck }));
      const best = each.reduce((a, x) => (x.v > a.v ? x : a));
      const worst = each.reduce((a, x) => (x.v < a.v ? x : a));
      return { owner: c.owner, name: c.name, short: shortName(H, c.owner), total: c.luck, path: luckPath(c), best, worst, seasons: c.seasons.length };
    })
    .sort((a, b) => b.total - a.total);
}

// ---------- H4: scoring by season ----------
export interface Spread { year: number; platform: 'ESPN' | 'Sleeper'; live: boolean; n: number; p10: number; p25: number; med: number; p75: number; p90: number; high: { pts: number; owner: OwnerKey; week: number } }

// Nearest-rank quantile on sorted scores; fine for a picture, not meant for the record book.
const q = (v: number[], p: number) => v[Math.min(v.length - 1, Math.max(0, Math.round(p * (v.length - 1))))]!;

// Every regular-season team score each year (playoffs and consolation games left out).
export function scoreSpread(H: Hist): Spread[] {
  return H.seasons.flatMap((s) => {
    const all = s.games.filter((g) => g.kind === 'regular').flatMap((g) => [{ pts: g.hs, owner: g.home, week: g.week }, { pts: g.as, owner: g.away, week: g.week }]);
    if (!all.length) return [];
    const v = all.map((x) => x.pts).sort((a, b) => a - b);
    const high = all.reduce((a, x) => (x.pts > a.pts ? x : a));
    return [{ year: s.year, platform: s.platform, live: s.live, n: v.length, p10: q(v, 0.1), p25: q(v, 0.25), med: q(v, 0.5), p75: q(v, 0.75), p90: q(v, 0.9), high }];
  });
}

// ---------- H7: who started each all-time player ----------
export function starterShares(p: PlayerCareer): { owner: OwnerKey; pts: number }[] {
  const by = new Map<OwnerKey, number>();
  for (const s of p.seasons) by.set(s.owner, (by.get(s.owner) ?? 0) + s.startPts);
  return [...by].filter(([, pts]) => pts > 0).map(([owner, pts]) => ({ owner, pts })).sort((a, b) => b.pts - a.pts);
}
