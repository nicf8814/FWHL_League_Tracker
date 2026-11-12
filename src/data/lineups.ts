// Weekly lineups for past seasons: public/seed/lineups/<year>.json, one file per season, built
// from the roster exports in data/history/rosters/ by `npm run data -- lineups`. The History page
// loads a season's file only when someone opens that season's weeks.
import type { OwnerKey } from './history.ts';

// [player index, lineup slot, actual points, projected points]. Player index -1 = an empty slot.
// slot is null where ESPN did not keep it (2010-2017); points are null where not available.
export type Spot = [number, string | null, number | null, number | null];

export interface TeamWeek {
  s: Spot[]; // starters, in lineup order
  b: Spot[]; // bench (with IR players at the end, slot "IR")
  pts: number | null; // the official team score that week
  short?: true; // the listed starters do not add up to the official score (a starter missing from the export)
}

export interface Lineups {
  version: 1;
  year: number;
  source: 'ESPN' | 'Sleeper';
  detail: 'full' | 'starters'; // full: bench and projections every week; starters: weekly starters only
  players: [string, string, string | null][]; // [name, position, NFL team]
  weeks: Record<string, Record<OwnerKey, TeamWeek>>; // week -> owner (team key in history.json) -> lineup
  final?: Record<OwnerKey, Spot[]>; // end-of-season roster with season totals (starters-only seasons)
  notes: string[];
}

export const lineupsUrl = (base: string, year: number) => `${base}seed/lineups/${year}.json`;

export function validateLineups(raw: unknown, year?: number): { ok: true; value: Lineups } | { ok: false; errors: string[] } {
  const L = raw as Lineups;
  if (!L || typeof L !== 'object' || L.version !== 1) return { ok: false, errors: ['not a version 1 lineups file'] };
  const errors: string[] = [];
  if (year !== undefined && L.year !== year) errors.push(`file is for ${L.year}, expected ${year}`);
  if (!Array.isArray(L.players) || !L.weeks || typeof L.weeks !== 'object') return { ok: false, errors: ['missing players or weeks'] };
  const okSpot = (x: Spot) => Array.isArray(x) && Number.isInteger(x[0]) && x[0] >= -1 && x[0] < L.players.length;
  for (const [w, teams] of Object.entries(L.weeks))
    for (const [o, t] of Object.entries(teams))
      if (!Array.isArray(t.s) || !Array.isArray(t.b) || ![...t.s, ...t.b].every(okSpot)) { errors.push(`week ${w} ${o}: bad lineup`); break; }
  return errors.length ? { ok: false, errors } : { ok: true, value: L };
}
