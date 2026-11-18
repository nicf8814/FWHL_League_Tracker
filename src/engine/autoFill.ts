// Auto-fill for the draft plan (roster builder part B). Fills only the empty spots: keepers, locked and
// already planned players stay. The lineup's empty starter spots are filled with the best combination
// the money allows (an exact search over spots and dollars, not one star at a time), then the bench:
// the reach spots with the best players left that the money allows, the $1 spots with the best $1
// players. Every pick is priced at his expected cost and the max-bid rule holds throughout.
import type { PrepPos } from '../data/draftPrep.ts';
import type { PrepRow } from './draftPrep.ts';
import { placePlan, type PlanPick } from './rosterPlan.ts';

export type Strategy = 'points' | 'stars' | 'balanced' | 'title' | 'bargain';
export const STRATEGIES: { id: Strategy; label: string; help: string }[] = [
  { id: 'points', label: 'Most points', help: 'The most projected points over replacement in the lineup for the money' },
  { id: 'stars', label: 'Stars & scrubs', help: 'Starters at $35+ or $5 and under, nothing in between' },
  { id: 'balanced', label: 'Balanced', help: 'Nobody over $50; the money spread across the lineup' },
  { id: 'title', label: 'Title shot', help: 'Leans hard to the top of each position: a bigger weekly ceiling over a deeper roster' },
  { id: 'bargain', label: 'Best value', help: 'Only players at least $5 under their worth, the most points among them' },
];
export const REACH_RESERVE = 15; // shortcut: $ kept back for the 3 reach bench spots, a guess; make it a setting with part C

const price = (r: PrepRow) => Math.max(1, Math.round(r.cost));
const allowed: Record<Strategy, (r: PrepRow) => boolean> = {
  points: () => true,
  stars: (r) => price(r) >= 35 || price(r) <= 5,
  balanced: (r) => price(r) <= 50,
  title: () => true,
  bargain: (r) => r.edge >= 5,
};
const score: Record<Strategy, (r: PrepRow) => number> = {
  points: (r) => Math.max(0, r.vorp ?? 0),
  stars: (r) => Math.max(0, r.vorp ?? 0),
  balanced: (r) => Math.max(0, r.vorp ?? 0),
  title: (r) => Math.max(0, r.vorp ?? 0) ** 2,
  bargain: (r) => Math.max(0, r.vorp ?? 0),
};

const POOL = 40;
const BENCH_CAP = { QB: 2, TE: 2 }; // bench depth goes to RB/WR once there are two QBs or two TEs // best candidates per position the search considers

export function autoFill(rows: PrepRow[], picks: PlanPick[], strategy: Strategy, avoid: Set<string>, keyOf: (r: PrepRow) => string, budget = 200): PlanPick[] {
  const have = new Set(picks.map((p) => p.key));
  const state = placePlan(picks, budget);
  const emptyStarters = state.placed.filter((x) => !x.pick && !x.slot.bench).map((x) => x.slot.id);
  const benchOpen = state.placed.filter((x) => !x.pick && x.slot.bench).length;
  const cand = rows.filter((r) => !r.keeper && r.bought === null && !have.has(keyOf(r)) && !avoid.has(keyOf(r)) && (r.vorp ?? 0) > 0 && allowed[strategy](r));
  const reserve = Math.min(REACH_RESERVE, Math.max(0, state.left - state.open)) * Math.min(1, benchOpen / 3);
  const starterMoney = Math.max(0, Math.floor(state.left - benchOpen - reserve));
  const chosen = bestLineup(cand, emptyStarters, starterMoney, score[strategy]);
  const out = [...picks, ...chosen.map((r) => ({ key: keyOf(r), name: r.name, pos: r.pos, bid: price(r), keeper: false }))];

  // Bench: reach spots first (best points the money allows), then the $1 spots (the best projections
  // that go for $1, starters or not).
  const taken = new Set(out.map((p) => p.key));
  const rest = rows.filter((r) => !r.keeper && r.bought === null && !taken.has(keyOf(r)) && !avoid.has(keyOf(r)) && r.proj !== null).sort((a, b) => (b.vorp ?? -1e9) - (a.vorp ?? -1e9) || b.proj! - a.proj!);
  for (const r of rest) {
    const now = placePlan(out, budget);
    if (!now.open) break;
    if ((r.pos === 'QB' || r.pos === 'TE') && out.filter((x) => x.pos === r.pos).length >= BENCH_CAP[r.pos]) continue;
    const p: PlanPick = { key: keyOf(r), name: r.name, pos: r.pos, bid: price(r), keeper: false };
    const maxBid = now.left - (now.open - 1);
    const reachLeft = now.placed.some((x) => !x.pick && x.slot.id.startsWith('R'));
    if (p.bid > maxBid || (!reachLeft && p.bid > 1)) continue;
    const after = placePlan([...out, p], budget);
    if (after.extra.length || after.over.length) continue;
    out.push(p);
  }
  return out;
}

