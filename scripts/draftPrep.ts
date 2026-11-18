// Builds public/seed/draft-prep.json from data/draft-prep/<year>/ (see docs/data-updates.md, "Draft
// prep"): board.csv (name,team,pos,proj,price) and keepers.csv (name,pos,cost,owner), plus the league
// numbers measured from the built draft and lineup history (public/seed/drafts.json and lineups/).
// Throws with every problem found, so nothing is written from bad input.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { playerKey, validateDrafts, type Drafts } from '../src/data/drafts.ts';
import { PREP_POS, type BoardRow, type DraftPrep, type KeeperRow, type PrepPos } from '../src/data/draftPrep.ts';
import type { Lineups } from '../src/data/lineups.ts';
import { FLEX_YEARS, MARKET_YEARS_BACK, fitFlex, fitMarket, fitProjections, fitSlots, type PastBoard } from '../src/engine/draftPrep.ts';
import { parseCsv } from './updates.ts';

const TEAMS = 12, BUDGET = 200, ROSTER = 13; // docs/rules/league-rules.md, Art. II and IV

const table = (path: string): Record<string, string>[] => {
  const [head, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  return rows.map((r) => Object.fromEntries(head!.map((h, i) => [h.trim().toLowerCase(), (r[i] ?? '').trim()])));
};
const isPos = (p: string): p is PrepPos => (PREP_POS as readonly string[]).includes(p);

function readBoard(path: string, errors: string[]): (BoardRow & { rank?: number })[] {
  const out: (BoardRow & { rank?: number })[] = [];
  for (const [i, r] of table(path).entries()) {
    const proj = !r.proj ? null : Number(r.proj), price = !r.price ? 0 : Number(r.price), rank = r.rank ? Number(r.rank) : undefined;
    if (!r.name || !isPos(r.pos ?? '') || (proj !== null && !Number.isFinite(proj)) || !Number.isFinite(price) || price < 0) { errors.push(`${path} row ${i + 2}: ${JSON.stringify(r)}`); continue; }
    const row = [r.name, r.pos as PrepPos, r.team ?? '', proj, price] as BoardRow & { rank?: number };
    if (rank !== undefined) row.rank = rank;
    out.push(row);
  }
  return out;
}

export function buildDraftPrep(year: number, dir = 'data/draft-prep', seed = 'public/seed'): { prep: DraftPrep; report: { board: number; priced: number; keepers: number; keepersNotOnBoard: string[] } } {
  const errors: string[] = [];
  const folder = join(dir, String(year));
  if (!existsSync(join(folder, 'board.csv'))) throw new Error(`${folder}/board.csv not found`);
  const board: BoardRow[] = readBoard(join(folder, 'board.csv'), errors).map((r) => [r[0], r[1], r[2], r[3], r[4]]);
  // Past boards (same consensus source), for the price tiers. A rank column overrides the computed rank
  // (the 2025 board lists auctioned players only, so its ranks come from Nic's full board).
  const past: PastBoard[] = [];
  for (let y = year - MARKET_YEARS_BACK; y < year; y++) {
    const f = join(dir, String(y), 'board.csv');
    if (existsSync(f)) past.push({ year: y, rows: readBoard(f, errors).map((r) => ({ name: r[0], pos: r[1], price: r[4], rank: r.rank ?? null })) });
  }
  const keepers: KeeperRow[] = [];
  if (existsSync(join(folder, 'keepers.csv'))) {
    for (const [i, r] of table(join(folder, 'keepers.csv')).entries()) {
      const cost = Number(r.cost);
      if (!r.name || !isPos(r.pos ?? '') || !Number.isFinite(cost) || cost < 0) { errors.push(`keepers.csv row ${i + 2}: ${JSON.stringify(r)}`); continue; }
      keepers.push([r.name, r.pos as PrepPos, cost, r.owner ?? '']);
    }
  }
  const dv = validateDrafts(JSON.parse(readFileSync(join(seed, 'drafts.json'), 'utf8')));
  if (!dv.ok) errors.push(...dv.errors.map((e) => `drafts.json: ${e}`));
  if (errors.length) throw new Error(`draft prep input problems:\n- ${errors.join('\n- ')}`);
  const drafts = (dv as { value: Drafts }).value;

  const starts = new Map<string, { slot: string; pos: string; n: number }>();
  for (const y of FLEX_YEARS) {
    const L = JSON.parse(readFileSync(join(seed, 'lineups', `${y}.json`), 'utf8')) as Lineups;
    for (const week of Object.values(L.weeks)) for (const team of Object.values(week)) for (const [p, slot] of team.s) {
      if (p < 0 || !slot) continue;
      const pos = L.players[p]![1], k = `${slot}|${pos}`;
      const s = starts.get(k) ?? { slot, pos, n: 0 };
      s.n++;
      starts.set(k, s);
    }
  }
  const prep: DraftPrep = {
    version: 1, year, teams: TEAMS, budget: BUDGET, roster: ROSTER,
    source: `${folder}/board.csv`,
    fit: { ...fitMarket(drafts, year, past), ...fitProjections(drafts), flex: fitFlex([...starts.values()], FLEX_YEARS), ...fitSlots(drafts, year) },
    board, keepers,
  };
  const names = new Set(board.map((b) => playerKey(b[0], b[1])));
  return { prep, report: { board: board.length, priced: board.filter((b) => b[4] > 0).length, keepers: keepers.length, keepersNotOnBoard: keepers.filter((k) => !names.has(playerKey(k[0], k[1]))).map((k) => k[0]) } };
}

export const formatDraftPrep = (p: DraftPrep) =>
  `{"version":1,"year":${p.year},"teams":${p.teams},"budget":${p.budget},"roster":${p.roster},"source":${JSON.stringify(p.source)},\n"fit":${JSON.stringify(p.fit)},\n"keepers":[\n${p.keepers.map((k) => JSON.stringify(k)).join(',\n')}\n],\n"board":[\n${p.board.map((b) => JSON.stringify(b)).join(',\n')}\n]}\n`;
