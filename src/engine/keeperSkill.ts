// Who picks the right keepers (Nov 12, item 3). Every kept player in every auction since 2011 is a
// bet: the price he was kept at against what he went on to be worth that season.
//
// Value uses the Drafts page's hindsight worth (engine/drafts.ts): the season's going rate in
// dollars per point over replacement, so $1 + points over replacement x rate, minus the price paid.
// Points gained is the same points over replacement, in points: what the keeper produced above a
// startable player at his position that season. A keeper who finished below replacement counts 0
// there, and his price is the whole loss on the value side.
import type { OwnerKey } from '../data/history.ts';
import type { DraftBook, DraftPick } from './drafts.ts';

export interface KeeperBet {
  pick: DraftPick;
  year: number;
  owner: OwnerKey;
  name: string;
  pos: string;
  price: number;
  worth: number | null;
  value: number | null; // worth - price
  par: number | null; // season points over replacement
  hit: boolean; // worth more than he cost
}

export interface KeeperCareer {
  owner: OwnerKey;
  keepers: number;
  scored: number; // keepers with a season to judge
  spend: number; // dollars committed to keepers
  value: number | null; // dollars gained, worth minus price
  valuePer: number | null; // per keeper
  par: number | null; // points over replacement gained
  parPer: number | null;
  hits: number;
  misses: number;
  hitRate: number | null;
  best: KeeperBet | null;
  worst: KeeperBet | null;
  years: number[];
  bets: KeeperBet[];
}

const round = (n: number, d = 1) => { const m = 10 ** d; return Math.round(n * m) / m; };

export function keeperBets(book: DraftBook): KeeperBet[] {
  const out: KeeperBet[] = [];
  for (const p of book.picks) {
    if (!p.keeper) continue;
    const b = book.basis.get(p.year);
    const par = p.pts === null || !b ? null : Math.max(0, p.pts - (b.repl[p.pos] ?? 0));
    out.push({ pick: p, year: p.year, owner: p.owner, name: p.name, pos: p.pos, price: p.price, worth: p.worth, value: p.value, par: par === null ? null : round(par), hit: (p.value ?? 0) > 0 });
  }
  return out;
}

export function keeperCareers(bets: KeeperBet[]): KeeperCareer[] {
  const by = new Map<OwnerKey, KeeperBet[]>();
  for (const b of bets) by.set(b.owner, [...(by.get(b.owner) ?? []), b]);
  const out: KeeperCareer[] = [];
  for (const [owner, bs] of by) {
    const scored = bs.filter((b) => b.value !== null);
    const value = scored.length ? scored.reduce((a, b) => a + b.value!, 0) : null;
    const withPar = bs.filter((b) => b.par !== null);
    const par = withPar.length ? withPar.reduce((a, b) => a + b.par!, 0) : null;
    const sorted = [...scored].sort((a, b) => b.value! - a.value!);
    out.push({
      owner, keepers: bs.length, scored: scored.length,
      spend: bs.reduce((a, b) => a + b.price, 0),
      value: value === null ? null : round(value),
      valuePer: value === null ? null : round(value / scored.length),
      par: par === null ? null : round(par),
      parPer: par === null ? null : round(par / withPar.length),
      hits: scored.filter((b) => b.hit).length,
      misses: scored.filter((b) => !b.hit).length,
      hitRate: scored.length ? scored.filter((b) => b.hit).length / scored.length : null,
      best: sorted[0] ?? null, worst: sorted.length > 1 ? sorted.at(-1)! : null,
      years: [...new Set(bs.map((b) => b.year))].sort((a, b) => a - b),
      bets: [...bs].sort((a, b) => b.year - a.year || (b.value ?? -999) - (a.value ?? -999)),
    });
  }
  return out.sort((a, b) => (b.value ?? -1e9) - (a.value ?? -1e9));
}

export type KeeperMetric = 'value' | 'valuePer' | 'par' | 'parPer' | 'hitRate';
export function bestAndWorstKeepers(cs: KeeperCareer[], metric: KeeperMetric, min = 3): { best: KeeperCareer | null; worst: KeeperCareer | null } {
  const ok = cs.filter((c) => c.scored >= min && c[metric] !== null);
  const sorted = [...ok].sort((a, b) => (b[metric] as number) - (a[metric] as number));
  return { best: sorted[0] ?? null, worst: sorted.length > 1 ? sorted.at(-1)! : null };
}
