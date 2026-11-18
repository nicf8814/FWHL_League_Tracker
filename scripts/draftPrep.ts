// Builds public/seed/draft-prep.json (see docs/data-updates.md, "Draft prep"):
//   - a board edition for every data/draft-prep/<year>/ with a board.csv (name,team,pos,proj,price)
//     and keepers.csv (name,pos,cost,owner);
//   - a stand-in edition for the year after the newest board, filled live by the page;
//   - the league numbers measured from the built draft and lineup history (public/seed/drafts.json
//     and lineups/).
// Throws with every problem found, so nothing is written from bad input.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { playerKey, validateDrafts, type Drafts } from '../src/data/drafts.ts';
import { NEXT_UNPRICED, PREP_POS, type BoardRow, type DraftPrep, type DraftPrepFile, type KeeperRow, type NextSample, type PrepFit, type PrepPos, type StandIn } from '../src/data/draftPrep.ts';
import type { Lineups } from '../src/data/lineups.ts';
import { FLEX_YEARS, MARKET_YEARS_BACK, MIN_GAMES, fitFlex, fitMarket, fitProjections, fitSlots, ranks, type PastBoard } from '../src/engine/draftPrep.ts';
import { parseCsv } from './updates.ts';

const TEAMS = 12, BUDGET = 200, ROSTER = 13; // docs/rules/league-rules.md, Art. II and IV
const FIRST_SAMPLE_YEAR = 2018; // weekly lineups with bench and IR start in 2018
const SAMPLE_RANKS: Record<PrepPos, number> = { QB: 30, RB: 60, WR: 72, TE: 30 }; // deepest season rank sampled

