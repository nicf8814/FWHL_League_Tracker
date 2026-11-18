// Draft prep: what each player will cost at our auction, what he is worth to a team, and the gap.
// Design: docs/draft-prep/design.md. Method notes are on the page (DraftPrep.tsx, MethodHelp).
//
// Cost (what he will sell for), Nic's 2026 board method refit on our own auctions:
//   1. Rank each position by consensus price and put him in a price tier (TIER_CUTS, the price cliffs
//      Nic found in 2025).
//   2. Tier factor = the tier's share of what the league actually paid over its share of consensus
//      price, measured on recent auctions (fitMarket). Studs get bid up, the middle collapses.
//   3. Weighted price = consensus x tier factor. The money left after keepers (and Nic's planned buys, at
//      his bids) is spread over the open pool in proportion to it (base inflation): a bargain pushes
//      everyone else up, an overbid pulls them down (Nic, Nov 18: "these actions matter").
//   4. Bid window = the least and most the league paid for his slot (RB1, RB2, ...) in recent drafts;
//      cost never goes over the ceiling.
// Worth (what he is worth to a team), the 2026FF_PreDraft_App method on our own history:
//   1. Points over replacement: the replacement player is the last starter league-wide, with FLEX and
//      WR/TE starts split the way our league actually used them (fit.flex).
//   2. Shrink: past preseason projections delivered only part of the gap they projected (fit.shrink),
//      so points over replacement are scaled down by position.
//   3. The money left after keepers is spread over the open pool: $1 each, the rest by shrunk points
//      over replacement.
//   4. Value tiers break where the gap to the next player beats half the usual projection miss.
// Edge = worth - cost: buy below it, never chase above the bid ceiling.
import { playerKey, type Drafts } from '../data/drafts.ts';
import { NEXT_UNPRICED, PREP_POS, type BoardRow, type DraftPrep, type KeeperRow, type NextSample, type PrepFit, type PrepPos, type StandIn, type TierFit } from '../data/draftPrep.ts';

export const TIER_CUTS: Record<PrepPos, [number, string][]> = {
  QB: [[4, 'Elite'], [999, 'Streamer']],
  RB: [[6, 'Elite'], [13, 'High-mid'], [24, 'Low-mid'], [999, 'Deep']],
  WR: [[6, 'Elite'], [20, 'Mid'], [999, 'Deep']],
  TE: [[4, 'Elite'], [999, 'Rest']],
};
export const MARKET_YEARS_BACK = 4; // the four auctions before the draft, newest weighted most
// Seasons with real ESPN preseason projections and full-season points. 2023 has projections for 19 of
// 156 picks, 2024-25 Sleeper projections were pulled after the season, 2026's are current numbers.
export const PROJ_YEARS = [2018, 2019, 2020, 2021, 2022];
export const FLEX_YEARS = [2023, 2024, 2025]; // lineup since 2023: QB, 2 RB, 2 WR, WR/TE, FLEX
const MIN_REF = 3; // consensus price below this is noise at the $1-2 minimum: left out of the fit

// Rank within a list, ties sharing the better rank (two $63 RBs are both RB1).
export function ranks(values: number[]): number[] {
  return values.map((v) => 1 + values.filter((w) => w > v).length);
}
export const tierIndex = (pos: PrepPos, rank: number) => {
  const i = TIER_CUTS[pos].findIndex(([upTo]) => rank <= upTo);
  return i < 0 ? TIER_CUTS[pos].length - 1 : i;
};

// The fitted tier for a position rank (the file's own cutoffs, so an older file still prices right).
export const tierFor = (fit: PrepFit, pos: PrepPos, rank: number): TierFit => fit.tiers[pos].find((t) => rank <= t.upTo) ?? fit.tiers[pos].at(-1)!;


// A past pre-draft board: consensus prices from the same source as this year's board, so the tier
// factors compare like with like. (Fit on ESPN's own auction values instead, the 2026 test missed real
// prices by $5.30 on average against $3.80 for Nic's FantasyPros-based board.)
export interface PastBoard { year: number; rows: { name: string; pos: PrepPos; price: number; rank: number | null }[] }

