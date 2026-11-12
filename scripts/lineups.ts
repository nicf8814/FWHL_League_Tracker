// Builds public/seed/lineups/<year>.json from the roster exports in data/history/rosters/ (see
// docs/data-updates.md, "Weekly lineups"). Each export team is matched to its owner in history.json
// by its weekly scores, so the exports' own owner names never need to agree with ours.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { History, OwnerKey } from '../src/data/history.ts';
import type { Lineups, Spot, TeamWeek } from '../src/data/lineups.ts';

interface EspnPlayer { slot: string | null; player: string; playerId: number; pos: string; team: string | null; projectedScore: number | null; actualScore: number | null }
interface EspnPeriod { starters: EspnPlayer[]; bench: EspnPlayer[]; ir: EspnPlayer[]; startersTotal: { projected: number | null; actual: number | null }; matchupTotalPoints?: number; incompleteLineup?: boolean; noMatchupScore?: boolean }
interface EspnFile { seasons: { season: number; dataAvailability: string; teams: { teamId: number; teamName: string; ownerName: string; periods: Record<string, EspnPeriod> }[] }[] }
interface SleeperPlayer { player_id: string | null; name: string | null; position: string | null; nfl_team: string | null; projected_points: number | null; actual_points: number | null; slot?: string }
interface SleeperFile { seasons: { season: string; teams: { roster_id: number; team_name: string }[]; weeks: { week: number; matchups: { teams: { roster_id: number; team_name: string; total_points: number; starters: SleeperPlayer[]; bench: SleeperPlayer[] }[] }[] }[] }[] }

const FINAL_PERIOD = '18'; // ESPN: season totals and final roster
const round = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? null : Math.round(v * 100) / 100);

// One export team's weeks before it is matched to an owner.
interface RawTeam { label: string; weeks: Map<number, TeamWeek>; final?: Spot[] }

class Players {
  list: [string, string, string | null][] = [];
  private at = new Map<string, number>();
  idx(name: string, pos: string, team: string | null): number {
    const k = `${name}|${pos}|${team ?? ''}`;
    let i = this.at.get(k);
    if (i === undefined) { i = this.list.length; this.list.push([name, pos, team]); this.at.set(k, i); }
    return i;
  }
}

function espnSeason(s: EspnFile['seasons'][number], P: Players): RawTeam[] {
  const spot = (p: EspnPlayer, slot: string | null): Spot => [P.idx(p.player, p.pos, p.team), slot, round(p.actualScore), round(p.projectedScore)];
  return s.teams.map((t) => {
    const weeks = new Map<number, TeamWeek>();
    let final: Spot[] | undefined;
    for (const [k, p] of Object.entries(t.periods)) {
      if (k === FINAL_PERIOD) {
        if (s.dataAvailability !== 'full') final = [...p.starters, ...p.bench, ...p.ir].map((x) => spot(x, null)).sort((a, b) => (b[2] ?? 0) - (a[2] ?? 0));
        continue;
      }
      if (!p.starters.length && !p.bench.length) continue;
      const pts = round(p.matchupTotalPoints ?? (p.noMatchupScore ? null : p.startersTotal.actual));
      weeks.set(Number(k), {
        s: p.starters.map((x) => spot(x, x.slot)),
        b: [...p.bench.map((x) => spot(x, null)), ...p.ir.map((x) => spot(x, 'IR'))],
        pts,
        ...(p.incompleteLineup ? { short: true as const } : {}),
      });
    }
    return { label: `${t.ownerName} (${t.teamName})`, weeks, final };
  });
}

function sleeperSeason(s: SleeperFile['seasons'][number], P: Players): RawTeam[] {
  const spot = (p: SleeperPlayer, slot: string | null): Spot => (p.player_id ? [P.idx(p.name ?? p.player_id, p.position ?? '', p.nfl_team), slot, round(p.actual_points), round(p.projected_points)] : [-1, slot, null, null]);
  const teams = new Map<number, RawTeam>(s.teams.map((t) => [t.roster_id, { label: t.team_name ?? `roster ${t.roster_id}`, weeks: new Map() }]));
  for (const w of s.weeks)
    for (const m of w.matchups)
      for (const t of m.teams) {
        const team = teams.get(t.roster_id);
        if (!team) continue;
        team.weeks.set(w.week, { s: t.starters.map((x) => spot(x, x.slot ?? null)), b: t.bench.map((x) => spot(x, null)), pts: round(t.total_points) });
      }
  return [...teams.values()];
}

