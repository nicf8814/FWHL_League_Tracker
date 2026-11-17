// Weekly lineups: box-score helpers and a player's season log, plus the live season built from the
// league seed in the same shape as a finished season's export file.
import type { OwnerKey } from '../data/history.ts';
import type { Lineups, Spot, TeamWeek } from '../data/lineups.ts';
import type { PlayerId, PlayerWeek, TeamId } from '../data/schema.ts';
import type { Index } from './league.ts';

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

// ---------- the live season ----------
// The same Lineups shape, built from the league seed instead of an export file, so the History
// page's week-by-week view works on the season being played without waiting for the end-of-season
// roster export. Everything above and the whole view read it unchanged.
//
// Two honest gaps against a finished season's file:
//   - the seed records whether a player started, sat or was on IR, but not which lineup slot he
//     filled, so a starter shows his own position (the box score already falls back to it);
//   - only weeks where every game is final are included, the same cut-off careers and drafts use,
//     so a week in progress never shows a half-played box score.
export function liveLineups(idx: Index, owner: (teamId: TeamId) => OwnerKey | undefined): Lineups {
  const year = idx.ds.meta.season;
  const index = new Map<PlayerId, number>();
  const players: Lineups['players'] = [];
  const at = (id: PlayerId) => {
    let i = index.get(id);
    if (i === undefined) {
      const p = idx.players.get(id);
      i = players.push([p?.name ?? id, p?.pos ?? '', p?.nflTeam ?? null]) - 1;
      index.set(id, i);
    }
    return i;
  };
  // The official score of each team's game that week, where the week is final.
  const score = new Map<string, number>();
  for (const [w, h, a, hs, as, fin] of idx.games)
    if (fin && hs !== null && as !== null) { score.set(`${w}-${h}`, hs); score.set(`${w}-${a}`, as); }

  const weeks: Lineups['weeks'] = {};
  for (const [w, rows] of [...idx.weeks].sort((a, b) => a[0] - b[0])) {
    if (w > idx.scoresThrough) continue;
    const byTeam = new Map<TeamId, PlayerWeek[]>();
    for (const r of rows.values()) {
      if (r.teamId === null || r.slot === 'fa') continue; // free agents are not on anyone's roster
      byTeam.set(r.teamId, [...(byTeam.get(r.teamId) ?? []), r]);
    }
    const teams: Record<OwnerKey, TeamWeek> = {};
    for (const [teamId, rs] of byTeam) {
      const o = owner(teamId);
      if (!o) continue; // owners.csv does not cover this team
      const spot = (r: PlayerWeek, slot: string | null): Spot => [at(r.playerId), slot, r.points, r.projection];
      const starters = order(rs.filter((r) => r.slot === 'start'), idx.ds.season.lineup, (r) => idx.players.get(r.playerId)?.pos);
      teams[o] = {
        s: starters.map((r) => spot(r, null)),
        b: [
          ...rs.filter((r) => r.slot === 'bench').map((r) => spot(r, null)),
          ...rs.filter((r) => r.slot === 'ir').map((r) => spot(r, 'IR')), // IR last, as in an export
        ],
        pts: score.get(`${w}-${teamId}`) ?? null,
      };
    }
    if (Object.keys(teams).length) weeks[w] = teams;
  }
  return {
    version: 1,
    year,
    source: 'ESPN',
    detail: 'full',
    players,
    weeks,
    notes: [
      'This season is still being played. Lineup slots are not recorded for it, so each starter shows his own position instead.',
      `Weeks are listed once every game in them is final (through Week ${idx.scoresThrough}).`,
    ],
  };
}

// Starters in the league's own lineup order (season.lineup), so the box score reads QB, RB, RB, WR
// and so on rather than whatever order the week's rows happen to be in. Slots that accept fewer
// positions are filled first, so a flex slot takes what is left instead of claiming a running back
// the RB slot needed. Anyone the template cannot place is appended rather than dropped.
function order<T>(rows: T[], lineup: readonly (readonly string[])[], pos: (r: T) => string | undefined): T[] {
  const left = new Set(rows.keys());
  const picked = new Map<number, T>();
  const slots = lineup.map((fills, i) => ({ fills, i })).sort((a, b) => a.fills.length - b.fills.length || a.i - b.i);
  for (const { fills, i } of slots) {
    const hit = [...left].find((k) => fills.includes(pos(rows[k]!) ?? ''));
    if (hit !== undefined) { picked.set(i, rows[hit]!); left.delete(hit); }
  }
  const placed = [...lineup.keys()].filter((i) => picked.has(i)).map((i) => picked.get(i)!);
  return [...placed, ...[...left].map((k) => rows[k]!)];
}
