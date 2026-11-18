// Draft prep: public/seed/draft-prep.json, built by `npm run data -- draftprep` from data/draft-prep/
// (pre-draft boards and keepers) plus the league's draft and lineup history. Design:
// docs/draft-prep/design.md. The file holds inputs and measured league numbers; prices and worth are
// worked out in the browser (src/engine/draftPrep.ts) so keeper switches and live data move them.
//
// Two kinds of edition:
//   board   - a real pre-draft board (FantasyPros projections and prices) and that draft's keepers.
//             2026 is the test run: last August's numbers, checked against the real 2026 auction.
//   standin - next year's board before any projections exist. The page fills it from this season's
//             production and trade values (standInBoard), so it moves with every weekly data push.
//             Once data/draft-prep/<year>/board.csv lands, that year becomes a board edition.

export const PREP_POS = ['QB', 'RB', 'WR', 'TE'] as const;
export type PrepPos = (typeof PREP_POS)[number];

// One price tier: players ranked within their position by consensus price, up to rank upTo.
export interface TierFit {
  upTo: number;
  label: string;
  factor: number; // what the league paid for this tier vs. its share of consensus price (1 = in line)
  n: number; // past auction buys behind the numbers
}

export interface PrepFit {
  marketYears: [number, number][]; // [season, weight] the tier factors were measured on
  tiers: Record<PrepPos, TierFit[]>;
  projYears: number[]; // seasons with real preseason projections, for shrink and projection error
  shrink: Record<PrepPos, number>; // points over replacement actually delivered per projected point
  miss: Record<PrepPos, number>; // average projection miss as a share of the projection
  flex: { years: number[]; flexRB: number; flexWR: number; flexTE: number; recWR: number; recTE: number }; // share of FLEX and WR/TE starts by position
  // Guardrail (Nic, Nov 18: nobody pays $133): by position, the [lowest, highest] price the league
  // paid for the k-th most expensive auctioned player, over slotYears. Index 0 = the priciest.
  slotYears: number[];
  slots: Record<PrepPos, [number, number][]>;
}

// [name, position, NFL team, projected season points (league scoring), consensus price ($200, 12 teams)]
export type BoardRow = [string, PrepPos, string, number | null, number];
// [name, position, keeper cost, owner key]
export type KeeperRow = [string, PrepPos, number, string];

// How a season's finish turned into next August's market rank, one row per player-season:
// [position, points-per-game rank that season (4+ games), share of the season's games played,
//  his rank by consensus price at his position the next August (NEXT_UNPRICED = not priced)].
export type NextSample = [PrepPos, number, number, number];
export const NEXT_UNPRICED = 99;

export interface StandIn {
  fromYear: number; // the season whose production fills the board
  curveYear: number; // the board whose prices and projections by position rank are reused
  curve: Record<PrepPos, { price: number[]; proj: number[] }>; // best first
  sampleYears: [number, number][]; // [season, the August it was priced in]
  samples: NextSample[];
}

export interface DraftPrep {
  year: number;
  kind: 'board' | 'standin';
  teams: number;
  budget: number;
  roster: number;
  source: string; // where the board came from
  fit: PrepFit;
  board: BoardRow[]; // empty for a stand-in until the page fills it
  keepers: KeeperRow[]; // empty for a stand-in: the page guesses them from the Keepers calls
  standIn?: StandIn;
}

export interface DraftPrepFile {
  version: 2;
  editions: DraftPrep[]; // oldest first
}

export const draftPrepUrl = (base: string) => `${base}seed/draft-prep.json`;

export function validateDraftPrep(raw: unknown): { ok: true; value: DraftPrepFile } | { ok: false; errors: string[] } {
  const f = raw as DraftPrepFile;
  if (!f || typeof f !== 'object' || f.version !== 2 || !Array.isArray(f.editions) || !f.editions.length) return { ok: false, errors: ['not a version 2 draft prep file'] };
  const errors: string[] = [];
  const pos = new Set<string>(PREP_POS);
  for (const d of f.editions) {
    const at = `${d.year} ${d.kind}`;
    if (!Array.isArray(d.board) || !Array.isArray(d.keepers) || !d.fit) { errors.push(`${at}: missing board, keepers or fit`); continue; }
    if (d.kind !== 'board' && d.kind !== 'standin') errors.push(`${at}: unknown kind`);
    if (d.kind === 'standin' && (!d.standIn || !Array.isArray(d.standIn.samples) || !d.standIn.curve)) errors.push(`${at}: missing stand-in curve or samples`);
    for (const r of d.board) {
      if (!Array.isArray(r) || r.length !== 5 || typeof r[0] !== 'string' || !pos.has(r[1]) || !(r[3] === null || Number.isFinite(r[3])) || !Number.isFinite(r[4])) { errors.push(`${at}: bad board row ${JSON.stringify(r).slice(0, 80)}`); break; }
    }
    for (const r of d.keepers) {
      if (!Array.isArray(r) || r.length !== 4 || typeof r[0] !== 'string' || !pos.has(r[1]) || !Number.isFinite(r[2])) { errors.push(`${at}: bad keeper row ${JSON.stringify(r).slice(0, 80)}`); break; }
    }
    for (const p of PREP_POS) {
      const t = d.fit.tiers?.[p];
      if (!Array.isArray(t) || !t.length || t.some((x) => !(x.factor > 0))) errors.push(`${at}: bad ${p} tiers`);
      if (!(d.fit.shrink?.[p] > 0) || !(d.fit.miss?.[p] > 0)) errors.push(`${at}: missing ${p} shrink or projection miss`);
      if (!Array.isArray(d.fit.slots?.[p])) errors.push(`${at}: missing ${p} price slots`);
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: f };
}
