import type { PlayerId, Pos, TeamId } from '../data/schema.ts';
import type { Index } from './league.ts';

// Matchup wins above replacement (WAR), after the Arrow Analytics method (Nov 22): put a player into
// every team's lineup in place of the weakest starter he could replace and count the head-to-head
// wins that team gains or loses against the other 11. Averaged over all 132 team-vs-team games,
// so 0.05 means he adds a twentieth of a win per week to an average team.
//   Season WAR: actual scores and actual starters, wins counted outright (a tie is half a win).
//   Projected WAR: each team's best projected lineup, wins as a probability (weekly sd from the sim).

export interface Starter { pos: Pos; v: number; pid?: PlayerId }

// Can these positions each take a different slot? (subset allowed: empty slots are fine)
const fillCache = new Map<string, boolean>();
export function canFill(slots: readonly (readonly Pos[])[], positions: readonly Pos[]): boolean {
  if (positions.length > slots.length) return false;
  const key = slots.map((s) => s.join('')).join('|') + '#' + [...positions].sort().join(',');
  const hit = fillCache.get(key);
  if (hit !== undefined) return hit;
  const used = new Array<boolean>(slots.length).fill(false);
  const order = [...positions].sort((a, b) => slots.filter((s) => s.includes(a)).length - slots.filter((s) => s.includes(b)).length);
  const go = (i: number): boolean => {
    if (i === order.length) return true;
    for (let k = 0; k < slots.length; k++) {
      if (used[k] || !slots[k]!.includes(order[i]!)) continue;
      used[k] = true;
      if (go(i + 1)) { used[k] = false; return true; }
      used[k] = false;
    }
    return false;
  };
  const ok = go(0);
  fillCache.set(key, ok);
  return ok;
}

// The lineup total once a player (pos, v) takes the place of the weakest starter he can legally
// replace, or fills an empty slot. null when he can't get into this lineup at all.
export function swapIn(slots: readonly (readonly Pos[])[], starters: readonly Starter[], pos: Pos, v: number): number | null {
  const total = starters.reduce((s, x) => s + x.v, 0);
  const positions = starters.map((x) => x.pos);
  if (starters.length < slots.length && canFill(slots, [...positions, pos])) return total + v;
  let worst: number | null = null;
  for (let i = 0; i < starters.length; i++) {
    const s = starters[i]!;
    if (worst !== null && s.v >= worst) continue;
    const rest = positions.filter((_, j) => j !== i);
    if (canFill(slots, [...rest, pos])) worst = s.v;
  }
  return worst === null ? null : total - worst + v;
}

// Standard normal CDF (Abramowitz-Stegun 7.1.26, error under 1e-7).
export function phi(z: number): number {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
}

export interface WarLine { war: number; games: number }

// Did this player play that week? (not a bye, a score, and not a 0 with no projection = inactive)
const played = (r: { points: number | null; projection: number | null; opponent: string | null } | undefined) =>
  !!r && r.opponent !== 'BYE' && r.points !== null && !(r.points === 0 && !r.projection);

// Season WAR from actual results, weeks `from`..`to` (default: every final week).
export function seasonWar(idx: Index, from = 1, to = idx.scoresThrough): Map<PlayerId, WarLine> {
  const slots = idx.ds.season.lineup as Pos[][];
  const out = new Map<PlayerId, WarLine>();
  for (let w = from; w <= to; w++) {
    const rows = idx.weeks.get(w);
    if (!rows) continue;
    const lineups = new Map<TeamId, Starter[]>();
    for (const r of rows.values()) {
      if (r.slot !== 'start' || r.teamId == null) continue;
      const pos = idx.players.get(r.playerId)?.pos;
      if (!pos) continue;
      const l = lineups.get(r.teamId) ?? [];
      l.push({ pos, v: r.points ?? 0, pid: r.playerId });
      lineups.set(r.teamId, l);
    }
    const teams = [...lineups.keys()];
    if (teams.length < 2) continue;
    const score = new Map(teams.map((t) => [t, lineups.get(t)!.reduce((s, x) => s + x.v, 0)]));
    const games = teams.length * (teams.length - 1);
    const winsAt = (t: TeamId, s: number) => teams.reduce((n, u) => (u === t ? n : n + (s > score.get(u)! ? 1 : s === score.get(u)! ? 0.5 : 0)), 0);
    const base = new Map(teams.map((t) => [t, winsAt(t, score.get(t)!)]));
    for (const r of rows.values()) {
      if (!played(r)) continue;
      const pos = idx.players.get(r.playerId)?.pos;
      if (!pos) continue;
      let net = 0;
      for (const t of teams) {
        const st = lineups.get(t)!;
        if (st.some((x) => x.pid === r.playerId)) continue; // already in that lineup: nothing changes
        const s = swapIn(slots, st, pos, r.points!);
        if (s !== null) net += winsAt(t, s) - base.get(t)!;
      }
      const o = out.get(r.playerId) ?? { war: 0, games: 0 };
      o.war += net / games;
      o.games++;
      out.set(r.playerId, o);
    }
  }
  return out;
}

// Projected WAR for one typical week: `lineups` are each team's best projected starters, `pool` every
// player to rate at his projected points per week. sd = one team's weekly score sd.
export function projectedWar(slots: readonly (readonly Pos[])[], lineups: Map<TeamId, Starter[]>, pool: { pid: PlayerId; pos: Pos; v: number }[], sd: number): Map<PlayerId, number> {
  const teams = [...lineups.keys()];
  const out = new Map<PlayerId, number>();
  if (teams.length < 2) return out;
  const s2 = sd * Math.SQRT2;
  const score = new Map(teams.map((t) => [t, lineups.get(t)!.reduce((s, x) => s + x.v, 0)]));
  const games = teams.length * (teams.length - 1);
  const winsAt = (t: TeamId, s: number) => teams.reduce((n, u) => (u === t ? n : n + phi((s - score.get(u)!) / s2)), 0);
  const base = new Map(teams.map((t) => [t, winsAt(t, score.get(t)!)]));
  for (const p of pool) {
    let net = 0;
    for (const t of teams) {
      const st = lineups.get(t)!;
      if (st.some((x) => x.pid === p.pid)) continue;
      const s = swapIn(slots, st, p.pos, p.v);
      if (s !== null) net += winsAt(t, s) - base.get(t)!;
    }
    out.set(p.pid, net / games);
  }
  return out;
}
