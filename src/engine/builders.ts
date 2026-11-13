// Who builds the best roster (Nic, Nov 13). Four separate measures, never blended into one score:
// a manager who nails keepers but drafts badly is a different animal from the reverse, and that
// disagreement is the point. Each is a rate, not a total, so a 17-season lifer and a 6-season one
// compare honestly.
//
//   draft    dollars of hindsight value per draft, open-auction picks only (engine/drafts.ts)
//   keeper   the same dollars on kept players, per draft (engine/keeperSkill.ts covers the detail)
//   scoring  points per game against the league average that season, averaged (history.ts index)
//   capture  starter points as a share of everything his roster scored: how much of the talent he
//            assembled actually reached a lineup. Needs bench detail, so 2018 on only.
//
// Co-owned seasons credit both managers in full (Nic, Nov 13), so a co-owned draft appears in both
// careers. League-wide pick and dollar totals are therefore NOT the sum of these rows.
import { crew, type Career, type Hist } from './history.ts';
import type { OwnerKey } from '../data/history.ts';
import type { CareerBook } from './careers.ts';
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
  keeper: number | null; // dollars of value per draft, kept players
  keeperTotal: number | null;
  index: number; // average season scoring index, 1.00 = league average
  capture: number | null; // starter share of roster points, bench-detail seasons only
  captureYears: number;
}

const round = (n: number, d = 1) => { const m = 10 ** d; return Math.round(n * m) / m; };

// Whether a career carries enough of a measure to be ranked on it.
export function ranked(b: BuilderCareer, metric: BuilderMetric, minDrafts = MIN_DRAFTS): boolean {
  if (b[metric] === null) return false;
  return metric === 'capture' ? b.captureYears >= MIN_CAPTURE_YEARS : b.drafts >= minDrafts;
}

export function builderCareers(H: Hist, book: DraftBook, cs: Career[], cb: CareerBook): BuilderCareer[] {
  // A pick's dollars go to everyone who ran that team that season, in full.
  const open = new Map<OwnerKey, { v: number; n: number; years: Set<number> }>();
  const kept = new Map<OwnerKey, { v: number; n: number; years: Set<number> }>();
  for (const p of book.picks) {
    if (p.value === null) continue;
    const m = p.keeper ? kept : open;
    for (const o of crew(H, p.owner, p.year)) {
      const e = m.get(o) ?? { v: 0, n: 0, years: new Set<number>() };
      e.v += p.value; e.n += 1; e.years.add(p.year);
      m.set(o, e);
    }
  }
  // Starter points against everything the roster scored, only where the bench was recorded.
  const full = new Set(cb.full);
  const held = new Map<OwnerKey, { start: number; bench: number; years: Set<number> }>();
  for (const pl of cb.players)
    for (const s of pl.seasons) {
      if (!full.has(s.year) || s.benchPts === null) continue;
      for (const o of crew(H, s.owner, s.year)) {
        const e = held.get(o) ?? { start: 0, bench: 0, years: new Set<number>() };
        e.start += s.startPts; e.bench += s.benchPts; e.years.add(s.year);
        held.set(o, e);
      }
    }
  const out: BuilderCareer[] = [];
  for (const c of cs) {
    const o = open.get(c.owner), k = kept.get(c.owner), h = held.get(c.owner);
    const drafts = new Set([...(o?.years ?? []), ...(k?.years ?? [])]).size;
    const roster = h ? h.start + h.bench : 0;
    out.push({
      owner: c.owner, name: c.name, seasons: c.seasons.length, lifer: c.lifer, active: c.active,
      drafts, picks: o?.n ?? 0,
      draft: o && drafts ? round(o.v / drafts) : null,
      draftTotal: o ? round(o.v) : null,
      keepers: k?.n ?? 0,
      keeper: k && drafts ? round(k.v / drafts) : null,
      keeperTotal: k ? round(k.v) : null,
      index: round(c.index, 3),
      capture: h && roster > 0 ? round(h.start / roster, 4) : null,
      captureYears: h?.years.size ?? 0,
    });
  }
  return out;
}

export type BuilderMetric = 'draft' | 'keeper' | 'index' | 'capture';
// Least a career needs before it can top or bottom a measure. Bench detail starts in 2018, so
// capture counts its own seasons: without this a single 2018 roster wins the column outright.
export const MIN_DRAFTS = 3;
export const MIN_CAPTURE_YEARS = 5;
export const BUILDER_METRICS: { id: BuilderMetric; label: string; note: string }[] = [
  { id: 'draft', label: 'Draft', note: 'dollars of hindsight value per draft, open-auction picks' },
  { id: 'keeper', label: 'Keepers', note: 'the same dollars on players he kept' },
  { id: 'index', label: 'Scoring', note: 'points per game against that season’s league average' },
  { id: 'capture', label: 'Capture', note: 'share of his roster’s points that came from a starter (2018 on)' },
];

// Best and worst at one measure, over careers with enough of it to judge (ranked, not blended).
export function bestAndWorstBuilders(bs: BuilderCareer[], metric: BuilderMetric, minDrafts = MIN_DRAFTS) {
  const ok = bs.filter((b) => ranked(b, metric, minDrafts));
  const sorted = [...ok].sort((a, b) => (b[metric] as number) - (a[metric] as number));
  return { best: sorted[0] ?? null, worst: sorted.length > 1 ? sorted.at(-1)! : null };
}
