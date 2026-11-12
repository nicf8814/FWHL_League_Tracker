// Builds public/seed/drafts.json from the draft exports in data/history/drafts/ (see
// docs/data-updates.md, "Draft history"). Throws with every problem found, so nothing is written
// from bad input. Weekly use and Sleeper season points come from the lineups the same build makes.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { History, OwnerKey } from '../src/data/history.ts';
import { playerKey, type DraftPickRow, type Drafts, type DraftSeason, type Held } from '../src/data/drafts.ts';
import type { Lineups } from '../src/data/lineups.ts';
import { ownerKey } from './history.ts';
import { buildLineups } from './lineups.ts';
import { parseCsv } from './updates.ts';

interface EspnPick { overallPick: number; round: number; ownerName: string; player: string; position: string; keeper: boolean; draftValue: number; espnProjectedValue: number | null; projectedPoints: number | null; actualSeasonPoints: number | null }
interface SleeperPick { pick_no: number; round: number; keeper: boolean; player: { player_id: string; name: string; position: string }; drafted_by: { display_name: string }; actual_price: number; projected_price_est: number | null; projected_points: number | null }

const LAST_LINEUP_WEEK = 17; // Sleeper season points: weeks 1-17 (week 18 had no games)
const table = (dir: string, file: string): Record<string, string>[] => {
  const [head, ...rows] = parseCsv(readFileSync(join(dir, file), 'utf8'));
  return rows.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
};
const round2 = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

export interface DraftsReport { seasons: string[]; unmatched: string[] }

