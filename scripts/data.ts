// League data command line. Every change to public/seed/fwhl-2026.json goes through here.
//   node scripts/data.ts <command> [args] [--dry-run] [--force] [--file <dataset.json>]
// Commands and input formats: docs/data-updates.md. Exit code 1 = nothing was written.
import { readFileSync, writeFileSync } from 'node:fs';
import type { Dataset, Pos } from '../src/data/schema.ts';
import { validateDataset } from '../src/data/validate.ts';
import { buildIndex, freshness } from '../src/engine/league.ts';
import {
  applyChart, applyProjections, applyRanks, applyResults, applyRosters, applyUsage, arizonaToday, formatDataset, parseCsv,
  type ChartRow, type RankRow, type Report,
} from './updates.ts';

const args = process.argv.slice(2);
const flag = (f: string) => { const i = args.indexOf(f); if (i < 0) return false; args.splice(i, 1); return true; };
const opt = (f: string) => { const i = args.indexOf(f); if (i < 0) return null; const v = args[i + 1] ?? null; args.splice(i, 2); return v; };
const dry = flag('--dry-run');
const force = flag('--force');
const file = opt('--file') ?? 'public/seed/fwhl-2026.json';
const [cmd, ...rest] = args;

function fail(msg: string): never {
  console.error(`ERROR: ${msg}\nNothing was written.`);
  process.exit(1);
}
const readJson = (p: string | undefined): unknown => {
  if (!p) fail('missing input file.');
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch (e) { fail(`could not read ${p}: ${e instanceof Error ? e.message : e}`); }
};

function load(): Dataset {
  const v = validateDataset(readJson(file));
  if (!v.ok) fail(`${file} is invalid before the update:\n- ${v.errors.join('\n- ')}`);
  return v.value;
}

function summary(ds: Dataset) {
  const idx = buildIndex(ds);
  const rostered = ds.rosters.length;
  const withId = ds.rosters.filter((r) => ds.players.find((p) => p.id === r.playerId)?.espnId != null).length;
  return {
    currentWeek: idx.currentWeek,
    scoresThrough: idx.scoresThrough,
    counts: { players: ds.players.length, rosterSpots: rostered, playerWeeks: ds.playerWeeks.length, transactions: ds.transactions.length, usage: ds.usage?.length ?? 0 },
    rosteredWithEspnId: `${withId}/${rostered}`,
    sources: freshness(idx).map((s) => `${s.id}: ${s.asOf} (${s.age}${s.stale ? ', stale' : ''})`),
  };
}

function finish(ds: Dataset, rep: Report) {
  ds.meta.exportedAt = new Date().toISOString();
  const v = validateDataset(JSON.parse(JSON.stringify(ds)));
  if (!v.ok) fail(`the update would leave the dataset invalid:\n- ${v.errors.join('\n- ')}`);
  if (!dry) writeFileSync(file, formatDataset(ds));
  console.log(JSON.stringify({ written: !dry, file, ...rep, after: summary(ds) }, null, 2));
}

function chartRows(p: string | undefined): ChartRow[] {
  if (!p) fail('missing CSV file.');
  const rows = parseCsv(readFileSync(p, 'utf8'));
  const body = rows[0] && !Number.isFinite(Number(rows[0][1])) ? rows.slice(1) : rows; // optional header
  return body.map(([name = '', value = '', pos]) => ({ name, value: Number(value), ...(pos ? { pos: pos.toUpperCase() as Pos } : {}) }));
}

function rankRows(p: string | undefined): RankRow[] {
  if (!p) fail('missing CSV file.');
  const rows = parseCsv(readFileSync(p, 'utf8'));
  const body = rows[0] && !Number.isFinite(Number(rows[0][2])) ? rows.slice(1) : rows;
  return body.map(([name = '', pos = '', rank = '']) => ({ name, pos: pos.toUpperCase() as Pos, rank: Number(rank) }));
}

const today = opt('--today') ?? arizonaToday();
try {
  switch (cmd) {
    case 'check': {
      const ds = load();
      console.log(JSON.stringify({ valid: true, file, ...summary(ds) }, null, 2));
      break;
    }
    case 'results': { const ds = load(); finish(ds, applyResults(ds, readJson(rest[0]) as never, today)); break; }
    case 'projections': { const ds = load(); finish(ds, applyProjections(ds, readJson(rest[0]) as never, today, force)); break; }
    case 'rosters': { const ds = load(); finish(ds, applyRosters(ds, readJson(rest[0]) as never, today, force)); break; }
    case 'usage': { const ds = load(); finish(ds, applyUsage(ds, readJson(rest[0]) as never)); break; }
    case 'chart': {
      const [source, week, csv] = rest;
      const ds = load();
      finish(ds, applyChart(ds, source as 'peaked' | 'menton', Number(week), chartRows(csv)));
      break;
    }
    case 'ranks': { const ds = load(); finish(ds, applyRanks(ds, rankRows(rest[0]), today)); break; }
    default:
      fail(`unknown command "${cmd ?? ''}". Use: check | results <json> | projections <json> | rosters <json> | usage <json> | chart <peaked|menton> <week> <csv> | ranks <csv>`);
  }
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
