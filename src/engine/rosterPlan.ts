// A draft plan: the 13 players Nic aims to end the auction with, under the league's auction rules
// (docs/rules/league-rules.md, Art. III-IV). Pure: the page keeps the picks, this places them in
// lineup slots and checks the money.
import type { PrepPos } from '../data/draftPrep.ts';

export interface PlanPick { key: string; name: string; pos: PrepPos; bid: number; keeper: boolean }
export interface Slot { id: string; label: string; takes: PrepPos[]; bench: boolean }

// Lineup first, then the bench: 3 reach starters and 3 at $1 (Nic, Nov 18). Bench labels are advice only.
export const SLOTS: Slot[] = [
  { id: 'QB', label: 'QB', takes: ['QB'], bench: false },
  { id: 'RB1', label: 'RB', takes: ['RB'], bench: false },
  { id: 'RB2', label: 'RB', takes: ['RB'], bench: false },
  { id: 'WR1', label: 'WR', takes: ['WR'], bench: false },
  { id: 'WR2', label: 'WR', takes: ['WR'], bench: false },
  { id: 'WRTE', label: 'WR/TE', takes: ['WR', 'TE'], bench: false },
  { id: 'FLEX', label: 'FLEX', takes: ['RB', 'WR', 'TE'], bench: false },
  ...[1, 2, 3].map((i) => ({ id: `R${i}`, label: 'Bench (reach)', takes: ['QB', 'RB', 'WR', 'TE'] as PrepPos[], bench: true })),
  ...[1, 2, 3].map((i) => ({ id: `D${i}`, label: 'Bench ($1)', takes: ['QB', 'RB', 'WR', 'TE'] as PrepPos[], bench: true })),
];
export const POS_MAX: Partial<Record<PrepPos, number>> = { QB: 4, RB: 5, WR: 8 }; // Art. III; no TE limit

export interface PlanState {
  placed: { slot: Slot; pick: PlanPick | null }[];
  extra: PlanPick[]; // more players than slots
  spent: number;
  left: number;
  open: number; // empty spots
  maxBid: number; // most he can bid on the next player: money left - $1 for each other open spot
  over: PrepPos[]; // positions past their limit
  problems: string[];
}

// Keepers first, then the priciest picks get the lineup slots their position fits best.
export function placePlan(picks: PlanPick[], budget = 200): PlanState {
  const order = [...picks].sort((a, b) => Number(b.keeper) - Number(a.keeper) || b.bid - a.bid);
  const placed = SLOTS.map((slot) => ({ slot, pick: null as PlanPick | null }));
  const extra: PlanPick[] = [];
  const firstFree = (p: PlanPick, bench: boolean) =>
    // tightest slot first: a WR takes WR before WR/TE before FLEX
    placed.filter((x) => !x.pick && x.slot.bench === bench && x.slot.takes.includes(p.pos)).sort((a, b) => a.slot.takes.length - b.slot.takes.length)[0];
  for (const p of order) {
    const at = firstFree(p, false) ?? firstFree(p, true);
    if (at) at.pick = p; else extra.push(p);
  }
  const spent = picks.reduce((s, p) => s + p.bid, 0);
  const left = budget - spent;
  const open = Math.max(0, SLOTS.length - picks.length);
  const maxBid = open ? left - (open - 1) : 0;
  const count = (pos: PrepPos) => picks.filter((p) => p.pos === pos).length;
  const over = (Object.keys(POS_MAX) as PrepPos[]).filter((pos) => count(pos) > POS_MAX[pos]!);
  const problems: string[] = [];
  if (left < open) problems.push(`$${left} left can't fill ${open} open spots at $1 each`);
  if (extra.length) problems.push(`No spot fits ${extra.map((p) => p.name).join(', ')}`);
  for (const pos of over) problems.push(`${count(pos)} ${pos}s, the limit is ${POS_MAX[pos]}`);
  const starters = placed.filter((x) => !x.slot.bench && !x.pick).map((x) => x.slot.label);
  if (!open && starters.length) problems.push(`no one for ${starters.join(', ')}`);
  return { placed, extra, spent, left, open, maxBid, over, problems };
}

// Art. IV: no bid on a player whose position is already at its limit. Art. III: the roster has to fill a
// lineup, so no player either who would leave no spot open that fits him (the last spot is the QB's).
export function posFull(picks: PlanPick[], pos: PrepPos): boolean {
  if (POS_MAX[pos] !== undefined && picks.filter((p) => p.pos === pos).length >= POS_MAX[pos]!) return true;
  const probe: PlanPick = { key: '\u0000probe', name: '', pos, bid: 0, keeper: false };
  return placePlan([...picks, probe]).extra.length > placePlan(picks).extra.length;
}

// The most one planned player's bid can be (Art. IV): the money left with his bid put back, less $1 for
// every other open spot. A new player is the same with no bid to put back.
export function maxBidFor(picks: PlanPick[], key: string | null, budget = 200): number {
  const others = picks.filter((p) => p.key !== key);
  const open = SLOTS.length - others.length; // includes his spot
  if (open <= 0) return 0;
  return Math.max(0, budget - others.reduce((s, p) => s + p.bid, 0) - (open - 1));
}