// Tier factors from past boards, matched to what those players sold for.
export function fitMarket(drafts: Drafts, year: number, boards: PastBoard[]): Pick<PrepFit, 'marketYears' | 'tiers'> {
  const years: [number, number][] = [];
  for (let y = year - MARKET_YEARS_BACK, w = 1; y < year; y++, w++) if (boards.some((b) => b.year === y) && drafts.seasons.some((s) => s.year === y)) years.push([y, w]);
  type Buy = { pos: PrepPos; t: number; price: number; y: number };
  const buys: Buy[] = [];
  const paid: Record<string, number> = {}, share: Record<string, number> = {};
  for (const [y, w] of years) {
    const board = boards.find((b) => b.year === y)!;
    const sold = new Map<string, number>();
    for (const p of drafts.picks) if (p[0] === y && !p[4]) { const [n, pos] = drafts.players[p[1]]!; sold.set(playerKey(n, pos), p[3]); }
    const ys: Omit<Buy, 'q'>[] = [], refs: number[] = [];
    for (const pos of PREP_POS) {
      const list = board.rows.filter((r) => r.pos === pos);
      const r = ranks(list.map((x) => x.price));
      list.forEach((x, i) => {
        const price = sold.get(playerKey(x.name, pos));
        if (price === undefined || x.price < MIN_REF) return; // not auctioned (kept or undrafted), or priced at the minimum
        ys.push({ pos, t: tierIndex(pos, x.rank ?? r[i]!), price, y });
        refs.push(x.price);
      });
    }
    const totalPaid = ys.reduce((s, b) => s + b.price, 0), totalRef = refs.reduce((s, v) => s + v, 0);
    ys.forEach((b, i) => {
      const k = `${b.pos}${b.t}`;
      paid[k] = (paid[k] ?? 0) + w * b.price / totalPaid;
      share[k] = (share[k] ?? 0) + w * refs[i]! / totalRef;
      buys.push(b);
    });
  }
  const factor = (pos: PrepPos, t: number) => { const k = `${pos}${t}`; return share[k] ? paid[k]! / share[k]! : 1; };
  const tiers = Object.fromEntries(PREP_POS.map((pos) => [pos, TIER_CUTS[pos].map(([upTo, label], t): TierFit => ({
    upTo, label, factor: round(factor(pos, t), 3), n: buys.filter((b) => b.pos === pos && b.t === t).length,
  }))])) as Record<PrepPos, TierFit[]>;
  return { marketYears: years, tiers };
}

// Price slots: the k-th most expensive auctioned player at each position, lowest and highest paid
// over the last SLOT_YEARS_BACK auctions. Raw prices: they already reflect what owners will pay.
export const SLOT_YEARS_BACK = 5;
const SLOTS = 40;
export function fitSlots(drafts: Drafts, year: number): Pick<PrepFit, 'slotYears' | 'slots'> {
  const years = drafts.seasons.map((s) => s.year).filter((y) => y < year && y >= year - SLOT_YEARS_BACK);
  const slots = Object.fromEntries(PREP_POS.map((pos) => {
    const byYear = years.map((y) => drafts.picks.filter((p) => p[0] === y && !p[4] && drafts.players[p[1]]![1] === pos).map((p) => p[3]).sort((a, b) => b - a));
    const out: [number, number][] = [];
    for (let k = 0; k < SLOTS; k++) {
      const xs = byYear.map((ps) => ps[k] ?? 1);
      out.push([Math.min(...xs), Math.max(...xs)]);
    }
    return [pos, out];
  })) as Record<PrepPos, [number, number][]>;
  return { slotYears: years, slots };
}

// Shrink and projection miss from seasons with real preseason projections.
export function fitProjections(drafts: Drafts): Pick<PrepFit, 'projYears' | 'shrink' | 'miss'> {
  const shrink = {} as Record<PrepPos, number>, miss = {} as Record<PrepPos, number>;
  for (const pos of PREP_POS) {
    let sxy = 0, sxx = 0, err = 0, tot = 0;
    for (const y of PROJ_YEARS) {
      const xs = drafts.picks.filter((p) => p[0] === y && drafts.players[p[1]]![1] === pos && (p[6] ?? 0) > 0 && p[7] !== null);
      if (xs.length < 3) continue;
      const mx = xs.reduce((s, p) => s + p[6]!, 0) / xs.length, my = xs.reduce((s, p) => s + p[7]!, 0) / xs.length;
      for (const p of xs) { sxy += (p[6]! - mx) * (p[7]! - my); sxx += (p[6]! - mx) ** 2; err += Math.abs(p[7]! - p[6]!); tot += p[6]!; }
    }
    shrink[pos] = round(sxx ? Math.max(0.1, sxy / sxx) : 1, 3);
    miss[pos] = round(tot ? err / tot : 0.3, 3);
  }
  return { projYears: PROJ_YEARS, shrink, miss };
}

