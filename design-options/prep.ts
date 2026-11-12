// Design mockups only: builds the data the three History mockups embed. Reads the repo's history and
// lineup files and the two draft exports in design-options/source/. Writes nothing outside design-options/.
//   node design-options/prep.ts   (run by design-options/build.ts)
// shortcut: owner and Sleeper-account maps are inline here; the real build would read them from
// data/history/accounts.csv (see design-options/README.md, Data plan). Revisit when a drafts command exists.
import { readFileSync } from 'node:fs';
import type { History } from '../src/data/history.ts';
import type { Lineups } from '../src/data/lineups.ts';
import type { Dataset } from '../src/data/schema.ts';
import { buildHist, crewName, type Hist } from '../src/engine/history.ts';
import { buildIndex } from '../src/engine/league.ts';

const root = new URL('..', import.meta.url).pathname;
const read = <T,>(p: string): T => JSON.parse(readFileSync(root + p, 'utf8')) as T;

interface EspnPick { overallPick: number; round: number; roundPick: number; teamId: number; teamName: string; ownerName: string; player: string; playerId: number; position: string; nflTeam: string | null; keeper: boolean; draftValue: number; espnProjectedValue: number | null; projectedPoints: number | null; actualSeasonPoints: number | null }
interface SleeperPick { pick_no: number; round: number; keeper: boolean; player: { player_id: string; name: string; position: string; nfl_team: string | null }; drafted_by: { roster_id: number; display_name: string }; actual_price: number; projected_price_est: number | null; projected_points: number | null; adp_half_ppr: number | null }

// ESPN draft owner names that differ from history.json (the same three the rosters file uses).
const ESPN_OWNER: Record<string, string> = { 'Clint Helling': 'clint-h', 'Nic Ferrara': 'nicholas-ferrara', 'Tommy Teves & Nick Heisterkamp': 'tommy-teves', 'Tommy Teves': 'tommy-teves' };
const key = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
// Player identity across ESPN and Sleeper: name without punctuation or suffix, plus position.
export const playerKey = (name: string, pos: string) => `${name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z0-9]/g, '')}|${pos === 'DEF' ? 'D/ST' : pos}`;
const REPLACEMENT: Record<string, number> = { QB: 12, TE: 12, K: 12, 'D/ST': 12, RB: 30, WR: 36 };

export interface Pick { y: number; o: string; p: number; price: number; keeper: boolean; ref: number | null; refKind: 'aav' | 'est' | null; proj: number | null; projKind: 'espn' | 'sleeper' | null; pts: number | null; ptsKind: 'season' | 'rostered' | 'to-date'; round: number; overall: number; nfl: string | null; worth: number | null }