type Row = BoardRow & { rank?: number };
const table = (path: string): Record<string, string>[] => {
  const [head, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  return rows.map((r) => Object.fromEntries(head!.map((h, i) => [h.trim().toLowerCase(), (r[i] ?? '').trim()])));
};
const isPos = (p: string): p is PrepPos => (PREP_POS as readonly string[]).includes(p);

function readBoard(path: string, errors: string[]): Row[] {
  const out: Row[] = [];
  for (const [i, r] of table(path).entries()) {
    const proj = !r.proj ? null : Number(r.proj), price = !r.price ? 0 : Number(r.price), rank = r.rank ? Number(r.rank) : undefined;
    if (!r.name || !isPos(r.pos ?? '') || (proj !== null && !Number.isFinite(proj)) || !Number.isFinite(price) || price < 0) { errors.push(`${path} row ${i + 2}: ${JSON.stringify(r)}`); continue; }
    const row = [r.name, r.pos as PrepPos, r.team ?? '', proj, price] as Row;
    if (rank !== undefined) row.rank = rank;
    out.push(row);
  }
  return out;
}

function readKeepers(path: string, errors: string[]): KeeperRow[] {
  if (!existsSync(path)) return [];
  const out: KeeperRow[] = [];
  for (const [i, r] of table(path).entries()) {
    const cost = Number(r.cost);
    if (!r.name || !isPos(r.pos ?? '') || !Number.isFinite(cost) || cost < 0) { errors.push(`${path} row ${i + 2}: ${JSON.stringify(r)}`); continue; }
    out.push([r.name, r.pos as PrepPos, cost, r.owner ?? '']);
  }
  return out;
}

// [position, ppg rank, games share, next August's price rank] for every player-season with a market
// rank the next August: a full board (no rank column) when there is one, else that draft's prices of
// reference (ESPN average auction value or the Sleeper export's estimate, keepers included).
function nextSamples(drafts: Drafts, lineups: Map<number, Lineups>, boards: Map<number, Row[]>, before: number): { years: [number, number][]; samples: NextSample[] } {
  const years: [number, number][] = [], samples: NextSample[] = [];
  for (let y = FIRST_SAMPLE_YEAR; y + 1 < before; y++) {
    const L = lineups.get(y);
    if (!L) continue;
    const market = new Map<string, number>();
    const board = boards.get(y + 1);
    if (board && !board.some((r) => r.rank !== undefined)) {
      for (const pos of PREP_POS) {
        const list = board.filter((r) => r[1] === pos && r[4] > 0);
        const r = ranks(list.map((x) => x[4]));
        list.forEach((x, i) => market.set(playerKey(x[0], pos), r[i]!));
      }
    } else {
      for (const pos of PREP_POS) {
        const list = drafts.picks.filter((p) => p[0] === y + 1 && drafts.players[p[1]]![1] === pos && (p[5] ?? 0) > 0);
        const r = ranks(list.map((p) => p[5]!));
        list.forEach((p, i) => market.set(playerKey(drafts.players[p[1]]![0], pos), r[i]!));
      }
    }
    if (market.size < 100) continue; // no usable market that August (2017 and 2019 have no average values)
    const weeks = Object.keys(L.weeks).length;
    const games = new Map<number, number>(), pts = new Map<number, number>();
    for (const week of Object.values(L.weeks)) for (const team of Object.values(week)) for (const [p, slot, points] of [...team.s, ...team.b]) {
      if (p < 0 || slot === 'IR' || !points || points <= 0) continue;
      games.set(p, (games.get(p) ?? 0) + 1);
      pts.set(p, (pts.get(p) ?? 0) + points);
    }
    for (const pos of PREP_POS) {
      const list = [...games].filter(([p, g]) => L.players[p]![1] === pos && g >= MIN_GAMES).map(([p, g]) => ({ p, g, ppg: pts.get(p)! / g })).sort((a, b) => b.ppg - a.ppg).slice(0, SAMPLE_RANKS[pos]);
      list.forEach((x, i) => samples.push([pos, i + 1, Math.round(Math.min(1, x.g / weeks) * 100) / 100, market.get(playerKey(L.players[x.p]![0], pos)) ?? NEXT_UNPRICED]));
    }
    years.push([y, y + 1]);
  }
  return { years, samples };
}

export interface DraftPrepReport { editions: string[]; keepersNotOnBoard: string[]; samples: number }

export function buildDraftPrep(dir = 'data/draft-prep', seed = 'public/seed'): { file: DraftPrepFile; report: DraftPrepReport } {
  const errors: string[] = [];
  const boardYears = existsSync(dir) ? readdirSync(dir).filter((d) => /^\d{4}$/.test(d) && existsSync(join(dir, d, 'board.csv'))).map(Number).sort((a, b) => a - b) : [];
  if (!boardYears.length) throw new Error(`no ${dir}/<year>/board.csv found`);
  const boards = new Map(boardYears.map((y) => [y, readBoard(join(dir, String(y), 'board.csv'), errors)]));
  const dv = validateDrafts(JSON.parse(readFileSync(join(seed, 'drafts.json'), 'utf8')));
  if (!dv.ok) errors.push(...dv.errors.map((e) => `drafts.json: ${e}`));
  const keepersFor = new Map(boardYears.map((y) => [y, readKeepers(join(dir, String(y), 'keepers.csv'), errors)]));
  if (errors.length) throw new Error(`draft prep input problems:\n- ${errors.join('\n- ')}`);
  const drafts = (dv as { value: Drafts }).value;

  const lineups = new Map<number, Lineups>();
  for (const f of readdirSync(join(seed, 'lineups'))) {
    const y = Number(f.replace('.json', ''));
    if (y >= Math.min(FIRST_SAMPLE_YEAR, ...FLEX_YEARS)) lineups.set(y, JSON.parse(readFileSync(join(seed, 'lineups', f), 'utf8')) as Lineups);
  }
  const starts = new Map<string, { slot: string; pos: string; n: number }>();
  for (const y of FLEX_YEARS) {
    for (const week of Object.values(lineups.get(y)!.weeks)) for (const team of Object.values(week)) for (const [p, slot] of team.s) {
      if (p < 0 || !slot) continue;
      const pos = lineups.get(y)!.players[p]![1], k = `${slot}|${pos}`;
      const s = starts.get(k) ?? { slot, pos, n: 0 };
      s.n++;
      starts.set(k, s);
    }
  }
  const shared = { ...fitProjections(drafts), flex: fitFlex([...starts.values()], FLEX_YEARS) };
  const fitFor = (year: number): PrepFit => {
    const past: PastBoard[] = [];
    for (let y = year - MARKET_YEARS_BACK; y < year; y++) {
      const b = boards.get(y);
      if (b) past.push({ year: y, rows: b.map((r) => ({ name: r[0], pos: r[1], price: r[4], rank: r.rank ?? null })) });
    }
    return { ...fitMarket(drafts, year, past), ...shared, ...fitSlots(drafts, year) };
  };
  const base = { teams: TEAMS, budget: BUDGET, roster: ROSTER };
  const editions: DraftPrep[] = [];
  const notOnBoard: string[] = [];
  for (const year of boardYears) {
    const keepers = keepersFor.get(year)!;
    if (!keepers.length) continue; // a board with no keepers file is a past board for the price tiers only (2025)
    const board: BoardRow[] = boards.get(year)!.map((r) => [r[0], r[1], r[2], r[3], r[4]]);
    const names = new Set(board.map((b) => playerKey(b[0], b[1])));
    notOnBoard.push(...keepers.filter((k) => !names.has(playerKey(k[0], k[1]))).map((k) => `${year} ${k[0]}`));
    editions.push({ year, kind: 'board', ...base, source: `${dir}/${year}/board.csv`, fit: fitFor(year), board, keepers });
  }
  const last = boardYears.at(-1)!, next = last + 1;
  const curveBoard = boards.get(last)!;
  const curve = Object.fromEntries(PREP_POS.map((pos) => {
    const mine = curveBoard.filter((r) => r[1] === pos);
    return [pos, { price: mine.map((r) => r[4]).sort((a, b) => b - a), proj: mine.map((r) => r[3]).filter((v): v is number => v !== null).sort((a, b) => b - a) }];
  })) as StandIn['curve'];
  const { years, samples } = nextSamples(drafts, lineups, boards, next);
  editions.push({ year: next, kind: 'standin', ...base, source: `${last} season production and trade values, live`, fit: fitFor(next), board: [], keepers: [], standIn: { fromYear: last, curveYear: last, curve, sampleYears: years, samples } });
  return { file: { version: 2, editions }, report: { editions: editions.map((e) => `${e.year} ${e.kind}${e.kind === 'board' ? `: ${e.board.length} players, ${e.keepers.length} keepers, tiers from ${e.fit.marketYears.map(([y]) => y).join('+')}` : `: tiers from ${e.fit.marketYears.map(([y]) => y).join('+')}, slots ${e.fit.slotYears[0]}-${e.fit.slotYears.at(-1)}`}`), keepersNotOnBoard: notOnBoard, samples: samples.length } };
}

export const formatDraftPrep = (f: DraftPrepFile) =>
  `{"version":2,"editions":[\n${f.editions.map((e) => {
    const { board, keepers, standIn, ...head } = e;
    const { samples, ...rest } = standIn ?? { samples: [] };
    const si = standIn ? `,\n"standIn":{${JSON.stringify(rest).slice(1, -1)},"samples":[\n${samples.map((s) => JSON.stringify(s)).join(',\n')}\n]}` : '';
    return `{${JSON.stringify(head).slice(1, -1)},\n"keepers":[\n${keepers.map((k) => JSON.stringify(k)).join(',\n')}\n],\n"board":[\n${board.map((b) => JSON.stringify(b)).join(',\n')}\n]${si}}`;
  }).join(',\n')}\n]}\n`;