// Best set of players for the empty lineup spots within the money: exact search over how many of each
// spot are filled and dollars spent, taking candidates one at a time (each fills one spot or none).
export function bestLineup(cand: PrepRow[], empty: string[], money: number, value: (r: PrepRow) => number): PrepRow[] {
  const need = { QB: 0, RB: 0, WR: 0, WRTE: 0, FLEX: 0 };
  for (const id of empty) need[id === 'RB1' || id === 'RB2' ? 'RB' : id === 'WR1' || id === 'WR2' ? 'WR' : (id as keyof typeof need)]++;
  const kinds = ['QB', 'RB', 'WR', 'WRTE', 'FLEX'] as const;
  const fits: Record<PrepPos, (typeof kinds)[number][]> = { QB: ['QB'], RB: ['RB', 'FLEX'], WR: ['WR', 'WRTE', 'FLEX'], TE: ['WRTE', 'FLEX'] };
  const dims = kinds.map((k) => need[k] + 1);
  const states = dims.reduce((a, b) => a * b, 1) * (money + 1);
  if (!empty.length || money < 1) return [];
  const items = (['QB', 'RB', 'WR', 'TE'] as PrepPos[]).flatMap((pos) => cand.filter((r) => r.pos === pos && fits[pos].some((k) => need[k] > 0)).sort((a, b) => value(b) - value(a)).slice(0, POOL));
  const enc = (c: number[], m: number) => { let s = 0; for (let i = 0; i < kinds.length; i++) s = s * dims[i]! + c[i]!; return s * (money + 1) + m; };
  const dec = (s: number) => { const m = s % (money + 1); let rest = Math.floor(s / (money + 1)); const c = new Array<number>(kinds.length); for (let i = kinds.length - 1; i >= 0; i--) { c[i] = rest % dims[i]!; rest = Math.floor(rest / dims[i]!); } return { c, m }; };
  let best = new Float64Array(states).fill(-Infinity);
  best[0] = 0;
  const took: Int8Array[] = []; // per item: which spot kind it filled in the best path to each state (-1 none)
  for (const r of items) {
    const next = Float64Array.from(best), how = new Int8Array(states).fill(-1);
    const cost = Math.max(1, Math.round(r.cost)), v = value(r);
    for (let s = 0; s < states; s++) {
      if (best[s] === -Infinity) continue;
      const { c, m } = dec(s);
      if (m + cost > money) continue;
      for (const k of fits[r.pos]) {
        const i = kinds.indexOf(k);
        if (c[i]! >= need[k]) continue;
        const c2 = [...c]; c2[i]!++;
        const t = enc(c2, m + cost);
        if (best[s]! + v > next[t]!) { next[t] = best[s]! + v; how[t] = i; }
      }
    }
    best = next; took.push(how);
  }
  // Best end state: as many spots filled as possible, then the highest value.
  let end = -1, endFill = -1;
  for (let s = 0; s < states; s++) {
    if (best[s] === -Infinity) continue;
    const filled = dec(s).c.reduce((a, b) => a + b, 0);
    if (filled > endFill || (filled === endFill && best[s]! > best[end]!)) { end = s; endFill = filled; }
  }
  const out: PrepRow[] = [];
  for (let j = items.length - 1; j >= 0 && end >= 0; j--) {
    const i = took[j]![end]!;
    if (i < 0) continue;
    const r = items[j]!, { c, m } = dec(end);
    c[i]!--;
    out.push(r);
    end = enc(c, m - Math.max(1, Math.round(r.cost)));
  }
  return out;
}

