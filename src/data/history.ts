// League history, 2010 to last season: public/seed/history.json, built from data/history/*.csv by
// `npm run data -- history`. The current season is not in it; the History page adds it live from
// the league seed. Separate from fwhl-2026.json so that file's format never changes.
import type { TeamId } from './schema.ts';

export type OwnerKey = string; // slug of the owner's name ("clint-h")

export interface HistOwner {
  key: OwnerKey;
  name: string;
  teamId: TeamId | null; // team in the current league seed, if still in the league
  filler?: true; // a spot run by someone else to fill the league; never counted in a career
  note?: string;
}

export interface HistTeam {
  owner: OwnerKey;
  name: string; // that season's team name
  finish: number | null; // final place after the playoffs
  w: number;
  l: number;
  t: number; // official regular-season record
  pf: number;
  pa: number;
}

// [week, home, away, homePts, awayPts] plus the official winner when it differs from the scores.
export type HistGame = [number, OwnerKey, OwnerKey, number, number] | [number, OwnerKey, OwnerKey, number, number, OwnerKey];

export interface HistSeason {
  year: number;
  platform: 'ESPN' | 'Sleeper';
  regularWeeks: number;
  playoffTeams: number;
  roster: string;
  podium: OwnerKey[]; // 1st, 2nd, 3rd
  teams: HistTeam[];
  games: HistGame[]; // regular season and playoffs; byes and unplayed games left out
  notes: string[];
}

export interface History {
  version: 1;
  owners: HistOwner[];
  seasons: HistSeason[];
  current: { year: number; teamNames: Record<OwnerKey, string> };
}

export function validateHistory(raw: unknown): { ok: true; value: History } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const h = raw as History;
  if (!h || typeof h !== 'object' || h.version !== 1) return { ok: false, errors: ['not a version 1 history file'] };
  if (!Array.isArray(h.owners) || !Array.isArray(h.seasons) || !h.current) return { ok: false, errors: ['missing owners, seasons or current'] };
  const keys = new Set(h.owners.map((o) => o.key));
  if (keys.size !== h.owners.length) errors.push('duplicate owner keys');
  for (const s of h.seasons) {
    const at = `season ${s.year}`;
    if (!Number.isInteger(s.year) || !Array.isArray(s.teams) || !Array.isArray(s.games)) { errors.push(`${at}: malformed`); continue; }
    for (const t of s.teams) if (!keys.has(t.owner)) errors.push(`${at}: unknown owner ${t.owner}`);
    const inSeason = new Set(s.teams.map((t) => t.owner));
    for (const g of s.games) {
      if (g.length < 5 || !inSeason.has(g[1]) || !inSeason.has(g[2]) || !Number.isFinite(g[3]) || !Number.isFinite(g[4])) { errors.push(`${at}: bad game ${JSON.stringify(g)}`); break; }
    }
    for (const p of s.podium) if (!inSeason.has(p)) errors.push(`${at}: podium owner ${p} not in the season`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: h };
}
