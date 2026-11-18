// Trade history, 2018 to last season: public/seed/trades.json, built from the trade exports in
// data/history/trades/ by `npm run data -- trades`. Grades are worked out at build time
// (src/engine/tradeHistory.ts) because every input is a finished season. The live season's trades
// stay on the Tracker page.
import type { OwnerKey } from './history.ts';

export interface TradePlayerLine {
  p: number; // index into players
  ptsWk: number | null; // points per week after the trade (0 for weeks off every roster)
  projWk: number | null; // projected points per week after the trade
  starts: number; // weeks the receiving team started him
  weeks: number; // weeks counted
}

export interface KeeperLine { p: number; owner: OwnerKey; price: number; value: number | null; year: number }

// The five parts of a grade (src/engine/tradeHistory.ts has the weights).
export type TradePart = 'deal' | 'wins' | 'points' | 'keep' | 'next';

export interface TradeSide {
  owner: OwnerKey; // team key in history.json
  gets: TradePlayerLine[];
  faab: number; // budget dollars received minus sent (Sleeper 2025)
  grade: string | null; // null: nothing to grade (budget only)
  initGrade: string | null; // at the trade: the deal part alone
  score: number | null; // -1..1, 0 = even
  path: string[]; // grade after each week, index 0 = at the trade
  parts: Record<TradePart, number> | null; // each part scaled to -1..1
  deal: number | null; // $ at the trade, got minus gave: projected rest of season plus keeper rights
  winsGain: number | null; // wins the trade gained (+3 a playoff spot, +1 a bye)
  ptsGain: number | null; // points for gained for the rest of the season (best lineup with the trade minus without)
  next: number | null; // next season's wins (+3 playoffs, +1 bye) with this side's keepers from the trade vs without
  prod: number | null; // points per week above replacement, got minus gave
  projGain: number | null; // projected points per week above replacement, got minus gave
  keep: number; // keeper $: kept players' value (year 2 at 60%) minus keeper rights given up; 0 until those seasons are over
  keepFinal: boolean; // false: a keeper season is still being played, so it is shown but not graded
  kept: KeeperLine[]; // players from this trade this side kept in the next two seasons
  rights: KeeperLine[]; // keeper rights this side gave up: players it traded away worth more than their keeper price
  record: { w: number; l: number; t: number; seed: number; playoffs: boolean };
  alt: { w: number; l: number; t: number; seed: number; playoffs: boolean }; // with the trade undone
  finish: number | null;
}

export interface HistTrade {
  id: string;
  year: number;
  week: number; // week logged (ESPN) or processed (Sleeper)
  eff: number; // first week the new teams used the players
  source: 'ESPN' | 'Sleeper';
  confidence: 'confirmed' | 'likely'; // likely = found from weekly rosters, no ESPN trade record
  date: string | null;
  sides: [TradeSide, TradeSide];
  dropped: [OwnerKey, number][]; // players released by a side as part of the trade
}

export interface Trades {
  version: 1;
  players: [string, string][]; // [name, position]
  scales: Record<TradePart, number> & { total: number }; // the size that counts as a full part (deal and keep in $); total: the weighted sum that grades A
  trades: HistTrade[];
}

export const tradesUrl = (base: string) => `${base}seed/trades.json`;

export function validateTrades(raw: unknown): { ok: true; value: Trades } | { ok: false; errors: string[] } {
  const d = raw as Trades;
  if (!d || typeof d !== 'object' || d.version !== 1 || !Array.isArray(d.players) || !Array.isArray(d.trades)) return { ok: false, errors: ['not a version 1 trades file'] };
  for (const t of d.trades) {
    if (!t.id || !Number.isInteger(t.year) || !Array.isArray(t.sides) || t.sides.length !== 2) return { ok: false, errors: [`bad trade ${JSON.stringify(t).slice(0, 80)}`] };
    for (const s of t.sides) for (const g of s.gets) if (!(g.p >= 0 && g.p < d.players.length)) return { ok: false, errors: [`trade ${t.id}: bad player index`] };
  }
  return { ok: true, value: d };
}
