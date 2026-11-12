// Weekly lineups for past seasons: box-score helpers and a player's season log.
import type { OwnerKey } from '../data/history.ts';
import type { Lineups, Spot, TeamWeek } from '../data/lineups.ts';

export const EMPTY = -1;

// Sum of the starters' points, or null if the export has none of them.
export function startersTotal(t: TeamWeek): number | null {
  const pts = t.s.map((x) => x[2]).filter((v): v is number => v !== null);
  return pts.length ? Math.round(pts.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

export const benchTotal = (t: TeamWeek) => Math.round(t.b.filter((x) => x[1] !== 'IR').reduce((a, x) => a + (x[2] ?? 0), 0) * 100) / 100;

// Bench players (not IR) who outscored the lowest-scoring starter at their own position:
// points a manager left on the bench. Returns the indexes into t.b.
export function benchBeats(L: Lineups, t: TeamWeek): Set<number> {
  const out = new Set<number>();
  const pos = (x: Spot) => (x[0] === EMPTY ? null : L.players[x[0]]![1]);
  t.b.forEach((b, i) => {
    if (b[1] === 'IR' || b[2] === null) return;
    const p = pos(b);
    const same = t.s.filter((s) => pos(s) === p && s[2] !== null);
    if (same.length && b[2] > Math.min(...same.map((s) => s[2]!))) out.add(i);
  });
  return out;
}

// Players that are one person across the season's player table (same name and position; the NFL team can change).
export function samePlayer(L: Lineups, i: number): Set<number> {
  const [name, pos] = L.players[i]!;
  return new Set(L.players.flatMap((p, j) => (p[0] === name && p[1] === pos ? [j] : [])));
}

export interface LogRow { week: number; owner: OwnerKey; role: 'start' | 'bench' | 'ir'; slot: string | null; pts: number | null; proj: number | null }
// Every week the player was on a roster in this league, whoever had him.
export function playerLog(L: Lineups, i: number): LogRow[] {
  const ids = samePlayer(L, i);
  const rows: LogRow[] = [];
  for (const [w, teams] of Object.entries(L.weeks))
    for (const [owner, t] of Object.entries(teams)) {
      for (const x of t.s) if (ids.has(x[0])) rows.push({ week: Number(w), owner, role: 'start', slot: x[1], pts: x[2], proj: x[3] });
      for (const x of t.b) if (ids.has(x[0])) rows.push({ week: Number(w), owner, role: x[1] === 'IR' ? 'ir' : 'bench', slot: x[1], pts: x[2], proj: x[3] });
    }
  return rows.sort((a, b) => a.week - b.week);
}
