// Draft history, every auction since 2010: public/seed/drafts.json, built from the draft exports in
// data/history/drafts/ by `npm run data -- drafts`. Facts only (who paid what for whom, and how he
// was used); worth and value are worked out in the browser (src/engine/drafts.ts) so the live
// season's numbers follow the weekly data without rebuilding this file.
import type { OwnerKey } from './history.ts';

// [owner (team key), weeks started, weeks on the bench, points as a starter, first week on the roster]
export type Held = [OwnerKey, number, number, number, number];

// [season, player, owner (team key in history.json), price, keeper (1/0), price reference,
//  projected points, season points, round, overall pick, held (null: no weekly lineups)]
export type DraftPickRow = [number, number, OwnerKey, number, 0 | 1, number | null, number | null, number | null, number, number, Held[] | null];

export interface DraftSeason {
  year: number;
  platform: 'ESPN' | 'Sleeper';
  budget: number;
  rounds: number;
  ref: 'aav' | 'est'; // ESPN average auction value, or the Sleeper export's own estimate (not a Sleeper number)
  proj: 'espn' | 'sleeper'; // ESPN preseason, or Sleeper's pulled after the season
  pts: 'season' | 'rostered' | 'to-date'; // full season; weeks on a league roster (Sleeper); season to date (live)
  notes: string[];
}

export interface Drafts {
  version: 1;
  seasons: DraftSeason[];
  players: [string, string][]; // [name, position]; one entry per player across platforms
  picks: DraftPickRow[];
}

export const draftsUrl = (base: string) => `${base}seed/drafts.json`;

export function validateDrafts(raw: unknown): { ok: true; value: Drafts } | { ok: false; errors: string[] } {
  const d = raw as Drafts;
  if (!d || typeof d !== 'object' || d.version !== 1) return { ok: false, errors: ['not a version 1 drafts file'] };
  if (!Array.isArray(d.seasons) || !Array.isArray(d.players) || !Array.isArray(d.picks)) return { ok: false, errors: ['missing seasons, players or picks'] };
  const errors: string[] = [];
  const years = new Set(d.seasons.map((s) => s.year));
  for (const p of d.picks) {
    if (!Array.isArray(p) || p.length !== 11 || !years.has(p[0]) || !Number.isInteger(p[1]) || p[1] < 0 || p[1] >= d.players.length || typeof p[2] !== 'string' || !Number.isFinite(p[3])) { errors.push(`bad pick ${JSON.stringify(p).slice(0, 80)}`); break; }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: d };
}

// One player across ESPN and Sleeper: name without punctuation or a suffix, plus position.
export const playerKey = (name: string, pos: string) =>
  `${name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z0-9]/g, '')}|${pos === 'DEF' ? 'D/ST' : pos}`;
