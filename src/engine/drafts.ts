// Draft history: picks with hindsight worth and value, by season and by player.
//
// How value is worked out (also shown on the page, ValueHelp in HistoryDrafts.tsx):
//   1. Replacement level: season points of the 12th-best drafted QB, TE, K and D/ST, the 30th RB, the 36th WR.
//   2. Points over replacement = season points minus that level (none if below).
//   3. The draft's going rate = every non-keeper's dollars above $1 / their points over replacement.
//   4. Worth = $1 + points over replacement x going rate. Value = worth - price paid.
// It measures how a pick turned out, not whether it was a good bet at the time.
import type { OwnerKey } from '../data/history.ts';
import { playerKey, type Drafts, type DraftSeason } from '../data/drafts.ts';
import type { PlayerId } from '../data/schema.ts';
import type { Index } from './league.ts';

export const REPLACEMENT: Record<string, number> = { QB: 12, TE: 12, K: 12, 'D/ST': 12, RB: 30, WR: 36 };

export interface HeldBy { owner: OwnerKey; started: number; benched: number; startPts: number; from: number }
export interface DraftPick {
  i: number;
  year: number;
  player: number; // index into book.players
  name: string;
  pos: string;
  owner: OwnerKey; // team key in history.json (a co-owned team shows under its export owner)
  price: number;
  share: number; // price / budget
  keeper: boolean;
  ref: number | null; // price reference (season.ref says which)
  proj: number | null; // projected season points (season.proj says which)
  pts: number | null; // season points (season.pts says how complete)
  round: number;
  overall: number;
  held: HeldBy[] | null; // every team that rostered him that season, in order; null = no weekly lineups
  worth: number | null;
  value: number | null;
}
export interface Basis { dollarsPerPoint: number; repl: Record<string, number> }
export interface DraftBook {
  seasons: Map<number, DraftSeason>;
  years: number[];
  players: [string, string][];
  picks: DraftPick[];
  byYear: Map<number, DraftPick[]>;
  byPlayer: Map<number, DraftPick[]>;
  basis: Map<number, Basis>;
}

// Live season (season.pts 'to-date'): points and weekly use follow the league seed, so they move
// with each weekly results push. teamOwner maps a league team id to its owner key.
function applyLive(picks: DraftPick[], year: number, idx: Index, teamOwner: (teamId: number) => OwnerKey | undefined) {
  const byKey = new Map<string, PlayerId>();
  for (const p of idx.ds.players) byKey.set(playerKey(p.name, p.pos), p.id);
  for (const x of picks) {
    if (x.year !== year) continue;
    const id = byKey.get(playerKey(x.name, x.pos));
    if (id === undefined) continue;
    let pts = 0;
    const held = new Map<OwnerKey, HeldBy>();
    for (const [w, m] of [...idx.weeks].sort((a, b) => a[0] - b[0])) {
      const pw = m.get(id);
      if (!pw || w > idx.scoresThrough) continue;
      pts += pw.points ?? 0;
      const o = pw.teamId != null ? teamOwner(pw.teamId) : undefined;
      if (!o || pw.slot === 'ir' || pw.slot === 'fa') continue;
      const h = held.get(o) ?? { owner: o, started: 0, benched: 0, startPts: 0, from: w };
      if (pw.slot === 'start') { h.started++; h.startPts += pw.points ?? 0; } else h.benched++;
      held.set(o, h);
    }
    // shortcut: the seed lacks free-agent scores for some early weeks, so keep the export's to-date
    // total when it is higher. Revisit once the weekly backfill covers every week.
    x.pts = Math.round(Math.max(pts, x.pts ?? 0) * 100) / 100;
    x.held = [...held.values()].map((h) => ({ ...h, startPts: Math.round(h.startPts * 10) / 10 }));
  }
}

export function valueBasis(picks: DraftPick[]): Basis | null {
  const scored = picks.filter((x) => x.pts !== null);
  if (!scored.length) return null;
  const repl: Record<string, number> = {};
  for (const pos of new Set(scored.map((x) => x.pos))) {
    const pts = scored.filter((x) => x.pos === pos).map((x) => x.pts!).sort((a, b) => b - a);
    repl[pos] = pts[Math.min((REPLACEMENT[pos] ?? 12) - 1, pts.length - 1)]!;
  }
  const open = scored.filter((x) => !x.keeper);
  const over = open.reduce((a, x) => a + Math.max(x.pts! - repl[x.pos]!, 0), 0);
  const dollars = open.reduce((a, x) => a + x.price - 1, 0);
  return over > 0 ? { dollarsPerPoint: dollars / over, repl } : null;
}

export function buildDraftBook(d: Drafts, live?: { year: number; idx: Index; teamOwner: (teamId: number) => OwnerKey | undefined }): DraftBook {
  const seasons = new Map(d.seasons.map((s) => [s.year, s]));
  const picks: DraftPick[] = d.picks.map(([year, player, owner, price, keeper, ref, proj, pts, round, overall, held], i) => ({
    i, year, player, name: d.players[player]![0], pos: d.players[player]![1], owner, price, share: price / (seasons.get(year)?.budget ?? 200), keeper: keeper === 1,
    ref, proj, pts, round, overall, held: held && held.map(([o, started, benched, startPts, from]) => ({ owner: o, started, benched, startPts, from })), worth: null, value: null,
  }));
  if (live && seasons.get(live.year)?.pts === 'to-date') applyLive(picks, live.year, live.idx, live.teamOwner);
  const byYear = new Map<number, DraftPick[]>();
  const byPlayer = new Map<number, DraftPick[]>();
  for (const x of picks) {
    byYear.set(x.year, [...(byYear.get(x.year) ?? []), x]);
    byPlayer.set(x.player, [...(byPlayer.get(x.player) ?? []), x]);
  }
  const basis = new Map<number, Basis>();
  for (const [y, ps] of byYear) {
    const b = valueBasis(ps);
    if (!b) continue;
    basis.set(y, b);
    for (const x of ps) {
      if (x.pts === null) continue;
      x.worth = Math.round(1 + Math.max(x.pts - b.repl[x.pos]!, 0) * b.dollarsPerPoint);
      x.value = x.worth - x.price;
    }
  }
  return { seasons, years: [...seasons.keys()].sort((a, b) => a - b), players: d.players, picks, byYear, byPlayer, basis };
}

// Rank by season points among drafted players at the same position (1 = best).
export const posRank = (book: DraftBook, x: DraftPick) =>
  x.pts === null ? null : 1 + (book.byYear.get(x.year) ?? []).filter((q) => q.pos === x.pos && q.pts !== null && q.pts > x.pts!).length;

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
