// Every player's FWHL career, 2010 to last season: public/seed/careers.json, built from the weekly
// lineup files by `npm run data -- careers`. The live season is not in it; the All-time page adds it
// from the league seed, the way the Drafts page does.
//
// The one number that exists for all 16 seasons is points scored while in an FWHL starting lineup:
// ESPN kept only weekly starters for 2010-2017, so bench and roster totals start in 2018. Both are
// carried here and the page says which seasons each covers.
import type { OwnerKey } from './history.ts';

// [player, season, owner, starter points, weeks started, bench points, weeks rostered, champion roster]
// Bench points and weeks rostered are null for a season the export kept starters only.
// Champion roster: 1 = this owner won it all and the player was on the roster at the end of that season.
export type CareerRow = [number, number, OwnerKey, number, number, number | null, number | null, 0 | 1];

export interface Careers {
  version: 1;
  through: number; // last season in the file
  full: number[]; // seasons with bench and roster detail
  players: [string, string][]; // [name, position]
  rows: CareerRow[];
}

export const careersUrl = (base: string) => `${base}seed/careers.json`;

export function validateCareers(raw: unknown): { ok: true; value: Careers } | { ok: false; errors: string[] } {
  const c = raw as Careers;
  if (!c || typeof c !== 'object' || c.version !== 1) return { ok: false, errors: ['not a version 1 careers file'] };
  if (!Array.isArray(c.players) || !Array.isArray(c.rows) || !Array.isArray(c.full) || !Number.isInteger(c.through)) return { ok: false, errors: ['missing players, rows, full or through'] };
  const errors: string[] = [];
  for (const r of c.rows) {
    if (!Array.isArray(r) || r.length !== 8) { errors.push(`bad row ${JSON.stringify(r).slice(0, 80)}`); break; }
    if (!Number.isInteger(r[0]) || r[0] < 0 || r[0] >= c.players.length) { errors.push(`row points at no player: ${JSON.stringify(r).slice(0, 80)}`); break; }
    if (!Number.isInteger(r[1]) || typeof r[2] !== 'string' || !Number.isFinite(r[3]) || !Number.isInteger(r[4])) { errors.push(`bad row ${JSON.stringify(r).slice(0, 80)}`); break; }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: c };
}