export function prep() {
  const raw = read<History>('public/seed/history.json');
  const ds = read<Dataset>('public/seed/fwhl-2026.json');
  const H: Hist = buildHist(raw, buildIndex(ds));
  const espn = read<{ seasons: { season: number; picks: EspnPick[] }[] }>('design-options/source/espn-drafts-2010-2023-2026.json');
  const sleeper = read<{ seasons: { season: string; budget: number; rounds: number; picks: SleeperPick[] }[] }>('design-options/source/sleeper-drafts-2024-2025.json');
  const sleeperRosters = read<{ seasons: { season: string; weeks: { week: number; matchups: { teams: { roster_id: number; total_points: number; starters: { player_id: string | null; actual_points: number | null }[]; bench: { player_id: string | null; actual_points: number | null }[] }[] }[] }[] }[] }>('data/history/rosters/sleeper-2024-2025.json');

  const players: [string, string][] = [];
  const pIdx = new Map<string, number>();
  const player = (name: string, pos: string) => { const k = playerKey(name, pos); let i = pIdx.get(k); if (i === undefined) { i = players.length; players.push([name, pos === 'DEF' ? 'D/ST' : pos]); pIdx.set(k, i); } return i; };
  const unmatched: string[] = [];
  const picks: Pick[] = [];

  for (const s of espn.seasons) {
    const inSeason = new Set(H.byYear.get(s.season)?.rows.map((r) => r.owner) ?? []);
    for (const q of s.picks) {
      const o = ESPN_OWNER[q.ownerName] ?? key(q.ownerName);
      if (!inSeason.has(o)) unmatched.push(`${s.season} ${q.ownerName}`);
      picks.push({ y: s.season, o, p: player(q.player, q.position), price: q.draftValue, keeper: q.keeper, ref: q.espnProjectedValue, refKind: q.espnProjectedValue == null ? null : 'aav', proj: q.projectedPoints, projKind: q.projectedPoints == null ? null : 'espn', pts: q.actualSeasonPoints, ptsKind: s.season === H.seasons.at(-1)!.year ? 'to-date' : 'season', round: q.round, overall: q.overallPick, nfl: q.nflTeam, worth: null });
    }
  }
  for (const s of sleeper.seasons) {
    const y = Number(s.season);
    const R = sleeperRosters.seasons.find((x) => x.season === s.season)!;
    // Sleeper roster id -> owner, by matching weekly totals to history.json games (now Sleeper's own scores).
    const season = H.byYear.get(y)!;
    const owner = new Map<number, string>();
    for (const w of R.weeks) for (const m of w.matchups) for (const t of m.teams) {
      if (owner.has(t.roster_id)) continue;
      const g = season.games.find((g) => g.week === w.week && (Math.abs(g.hs - t.total_points) < 0.006 || Math.abs(g.as - t.total_points) < 0.006));
      if (g) owner.set(t.roster_id, Math.abs(g.hs - t.total_points) < 0.006 ? g.home : g.away);
    }
    // Season points while on a league roster, weeks 1-17 (Sleeper's draft file has no actual points).
    const pts = new Map<string, number>();
    for (const w of R.weeks) { if (w.week > 17) continue; const seen = new Set<string>(); for (const m of w.matchups) for (const t of m.teams) for (const x of [...t.starters, ...t.bench]) if (x.player_id && !seen.has(x.player_id)) { seen.add(x.player_id); pts.set(x.player_id, (pts.get(x.player_id) ?? 0) + (x.actual_points ?? 0)); } }
    for (const q of s.picks) {
      const o = owner.get(q.drafted_by.roster_id);
      if (!o) { unmatched.push(`${y} ${q.drafted_by.display_name}`); continue; }
      const pp = pts.get(q.player.player_id);
      picks.push({ y, o, p: player(q.player.name, q.player.position), price: q.actual_price, keeper: q.keeper, ref: q.projected_price_est, refKind: q.projected_price_est == null ? null : 'est', proj: q.projected_points, projKind: q.projected_points == null ? null : 'sleeper', pts: pp === undefined ? null : Math.round(pp * 100) / 100, ptsKind: 'rostered', round: q.round, overall: q.pick_no, nfl: q.player.nfl_team, worth: null });
    }
  }

  // Hindsight worth: a player's points over a replacement at his position, priced at that draft's
  // going rate (dollars above $1 per point over replacement, non-keepers only). Worth - price = value.
  for (const y of new Set(picks.map((x) => x.y))) {
    const ps = picks.filter((x) => x.y === y && x.pts !== null);
    const repl = new Map<string, number>();
    for (const pos of new Set(ps.map((x) => players[x.p]![1]))) {
      const sorted = ps.filter((x) => players[x.p]![1] === pos).map((x) => x.pts!).sort((a, b) => b - a);
      repl.set(pos, sorted[Math.min((REPLACEMENT[pos] ?? 12) - 1, sorted.length - 1)]!);
    }
    const vor = (x: Pick) => x.pts! - repl.get(players[x.p]![1])!;
    const open = ps.filter((x) => !x.keeper);
    const rate = open.reduce((a, x) => a + Math.max(vor(x), 0), 0) / Math.max(1, open.reduce((a, x) => a + x.price - 1, 0));
    for (const x of ps) x.worth = Math.round(1 + Math.max(vor(x), 0) / rate);
  }

  const owners = [...H.owners.values()].map((o) => ({ k: o.key, name: o.name, filler: !!o.filler, teamId: o.teamId }));
  const seasons = H.seasons.map((s) => ({
    y: s.year, plat: s.platform, live: s.live, weeks: s.regularWeeks, playoffTeams: s.playoffTeams,
    podium: s.podium,
    rows: s.rows.map((r) => ({ o: r.owner, crew: crewName(H, r.owner, s.year), team: r.team, finish: r.finish, w: r.w, l: r.l, t: r.t, pf: Math.round(r.pf * 10) / 10, index: Math.round(r.index * 1000) / 1000, luck: Math.round(r.luck * 100) / 100 })),
  }));
  return { asOf: '2026-11-12', owners, seasons, players, picks: picks.map((x) => [x.y, x.o, x.p, x.price, x.keeper ? 1 : 0, x.ref, x.refKind, x.proj, x.projKind, x.pts, x.ptsKind, x.round, x.overall, x.nfl, x.worth]), unmatched };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const d = prep();
  console.log(JSON.stringify({ players: d.players.length, picks: d.picks.length, unmatched: d.unmatched, bytes: JSON.stringify(d).length }));
}
