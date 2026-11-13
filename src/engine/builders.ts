// Who builds the best roster (Nic, Nov 13). Four separate measures, never blended into one score:
// a manager who nails keepers but drafts badly is a different animal from the reverse, and that
// disagreement is the point. Each is a rate, not a total, so a 17-season lifer and a 6-season one
// compare honestly.
//
//   draft    dollars of hindsight value per draft, open-auction picks only (engine/drafts.ts)
//   keeper   the same dollars on kept players, but against what every OTHER keeper returned that
//            season. The keeper price is set by a rule, not an auction, so the whole field swings
//            with the year: a keeper was $14 underwater on average in 2022 and $6 up in 2018. The
//            raw dollars are kept as keeperAbs; only the relative figure is ranked.
//   scoring  points per game against the league average that season, averaged (history.ts index)
//
// Co-owned seasons credit both managers in full (Nic, Nov 13), so a co-owned draft appears in both
// careers. League-wide pick and dollar totals are therefore NOT the sum of these rows.
import { crew, type Career, type Hist } from './history.ts';
import type { OwnerKey } from '../data/history.ts';
import type { DraftBook } from './drafts.ts';

export interface BuilderCareer {
  owner: OwnerKey;
  name: string;
  seasons: number; // seasons played
  lifer: boolean;
  active: boolean;
  drafts: number; // seasons with a recorded draft
  picks: number; // open-auction picks judged
  draft: number | null; // dollars of value per draft, open picks
  draftTotal: number | null;
  keepers: number; // kept players judged
  keeper: number | null; // dollars per keeper against that season's keeper market (the ranked one)
  keeperAbs: number | null; // dollars per keeper, before the season is accounted for
  keeperTotal: number | null; // raw dollars, every keeper
  beat: number; // keepers that returned more than that season's keeper average
  beatRate: number | null;
  index: number; // average season scoring index, 1.00 = league average
}

const round = (n: number, d = 1) => { const m = 10 ** d; return Math.round(n * m) / m; };

// Whether a career carries enough of a measure to be ranked on it.
export const ranked = (b: BuilderCareer, metric: BuilderMetric, minDrafts = MIN_DRAFTS): boolean =>
  b[metric] !== null && b.drafts >= minDrafts && (metric !== 'keeper' || b.keepers >= MIN_KEEPERS);

export function builderCareers(H: Hist, book: DraftBook, cs: Career[]): BuilderCareer[] {
  // A pick's dollars go to everyone who ran that team that season, in full.
  const open = new Map<OwnerKey, { v: number; n: number; years: Set<number> }>();
  const kept = new Map<OwnerKey, { v: number; rel: number; n: number; beat: number; years: Set<number> }>();
  // That season's keeper market: the average value of every keeper kept that year.
  const pool = new Map<number, number[]>();
  for (const p of book.picks) if (p.keeper && p.value !== null) pool.set(p.year, [...(pool.get(p.year) ?? []), p.value]);
  const market = new Map([...pool].map(([y, vs]) => [y, vs.reduce((a, b) => a + b, 0) / vs.length]));
  for (const p of book.picks) {
    if (p.value === null) continue;
    for (const o of crew(H, p.owner, p.year)) {
      if (p.keeper) {
        const rel = p.value - (market.get(p.year) ?? 0);
        const e = kept.get(o) ?? { v: 0, rel: 0, n: 0, beat: 0, years: new Set<number>() };
        e.v += p.value; e.rel += rel; e.n += 1; if (rel > 0) e.beat += 1; e.years.add(p.year);
        kept.set(o, e);
      } else {
        const e = open.get(o) ?? { v: 0, n: 0, years: new Set<number>() };
        e.v += p.value; e.n += 1; e.years.add(p.year);
        open.set(o, e);
      }
    }
  }
  const out: BuilderCareer[] = [];
  for (const c of cs) {
    const o = open.get(c.owner), k = kept.get(c.owner);
    const drafts = new Set([...(o?.years ?? []), ...(k?.years ?? [])]).size;
    out.push({
      owner: c.owner, name: c.name, seasons: c.seasons.length, lifer: c.lifer, active: c.active,
      drafts, picks: o?.n ?? 0,
      draft: o && drafts ? round(o.v / drafts) : null,
      draftTotal: o ? round(o.v) : null,
      keepers: k?.n ?? 0,
      keeper: k ? round(k.rel / k.n) : null,
      keeperAbs: k ? round(k.v / k.n) : null,
      keeperTotal: k ? round(k.v) : null,
      beat: k?.beat ?? 0,
      beatRate: k ? k.beat / k.n : null,
      index: round(c.index, 3),
    });
  }
  return out;
}

export type BuilderMetric = 'draft' | 'keeper' | 'index';
// Least a career needs before it can top or bottom a measure, so one draft or one lucky keeper
// cannot win a column.
export const MIN_DRAFTS = 3;
export const MIN_KEEPERS = 3;
export const BUILDER_METRICS: { id: BuilderMetric; label: string; note: string }[] = [
  { id: 'draft', label: 'Draft', note: 'dollars of hindsight value per draft, open-auction picks' },
  { id: 'keeper', label: 'Keepers', note: 'dollars per keeper against what other keepers returned that year' },
  { id: 'index', label: 'Scoring', note: 'points per game against that season’s league average' },
];

// Best and worst at one measure, over careers with enough of it to judge (ranked, not blended).
export function bestAndWorstBuilders(bs: BuilderCareer[], metric: BuilderMetric, minDrafts = MIN_DRAFTS) {
  const ok = bs.filter((b) => ranked(b, metric, minDrafts));
  const sorted = [...ok].sort((a, b) => (b[metric] as number) - (a[metric] as number));
  return { best: sorted[0] ?? null, worst: sorted.length > 1 ? sorted.at(-1)! : null };
}
