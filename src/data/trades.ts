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

export interface KeeperLine { p: number; owner: OwnerKey; price: number; value: number | null }

export interface TradeSide {
  owner: OwnerKey; // team key in history.json
  gets: TradePlayerLine[];
  faab: number; // budget dollars received minus sent (Sleeper 2025)
  grade: string | null; // null: nothing to grade (budget only)
  initGrade: string | null; // at the trade, from projections
  score: number | null; // -1..1, 0 = even
  path: string[]; // grade after each week, index 0 = at the trade
  prod: number | null; // points per week above replacement, got minus gave
  projGain: number | null; // projected points per week above replacement, got minus gave
  keep: number; // next season's keeper value, kept by this side minus kept by the partner ($)
  kept: KeeperLine[]; // players from this trade that this side kept the next season
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