// FLEX and WR/TE starts by position, from counts of [slot, position] starts.
export function fitFlex(starts: { slot: string; pos: string; n: number }[], years: number[]): PrepFit['flex'] {
  const sum = (slots: string[], pos?: string) => starts.filter((s) => slots.includes(s.slot) && (!pos || s.pos === pos)).reduce((a, s) => a + s.n, 0);
  const flex = sum(['FLEX']) || 1, rec = sum(['WR/TE', 'REC_FLEX']) || 1;
  return {
    years,
    flexRB: round(sum(['FLEX'], 'RB') / flex, 3), flexWR: round(sum(['FLEX'], 'WR') / flex, 3), flexTE: round(sum(['FLEX'], 'TE') / flex, 3),
    recWR: round(sum(['WR/TE', 'REC_FLEX'], 'WR') / rec, 3), recTE: round(sum(['WR/TE', 'REC_FLEX'], 'TE') / rec, 3),
  };
}

export function replacementRanks(fit: PrepFit, teams: number): Record<PrepPos, number> {
  const f = fit.flex;
  return {
    QB: teams,
    RB: Math.round(teams * (2 + f.flexRB)),
    WR: Math.round(teams * (2 + f.recWR + f.flexWR)),
    TE: Math.max(1, Math.round(teams * (f.recTE + f.flexTE))),
  };
}

export interface PrepRow {
  i: number; // index into prep.board
  name: string;
  pos: PrepPos;
  team: string;
  proj: number | null;
  price: number; // consensus
  rank: number; // position rank by consensus price
  tier: string; // price tier
  keeper: KeeperRow | null;
  bought: number | null; // Nic's planned bid: counted as sold at that price
  cost: number; // expected auction price (for a keeper: what he would cost if thrown back)
  floor: number;
  ceiling: number;
  vorp: number | null; // shrunk points over replacement
  worth: number;
  valueTier: number | null; // 1 = best value tier at his position
  edge: number; // worth - cost
}

export interface PrepBoard {
  rows: PrepRow[];
  base: number; // base inflation on weighted price
  moneyLeft: number; // league money after keepers and planned buys
  keeperSpend: number;
  boughtSpend: number;
  openSlots: number;
  perVorp: number; // dollars per shrunk point over replacement
  repl: Record<PrepPos, { rank: number; points: number }>;
  tierGap: Record<PrepPos, number>; // season points that start a new value tier
}

