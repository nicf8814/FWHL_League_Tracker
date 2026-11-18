// Draft history: picks with hindsight worth and value, by season and by player.
//
// How value is worked out (also shown on the page, ValueHelp in HistoryDrafts.tsx):
//   1. Each draft's price slots by position: what every player went for, most expensive first.
//      Kept players are slotted in at what they would have cost at auction: their market price
//      (ESPN average auction value, or the export's estimate) times that draft's inflation (what the
//      league paid for auctioned players over their market price). Keepers take players off the
//      board, so the league pays more for the rest; real prices keep that in.
//   2. The price curve: each slot averaged over that draft and the ones either side (CURVE_WINDOW).
//   3. Drafted worth = the curve's price at his finish (RB2 is worth the 2nd RB slot).
//      Pick value = drafted worth - price: how the pick turned out, whoever ended up with him.
//   4. Realized worth = drafted worth x the share of his season he spent on the drafter's roster
//      (bench weeks count, IR does not). Weeks after the drafter traded him still count as his: the
//      Trading tab grades what came back. Value = realized worth - price: what the drafter got out
//      of it. A player let go before Week 1 who became a star is a great pick (pick value) but
//      realizes nothing for the team that drafted him (Nic, Nov 18: Mostert 2023). Owner grades use Value.
//   5. Points for his price (xPts): what players bought near his price at his position scored, in
//      the drafts around his. Points over that show how much of a surprise he was.
// It measures how a pick turned out, not whether it was a good bet at the time.
// The older points-over-replacement rate (Basis.dollarsPerPoint, repl) stays for the trade grade and
// the keeper skill numbers.
import type { OwnerKey } from '../data/history.ts';
import { playerKey, type Drafts, type DraftSeason } from '../data/drafts.ts';
import type { Trades } from '../data/trades.ts';
import type { PlayerId } from '../data/schema.ts';
import type { Index } from './league.ts';

export const REPLACEMENT: Record<string, number> = { QB: 12, TE: 12, K: 12, 'D/ST': 12, RB: 30, WR: 36 };
export const CURVE_WINDOW = 1; // drafts either side averaged into a draft's price curve
export const XPTS_WINDOW = 2; // drafts either side sampled for points for a price
const XPTS_MIN = 3; // fewest players near a price to say what it buys

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
  traded: OwnerKey[]; // teams that got him from the drafter by trade that season (their weeks count as the drafter's)
  worth: number | null; // drafted worth: the price curve at his finish
  heldShare: number | null; // share of his season on the drafter's roster (null: no weekly lineups)
  realized: number | null; // realized worth: drafted worth x heldShare (drafted worth when no lineups)
  value: number | null; // realized worth - price (what owner grades use)
  pickValue: number | null; // drafted worth - price (how the pick turned out, whoever had him)
  xPts: number | null; // what his price usually bought in points (null: season in progress or too few near his price)
}
export interface Basis {
  dollarsPerPoint: number; repl: Record<string, number>; // points over replacement (trade grade, keeper skill)
  inflation: number | null; // auctioned players' price / market price (null: no market prices that year)
  curve: Record<string, number[]>; // price of each slot by position, index 0 = the most expensive, window-averaged
}
export interface DraftBook {
  seasons: Map<number, DraftSeason>;
  years: number[];
  players: [string, string][];
  picks: DraftPick[];
  byYear: Map<number, DraftPick[]>;
  byPlayer: Map<number, DraftPick[]>;
  basis: Map<number, Basis>;
}