// Matches each export team to the owner whose history games carry the same weekly scores.
// Sleeper's own scores run up to about a point off the league export, so they match more loosely.
function match(h: History, year: number, raw: RawTeam[], tol: number, errors: string[]): Map<RawTeam, OwnerKey> {
  const s = h.seasons.find((x) => x.year === year)!;
  const scores = new Map<OwnerKey, Map<number, number>>(s.teams.map((t) => [t.owner, new Map()]));
  for (const [week, home, away, hs, as] of s.games) { scores.get(home)!.set(week, hs); scores.get(away)!.set(week, as); }
  const pairs: { t: RawTeam; o: OwnerKey; n: number }[] = [];
  for (const t of raw)
    for (const [o, byWeek] of scores) {
      let n = 0;
      for (const [w, tw] of t.weeks) { const v = byWeek.get(w); if (v !== undefined && tw.pts !== null && Math.abs(v - tw.pts) < tol) n++; }
      pairs.push({ t, o, n });
    }
  pairs.sort((a, b) => b.n - a.n);
  const out = new Map<RawTeam, OwnerKey>(), taken = new Set<OwnerKey>();
  for (const p of pairs) if (!out.has(p.t) && !taken.has(p.o) && p.n >= 5) { out.set(p.t, p.o); taken.add(p.o); }
  for (const t of raw) if (!out.has(t)) errors.push(`${year}: could not match "${t.label}" to an owner by its weekly scores`);
  return out;
}

export function buildLineups(h: History, dir = 'data/history/rosters'): Lineups[] {
  const errors: string[] = [];
  const espn = JSON.parse(readFileSync(join(dir, 'espn-2010-2023.json'), 'utf8')) as EspnFile;
  const sleeper = JSON.parse(readFileSync(join(dir, 'sleeper-2024-2025.json'), 'utf8')) as SleeperFile;
  const inputs = [
    ...espn.seasons.map((s) => ({ year: s.season, source: 'ESPN' as const, detail: s.dataAvailability === 'full' ? 'full' as const : 'starters' as const, build: (P: Players) => espnSeason(s, P) })),
    ...sleeper.seasons.map((s) => ({ year: Number(s.season), source: 'Sleeper' as const, detail: 'full' as const, build: (P: Players) => sleeperSeason(s, P) })),
  ];
  const out: Lineups[] = [];
  for (const inp of inputs.sort((a, b) => a.year - b.year)) {
    if (!h.seasons.some((s) => s.year === inp.year)) { errors.push(`${inp.year}: not in history.json`); continue; }
    const P = new Players();
    const raw = inp.build(P);
    const owner = match(h, inp.year, raw, inp.source === 'Sleeper' ? 1.5 : 0.06, errors);
    const weeks: Lineups['weeks'] = {};
    const final: NonNullable<Lineups['final']> = {};
    for (const t of raw) {
      const o = owner.get(t);
      if (!o) continue;
      for (const [w, tw] of [...t.weeks].sort((a, b) => a[0] - b[0])) (weeks[w] ??= {})[o] = tw;
      if (t.final) final[o] = t.final;
    }
    const notes = inp.detail === 'starters'
      ? ['ESPN kept only weekly starters and their points for this season: no bench or projections. The end-of-season roster shows season totals.']
      : inp.source === 'Sleeper' ? ['Projections were pulled from Sleeper after the fact and may differ from what showed before kickoff.'] : [];
    out.push({ version: 1, year: inp.year, source: inp.source, detail: inp.detail, players: P.list, weeks, ...(Object.keys(final).length ? { final } : {}), notes });
  }
  if (errors.length) throw new Error(`lineup inputs do not add up:\n- ${errors.join('\n- ')}`);
  return out;
}

// One team-week per line keeps the files diffable.
export function formatLineups(L: Lineups): string {
  const { players, weeks, final, ...meta } = L;
  const head = JSON.stringify(meta).slice(0, -1);
  const wk = Object.entries(weeks).map(([w, teams]) => `  ${JSON.stringify(w)}: {\n${Object.entries(teams).map(([o, t]) => `   ${JSON.stringify(o)}: ${JSON.stringify(t)}`).join(',\n')}\n  }`).join(',\n');
  const fin = final ? `,\n "final": {\n${Object.entries(final).map(([o, s]) => `  ${JSON.stringify(o)}: ${JSON.stringify(s)}`).join(',\n')}\n }` : '';
  return `${head},\n "players": [\n${players.map((p) => `  ${JSON.stringify(p)}`).join(',\n')}\n ],\n "weeks": {\n${wk}\n }${fin}\n}\n`;
}
