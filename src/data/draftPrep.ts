// Draft prep: public/seed/draft-prep.json, built from data/draft-prep/<year>/ (the pre-draft board and
// the keepers) plus the league's draft and lineup history by `npm run data -- draftprep <year>`.
// The file holds inputs and the measured league numbers (fit); prices and worth are worked out in the
// browser (src/engine/draftPrep.ts) so keeper switches and settings can change them live.
// Design: docs/draft-prep/design.md.

export const PREP_POS = ['QB', 'RB', 'WR', 'TE'] as const;
export type PrepPos = (typeof PREP_POS)[number];

// One price tier: players ranked within their position by consensus price, up to rank upTo.
export interface TierFit {
  upTo: number;
  label: string;
  factor: number; // what the league paid for this tier vs. its share of consensus price (1 = in line)
  lo: number; // bid floor as a share of the expected price (20th percentile of past prices)
  hi: number; // bid ceiling as a share of the expected price (80th percentile)
  n: number; // past auction buys behind the numbers
}

export interface PrepFit {
  marketYears: [number, number][]; // [season, weight] the tier factors were measured on
  tiers: Record<PrepPos, TierFit[]>;
  projYears: number[]; // seasons with real preseason projections, for shrink and projection error
  shrink: Record<PrepPos, number>; // points over replacement actually delivered per projected point
  miss: Record<PrepPos, number>; // average projection miss as a share of the projection
  flex: { years: number[]; flexRB: number; flexWR: number; flexTE: number; recWR: number; recTE: number }; // share of FLEX and WR/TE starts by position
}

// [name, position, NFL team, projected season points (league scoring), consensus price ($200, 12 teams)]
export type BoardRow = [string, PrepPos, string, number | null, number];
// [name, position, keeper cost, owner key]
export type KeeperRow = [string, PrepPos, number, string];

export interface DraftPrep {
  version: 1;
  year: number;
  teams: number;
  budget: number;
  roster: number;
  source: string; // where the board came from
  fit: PrepFit;
  board: BoardRow[];
  keepers: KeeperRow[];
}

export const draftPrepUrl = (base: string) => `${base}seed/draft-prep.json`;

export function validateDraftPrep(raw: unknown): { ok: true; value: DraftPrep } | { ok: false; errors: string[] } {
  const d = raw as DraftPrep;
  if (!d || typeof d !== 'object' || d.version !== 1) return { ok: false, errors: ['not a version 1 draft prep file'] };
  const errors: string[] = [];
  if (!Array.isArray(d.board) || !Array.isArray(d.keepers) || !d.fit) return { ok: false, errors: ['missing board, keepers or fit'] };
  const pos = new Set<string>(PREP_POS);
  for (const r of d.board) {
    if (!Array.isArray(r) || r.length !== 5 || typeof r[0] !== 'string' || !pos.has(r[1]) || !(r[3] === null || Number.isFinite(r[3])) || !Number.isFinite(r[4])) { errors.push(`bad board row ${JSON.stringify(r).slice(0, 80)}`); break; }
  }
  for (const r of d.keepers) {
    if (!Array.isArray(r) || r.length !== 4 || typeof r[0] !== 'string' || !pos.has(r[1]) || !Number.isFinite(r[2])) { errors.push(`bad keeper row ${JSON.stringify(r).slice(0, 80)}`); break; }
  }
  for (const p of PREP_POS) {
    const t = d.fit.tiers?.[p];
    if (!Array.isArray(t) || !t.length || t.some((x) => !(x.factor > 0) || !(x.lo > 0) || !(x.hi >= x.lo))) errors.push(`bad ${p} tiers`);
    if (!(d.fit.shrink?.[p] > 0) || !(d.fit.miss?.[p] > 0)) errors.push(`missing ${p} shrink or projection miss`);
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: d };
}