// keepers: who is kept (defaults to prep.keepers). bought: Nic's planned buys by playerKey, at his bid;
// a kept player can't be bought. Either one not on the board is ignored.
export function priceBoard(prep: DraftPrep, keepers: KeeperRow[] = prep.keepers, bought: Record<string, number> = {}): PrepBoard {
  const { fit, teams, budget, roster } = prep;
  const kept = new Map(keepers.map((k) => [playerKey(k[0], k[1]), k]));
  const base: PrepRow[] = prep.board.map(([name, pos, team, proj, price], i) => ({
    i, name, pos, team, proj, price, rank: 0, tier: '', keeper: kept.get(playerKey(name, pos)) ?? null, bought: null,
    cost: 0, floor: 1, ceiling: 1, vorp: null, worth: 0, valueTier: null, edge: 0,
  }));
  for (const x of base) if (!x.keeper) x.bought = bought[playerKey(x.name, x.pos)] ?? null;
  const taken = (r: PrepRow) => !!r.keeper || r.bought !== null;
  const onBoard = base.filter(taken);
  const keeperSpend = base.reduce((s, r) => s + (r.keeper?.[2] ?? 0), 0);
  const boughtSpend = base.reduce((s, r) => s + (r.bought ?? 0), 0);
  const moneyLeft = teams * budget - keeperSpend - boughtSpend;
  const openSlots = teams * roster - onBoard.length;

  // Cost.
  const weighted = new Map<PrepRow, number>();
  for (const pos of PREP_POS) {
    const list = base.filter((r) => r.pos === pos);
    const r = ranks(list.map((x) => x.price));
    list.forEach((x, j) => {
      x.rank = r[j]!;
      const t = tierFor(fit, pos, x.rank);
      x.tier = t.label;
      weighted.set(x, x.price * t.factor);
    });
  }
  const open = base.filter((r) => !taken(r)).sort((a, b) => weighted.get(b)! - weighted.get(a)!).slice(0, openSlots);
  const pool = open.reduce((s, r) => s + weighted.get(r)!, 0);
  const inflation = pool ? moneyLeft / pool : 1;
  for (const x of base) x.cost = round(weighted.get(x)! * inflation, 1);

  // Bid window from the league's own history: his slot is where his cost ranks among auctioned
  // players at his position (RB1, RB2, ...). Floor = the least that slot sold for in the last
  // SLOT_YEARS_BACK drafts, ceiling = the most. Cost never goes over the ceiling (Nic, Nov 18: the
  // model's $103 and $133 for Gibbs were more than anyone has paid; the record is $100, 2018).
  for (const pos of PREP_POS) {
    const slots = fit.slots[pos];
    base.filter((r) => r.pos === pos && !r.keeper).sort((a, b) => b.cost - a.cost).forEach((x, k) => {
      const [lo, hi] = slots[Math.min(k, slots.length - 1)] ?? [1, x.cost];
      x.cost = Math.min(x.cost, hi);
      x.floor = Math.max(1, Math.round(Math.min(lo, x.cost)));
      x.ceiling = Math.max(1, Math.round(hi));
    });
    // A keeper's cost is what he would sell for if thrown back: same cap, at his rank among everyone.
    base.filter((r) => r.pos === pos).sort((a, b) => b.cost - a.cost).forEach((x, k) => {
      if (!x.keeper) return;
      x.cost = Math.min(x.cost, slots[Math.min(k, slots.length - 1)]?.[1] ?? x.cost);
      x.floor = Math.max(1, Math.round(x.cost));
      x.ceiling = x.floor;
    });
  }

  // Worth.
  const reps = replacementRanks(fit, teams);
  const repl = {} as PrepBoard['repl'], tierGap = {} as PrepBoard['tierGap'];
  for (const pos of PREP_POS) {
    const list = base.filter((r) => r.pos === pos && r.proj !== null).sort((a, b) => b.proj! - a.proj!);
    const at = list[Math.min(reps[pos], list.length) - 1];
    const points = at?.proj ?? 0;
    repl[pos] = { rank: reps[pos], points: round(points, 1) };
    for (const x of list) x.vorp = round(fit.shrink[pos] * (x.proj! - points), 1);
    // Value tiers: a real drop is one bigger than half the usual miss on a starter's projection.
    const starters = list.slice(0, reps[pos]);
    const avg = starters.reduce((s, x) => s + x.proj!, 0) / (starters.length || 1);
    tierGap[pos] = round(0.5 * fit.miss[pos] * avg * fit.shrink[pos], 1);
    let tier = 1;
    list.forEach((x, j) => {
      if (j > 0 && fit.shrink[pos] * (list[j - 1]!.proj! - x.proj!) > tierGap[pos]) tier++;
      x.valueTier = tier;
    });
  }
  const inPool = base.filter((r) => !taken(r)).sort((a, b) => (b.vorp ?? -Infinity) - (a.vorp ?? -Infinity)).slice(0, openSlots);
  const totalVorp = inPool.reduce((s, r) => s + Math.max(0, r.vorp ?? 0), 0);
  const perVorp = totalVorp ? (moneyLeft - openSlots) / totalVorp : 0;
  const poolSet = new Set(inPool);
  for (const x of base) {
    const v = Math.max(0, x.vorp ?? 0);
    x.worth = round(v > 0 ? 1 + v * perVorp : poolSet.has(x) ? 1 : 0, 1);
    x.edge = round(x.worth - x.cost, 1);
  }
  return { rows: base, base: round(inflation, 4), moneyLeft, keeperSpend, boughtSpend, openSlots, perVorp: round(perVorp, 4), repl, tierGap };
}

// ---------------------------------------------------------------------------------------------
// Next year's stand-in board (Nic, Nov 18): before any projections exist, rank each player by this
// season (70% points per game rank, 30% trade value rank; trade value only under MIN_GAMES), then read
// from history where players at that rank, with that share of games played, landed in next August's
// prices. The middle of that spread sets his price and projection (the latest board's numbers at that
// rank); the 25th-75th percentile is shown as his likely range.
export const PROD_WEIGHT = 0.7; // Nic, Nov 18: 70% real production, 30% trade value
export const MIN_GAMES = 4;
export const SEASON_GAMES = 17;
const MIN_CELL = 10; // fewest past players behind a move; fewer and the next broader group is used
const RATIO_CAP = 60; // an unpriced player counts as rank 60 when measuring how far ranks move

export const gamesBand = (share: number): 'full' | 'part' | 'lost' => (share >= 0.75 ? 'full' : share >= 0.4 ? 'part' : 'lost');
const posGroup = (pos: PrepPos) => (pos === 'RB' || pos === 'WR' ? 'RB/WR' : pos);
const rankTier = (pos: PrepPos, r: number) => (pos === 'RB' || pos === 'WR' ? (r <= 6 ? 'top' : r <= 24 ? 'mid' : 'deep') : r <= 3 ? 'top' : r <= 12 ? 'mid' : 'deep');