export function buildDrafts(h: History, dir = 'data/history', lineups?: Lineups[]): { drafts: Drafts; report: DraftsReport } {
  const errors: string[] = [];
  const espn = JSON.parse(readFileSync(join(dir, 'drafts/espn-2010-2023-2026.json'), 'utf8')) as { seasons: { season: number; picks: EspnPick[] }[] };
  const sleeper = JSON.parse(readFileSync(join(dir, 'drafts/sleeper-2024-2025.json'), 'utf8')) as { seasons: { season: string; budget: number; rounds: number; picks: SleeperPick[] }[] };
  const accounts = table(dir, 'accounts.csv');
  const notes = table(dir, 'draft-notes.csv');
  const L = lineups ?? buildLineups(h, join(dir, 'rosters'));

  // Owners each season may draft for: the season's teams, or the live league's.
  const inSeason = (y: number): Set<OwnerKey> => new Set(y === h.current.year ? Object.keys(h.current.teamNames) : h.seasons.find((s) => s.year === y)?.teams.map((t) => t.owner) ?? []);
  const account = (platform: string, y: number, name: string): OwnerKey => {
    const a = accounts.find((r) => r.platform === platform && r.account === name && (!r.season || Number(r.season) === y));
    return ownerKey(a ? a.owner! : name);
  };

  // Weekly use from the lineups: who had each player, for how long.
  const held = new Map<string, Map<OwnerKey, [number, number, number, number]>>();
  const rostered = new Map<string, number>(); // Sleeper season points while on a league roster
  for (const l of L) for (const [w, teams] of Object.entries(l.weeks)) for (const [o, t] of Object.entries(teams)) {
    const add = (i: number, started: boolean, pts: number | null) => {
      if (i < 0) return;
      const [nm, pos] = l.players[i]!;
      const k = `${l.year}|${playerKey(nm, pos)}`;
      const m = held.get(k) ?? new Map(); held.set(k, m);
      const u = m.get(o) ?? [0, 0, 0, Number(w)]; m.set(o, u);
      if (started) { u[0]++; u[2] += pts ?? 0; } else u[1]++;
      u[3] = Math.min(u[3], Number(w));
      if (l.source === 'Sleeper' && Number(w) <= LAST_LINEUP_WEEK) rostered.set(k, (rostered.get(k) ?? 0) + (pts ?? 0));
    };
    for (const x of t.s) add(x[0], true, x[2]);
    for (const x of t.b) if (x[1] !== 'IR') add(x[0], false, x[2]);
  }
  const lineupYears = new Set(L.map((l) => l.year));
  const heldFor = (y: number, k: string): Held[] | null => (lineupYears.has(y) ? [...(held.get(`${y}|${k}`) ?? new Map<OwnerKey, [number, number, number, number]>())].sort((a, b) => a[1][3] - b[1][3]).map(([o, u]) => [o, u[0], u[1], Math.round(u[2] * 10) / 10, u[3]] as Held) : null);

  const players: [string, string][] = [];
  const pIdx = new Map<string, number>();
  const player = (name: string, pos: string) => {
    const p = pos === 'DEF' ? 'D/ST' : pos, k = playerKey(name, p);
    let i = pIdx.get(k);
    if (i === undefined) { i = players.length; players.push([name, p]); pIdx.set(k, i); } else players[i]![0] = name; // newest spelling wins
    return { i, k };
  };
  const picks: DraftPickRow[] = [];
  const seasons: DraftSeason[] = [];
  const unmatched = new Set<string>();
  const note = (y: number) => notes.filter((n) => Number(n.season) === y).map((n) => n.note!);

  const inputs = [
    ...espn.seasons.map((s) => ({ y: s.season, run: () => {
      const ok = inSeason(s.season);
      for (const q of s.picks) {
        const o = account('espn', s.season, q.ownerName);
        if (!ok.has(o)) unmatched.add(`${s.season} ESPN owner "${q.ownerName}"`);
        const { i, k } = player(q.player, q.position);
        picks.push([s.season, i, o, q.draftValue, q.keeper ? 1 : 0, round2(q.espnProjectedValue), round2(q.projectedPoints), round2(q.actualSeasonPoints), q.round, q.overallPick, heldFor(s.season, k)]);
      }
      const live = s.season === h.current.year;
      seasons.push({ year: s.season, platform: 'ESPN', budget: 200, rounds: Math.max(...s.picks.map((q) => q.round)), ref: 'aav', proj: 'espn', pts: live ? 'to-date' : 'season', notes: note(s.season) });
    } })),
    ...sleeper.seasons.map((s) => ({ y: Number(s.season), run: () => {
      const y = Number(s.season), ok = inSeason(y);
      for (const q of s.picks) {
        const o = account('sleeper', y, q.drafted_by.display_name);
        if (!ok.has(o)) unmatched.add(`${y} Sleeper account "${q.drafted_by.display_name}" (add it to accounts.csv)`);
        const { i, k } = player(q.player.name, q.player.position);
        picks.push([y, i, o, q.actual_price, q.keeper ? 1 : 0, round2(q.projected_price_est), round2(q.projected_points), round2(rostered.get(`${y}|${k}`)), q.round, q.pick_no, heldFor(y, k)]);
      }
      seasons.push({ year: y, platform: 'Sleeper', budget: s.budget, rounds: s.rounds, ref: 'est', proj: 'sleeper', pts: 'rostered', notes: note(y) });
    } })),
  ].sort((a, b) => a.y - b.y);
  for (const x of inputs) x.run();
  errors.push(...unmatched);
  if (errors.length) throw new Error(`draft inputs do not add up:\n- ${errors.join('\n- ')}`);

  picks.sort((a, b) => a[0] - b[0] || a[9] - b[9]);
  const report = seasons.map((s) => {
    const ps = picks.filter((p) => p[0] === s.year);
    const spend = new Map<string, number>();
    for (const p of ps) spend.set(p[2], (spend.get(p[2]) ?? 0) + p[3]);
    return `${s.year} ${s.platform}: ${ps.length} picks, ${ps.filter((p) => p[4]).length} keepers, team spend $${Math.min(...spend.values())}-$${Math.max(...spend.values())}`;
  });
  return { drafts: { version: 1, seasons, players, picks }, report: { seasons: report, unmatched: [...unmatched] } };
}

// One pick per line keeps the file diffable.
export function formatDrafts(d: Drafts): string {
  return `{\n "version": 1,\n "seasons": [\n${d.seasons.map((s) => `  ${JSON.stringify(s)}`).join(',\n')}\n ],\n "players": [\n${d.players.map((p) => `  ${JSON.stringify(p)}`).join(',\n')}\n ],\n "picks": [\n${d.picks.map((p) => `  ${JSON.stringify(p)}`).join(',\n')}\n ]\n}\n`;
}