// A player changing teams by trade: from and to are team keys, key is playerKey(name, pos).
export interface TradeMove { year: number; from: OwnerKey; to: OwnerKey; key: string }
export function tradeMoves(t: Trades): TradeMove[] {
  const out: TradeMove[] = [];
  for (const tr of t.trades) for (const [k, s] of tr.sides.entries()) for (const g of s.gets) {
    const [name, pos] = t.players[g.p]!;
    out.push({ year: tr.year, from: tr.sides[1 - k]!.owner, to: s.owner, key: playerKey(name, pos) });
  }
  return out;
}
function liveMoves(year: number, idx: Index, teamOwner: (teamId: number) => OwnerKey | undefined): TradeMove[] {
  const out: TradeMove[] = [];
  for (const t of idx.ds.transactions) if (t.type === 'trade') for (const l of t.legs) {
    const p = idx.players.get(l.playerId), from = teamOwner(l.fromTeamId), to = teamOwner(l.toTeamId);
    if (p && from && to) out.push({ year, from, to, key: playerKey(p.name, p.pos) });
  }
  return out;
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

export function valueBasis(picks: DraftPick[]): Pick<Basis, 'dollarsPerPoint' | 'repl'> | null {
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

// trades: the trade history (public/seed/trades.json); without it, a traded player counts as dropped.
export function buildDraftBook(d: Drafts, live?: { year: number; idx: Index; teamOwner: (teamId: number) => OwnerKey | undefined }, trades?: Trades): DraftBook {
  const seasons = new Map(d.seasons.map((s) => [s.year, s]));
  const picks: DraftPick[] = d.picks.map(([year, player, owner, price, keeper, ref, proj, pts, round, overall, held], i) => ({
    i, year, player, name: d.players[player]![0], pos: d.players[player]![1], owner, price, share: price / (seasons.get(year)?.budget ?? 200), keeper: keeper === 1,
    ref, proj, pts, round, overall, held: held && held.map(([o, started, benched, startPts, from]) => ({ owner: o, started, benched, startPts, from })), traded: [], worth: null, heldShare: null, realized: null, value: null, pickValue: null, xPts: null,
  }));
  const isLive = live && seasons.get(live.year)?.pts === 'to-date';
  if (isLive) applyLive(picks, live.year, live.idx, live.teamOwner);
  // Teams that got each pick from his drafter by trade, following trade chains (A to B, then B to C).
  const moves = new Map<string, TradeMove[]>();
  for (const m of [...(trades ? tradeMoves(trades) : []), ...(isLive ? liveMoves(live.year, live.idx, live.teamOwner) : [])]) {
    const k = `${m.year}|${m.key}`; moves.set(k, [...(moves.get(k) ?? []), m]);
  }
  for (const x of picks) {
    const ms = moves.get(`${x.year}|${playerKey(x.name, x.pos)}`);
    if (!ms) continue;
    const via = new Set([x.owner]);
    for (let grew = true; grew;) { grew = false; for (const m of ms) if (via.has(m.from) && !via.has(m.to)) { via.add(m.to); grew = true; } }
    x.traded = [...via].filter((o) => o !== x.owner);
  }
  const byYear = new Map<number, DraftPick[]>();
  const byPlayer = new Map<number, DraftPick[]>();
  for (const x of picks) {
    byYear.set(x.year, [...(byYear.get(x.year) ?? []), x]);
    byPlayer.set(x.player, [...(byPlayer.get(x.player) ?? []), x]);
  }
  const basis = new Map<number, Basis>();
  const years = [...byYear.keys()].sort((a, b) => a - b);
  const infl = new Map(years.map((y) => [y, inflation(byYear.get(y)!)]));
  const markup = keeperMarkup(picks, infl);
  // A draft's price slots by position: auction prices, keepers at what they'd have cost at auction.
  const slots = new Map(years.map((y) => {
    const by: Record<string, number[]> = {};
    for (const x of byYear.get(y)!) (by[x.pos] ??= []).push(x.keeper ? marketPrice(x, infl.get(y) ?? null, markup) : x.price);
    for (const v of Object.values(by)) v.sort((a, b) => b - a);
    return [y, by];
  }));
  for (const y of years) {
    const ps = byYear.get(y)!;
    const b = valueBasis(ps);
    const near = years.filter((z) => Math.abs(z - y) <= CURVE_WINDOW);
    const curve: Record<string, number[]> = {};
    for (const pos of new Set(ps.map((x) => x.pos))) {
      const n = Math.max(...near.map((z) => slots.get(z)![pos]?.length ?? 0));
      curve[pos] = Array.from({ length: n }, (_, k) => Math.round((near.reduce((a, z) => a + (slots.get(z)![pos]?.[k] ?? 1), 0) / near.length) * 10) / 10);
    }
    basis.set(y, { dollarsPerPoint: b?.dollarsPerPoint ?? 0, repl: b?.repl ?? {}, inflation: infl.get(y) ?? null, curve });
    const live = seasons.get(y)?.pts === 'to-date';
    const bench = ps.some((x) => x.held?.some((h) => h.benched > 0));
    const weeks = Math.max(1, ...ps.flatMap((x) => (x.held ?? []).map((h) => h.from + h.started + h.benched - 1)));
    for (const x of ps) {
      if (x.pts === null) continue;
      const rank = 1 + ps.filter((q) => q.pos === x.pos && q.pts !== null && q.pts > x.pts!).length;
      x.worth = Math.max(1, Math.round(curve[x.pos]?.[rank - 1] ?? 1));
      x.pickValue = x.worth - x.price;
      x.heldShare = heldShare(x, bench, weeks);
      x.realized = x.heldShare === null ? x.worth : Math.round(x.worth * x.heldShare);
      x.value = x.realized - x.price;
      if (!live) x.xPts = pointsForPrice(byYear, seasons, y, x.pos, x.price);
    }
  }
  return { seasons, years: [...seasons.keys()].sort((a, b) => a - b), players: d.players, picks, byYear, byPlayer, basis };
}

// Share of his season on the drafter's roster: his weeks there (started or benched, not IR) over
// his weeks on any league roster. Weeks with a team he was traded to count as the drafter's.
// Nobody rostered him (or only on IR): 0.
function heldShare(x: DraftPick, bench: boolean, weeks: number): number | null {
  if (!x.held) return null;
  const ours = (o: OwnerKey) => o === x.owner || x.traded.includes(o);
  if (bench) {
    const wk = (hs: HeldBy[]) => hs.reduce((a, h) => a + h.started + h.benched, 0);
    const all = wk(x.held);
    return all ? wk(x.held.filter((h) => ours(h.owner))) / all : 0;
  }
  // shortcut: before 2018 only starts were recorded, so the drafter is taken to hold him from Week 1
  // until another team first starts him, and each team after that until the next one does. Revisit
  // if bench weeks for those seasons turn up.
  const others = x.held.filter((h) => !ours(h.owner));
  if (!others.length) return 1;
  const first = Math.min(...others.map((o) => o.from));
  const runs = [{ owner: x.owner, from: 1 }, ...x.held.filter((h) => !ours(h.owner) || h.from > first)].sort((a, b) => a.from - b.from);
  let held = 0;
  runs.forEach((r, k) => { if (ours(r.owner)) held += Math.max(0, (runs[k + 1]?.from ?? weeks + 1) - r.from); });
  return Math.min(1, held / weeks);
}

// Auctioned players' price over their market price that draft (null: no market prices recorded).
function inflation(ps: DraftPick[]): number | null {
  const open = ps.filter((x) => !x.keeper && x.ref !== null && x.ref > 0);
  const paid = open.reduce((a, x) => a + x.price, 0), ref = open.reduce((a, x) => a + x.ref!, 0);
  return ref > 0 ? paid / ref : null;
}
// What a kept player would have cost at auction: market price x that draft's inflation.
// shortcut: a draft with no market prices (2010-11 ESPN gaps, 2017, 2019) uses the keeper price times
// the league-wide markup of keepers' auction price over their keeper price. Revisit if those AAVs turn up.
function marketPrice(x: DraftPick, infl: number | null, markup: number) {
  return x.ref !== null && infl !== null ? Math.max(x.price, x.ref * infl) : x.price * markup;
}
function keeperMarkup(picks: DraftPick[], infl: Map<number, number | null>) {
  const ks = picks.filter((x) => x.keeper && x.ref !== null && infl.get(x.year) != null);
  const est = ks.reduce((a, x) => a + Math.max(x.price, x.ref! * infl.get(x.year)!), 0), paid = ks.reduce((a, x) => a + x.price, 0);
  return paid > 0 ? est / paid : 1;
}
// Average points of auctioned players at a position bought near a price, in the drafts around a season.
function pointsForPrice(byYear: Map<number, DraftPick[]>, seasons: Map<number, DraftSeason>, y: number, pos: string, price: number): number | null {
  const band = Math.max(2, price * 0.25);
  const xs: number[] = [];
  for (const [z, ps] of byYear) {
    if (Math.abs(z - y) > XPTS_WINDOW || seasons.get(z)?.pts === 'to-date') continue;
    for (const q of ps) if (q.pos === pos && !q.keeper && q.pts !== null && Math.abs(q.price - price) <= band) xs.push(q.pts);
  }
  return xs.length >= XPTS_MIN ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
}

// Rank by season points among drafted players at the same position (1 = best).
export const posRank = (book: DraftBook, x: DraftPick) =>
  x.pts === null ? null : 1 + (book.byYear.get(x.year) ?? []).filter((q) => q.pos === x.pos && q.pts !== null && q.pts > x.pts!).length;

export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