export interface NextRank { mid: number; lo: number; hi: number; n: number; unpriced: number; from: string }

// Where a player at this rank and games share lands the next August: how far past players at his
// position group, rank tier and games share moved (next August's rank / this season's rank), applied to
// his rank. Thin groups fall back: the next tier joins (top+mid, deep+mid), then all tiers with the same
// games share, then the same tier any games share, then everything at his position group.
export function nextRank(samples: NextSample[], pos: PrepPos, rank: number, share: number): NextRank {
  const g = posGroup(pos), t = rankTier(pos, rank), b = gamesBand(share);
  const mine = samples.filter((s) => posGroup(s[0]) === g);
  const wide = t === 'deep' ? ['deep', 'mid'] : ['top', 'mid'];
  const tries: [string, (s: NextSample) => boolean][] = [
    [`${g} ${t}, ${b} season`, (s) => rankTier(s[0], s[1]) === t && gamesBand(s[2]) === b],
    [`${g} ${wide.join('+')}, ${b} season`, (s) => wide.includes(rankTier(s[0], s[1])) && gamesBand(s[2]) === b],
    [`${g}, ${b} season`, (s) => gamesBand(s[2]) === b],
    [`${g} ${t}`, (s) => rankTier(s[0], s[1]) === t],
    [g, () => true],
  ];
  for (const [from, test] of tries) {
    const near = mine.filter(test);
    if (near.length < MIN_CELL && from !== g) continue;
    if (!near.length) break;
    const ratios = near.map((s) => Math.min(s[3], RATIO_CAP) / s[1]).sort((x, y) => x - y);
    const q = (f: number) => ratios[Math.floor(f * (ratios.length - 1))]!;
    const at = (f: number) => Math.max(1, Math.round(rank * q(f)));
    return { mid: at(0.5), lo: at(0.25), hi: at(0.75), n: near.length, unpriced: round(near.filter((s) => s[3] >= NEXT_UNPRICED).length / near.length, 2), from };
  }
  return { mid: rank, lo: rank, hi: rank, n: 0, unpriced: 0, from: 'no history' };
}

export interface SeasonLine {
  name: string;
  pos: PrepPos;
  team: string;
  ppg: number | null; // points per game played this season
  games: number;
  share: number; // games played plus healthy games left, over SEASON_GAMES
  value: number | null; // latest trade value (average of the charts that list him)
}

export interface StandInRow { line: SeasonLine; today: number; ppgRank: number | null; valueRank: number | null; next: NextRank }

export function standInBoard(si: StandIn, lines: SeasonLine[]): { board: BoardRow[]; rows: Map<string, StandInRow> } {
  const board: BoardRow[] = [];
  const rows = new Map<string, StandInRow>();
  for (const pos of PREP_POS) {
    const list = lines.filter((l) => l.pos === pos && ((l.ppg !== null && l.games >= MIN_GAMES) || l.value !== null));
    const byPpg = list.filter((l) => l.ppg !== null && l.games >= MIN_GAMES).sort((a, b) => b.ppg! - a.ppg!);
    const byValue = list.filter((l) => l.value !== null).sort((a, b) => b.value! - a.value!);
    const ppgRank = new Map(byPpg.map((l, i) => [l, i + 1])), valueRank = new Map(byValue.map((l, i) => [l, i + 1]));
    const score = (l: SeasonLine) => {
      const p = ppgRank.get(l), v = valueRank.get(l);
      return p !== undefined && v !== undefined ? PROD_WEIGHT * p + (1 - PROD_WEIGHT) * v : p ?? v!;
    };
    const ordered = [...list].sort((a, b) => score(a) - score(b));
    const curve = si.curve[pos];
    ordered.forEach((l, i) => {
      const today = i + 1;
      const next = nextRank(si.samples, pos, today, l.share);
      const at = next.mid - 1;
      const price = curve.price[at] ?? 0;
      const proj = curve.proj[at] ?? curve.proj.at(-1) ?? null;
      board.push([l.name, pos, l.team, proj, price]);
      rows.set(playerKey(l.name, pos), { line: l, today, ppgRank: ppgRank.get(l) ?? null, valueRank: valueRank.get(l) ?? null, next });
    });
  }
  return { board, rows };
}

function round(v: number, d: number) {
  const m = 10 ** d;
  return Math.round(v * m) / m;
}
