import { DEFAULT_SETTINGS, POSITIONS, type Dataset, type SavedTrade, type Settings } from './schema.ts';

// Trust boundary: everything that enters storage (seed file, imported JSON, saved settings) passes here.
// Hand-written instead of a schema library: one file, no dependency, and the referential checks a
// generic validator would not do anyway.

export type Result<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isNumOrNull = (x: unknown) => x === null || isNum(x);
const isStr = (x: unknown): x is string => typeof x === 'string';
const isPos = (x: unknown) => (POSITIONS as readonly unknown[]).includes(x);

const LISTS = ['teams', 'players', 'rosters', 'games', 'playerWeeks', 'playerStats', 'valuations', 'rankings', 'injuries', 'news', 'keepers', 'transactions'] as const;
const MAX_ERRORS = 25;

export function validateDataset(input: unknown): Result<Dataset> {
  const errors: string[] = [];
  const fail = (msg: string) => {
    if (errors.length < MAX_ERRORS) errors.push(msg);
  };
  if (!isObj(input)) return { ok: false, errors: ['File is not a JSON object.'] };
  if (input.schemaVersion !== 1) return { ok: false, errors: [`Unsupported schemaVersion ${String(input.schemaVersion)} (expected 1).`] };
  if (!isObj(input.meta) || !Array.isArray(input.meta.sources)) fail('meta.sources is missing.');
  const season = input.season;
  if (!isObj(season) || !isNum(season.regularSeasonWeeks) || !Array.isArray(season.lineup) || !isObj(season.sim) || !isObj(season.keeper))
    fail('season config is missing or incomplete.');
  for (const k of LISTS) if (!Array.isArray(input[k])) fail(`${k} must be a list.`);
  if (errors.length) return { ok: false, errors };

  const ds = input as unknown as Dataset;
  const teamIds = new Set<number>();
  ds.teams.forEach((t, i) => {
    if (!isObj(t) || !Number.isInteger(t.id) || !isStr(t.name) || !t.name.trim()) fail(`teams[${i}] needs an integer id and a name.`);
    else if (teamIds.has(t.id)) fail(`Team id ${t.id} appears twice.`);
    else teamIds.add(t.id);
  });
  const playerIds = new Set<string>();
  ds.players.forEach((p, i) => {
    if (!isObj(p) || !isStr(p.id) || !isStr(p.name) || !isPos(p.pos) || !Array.isArray(p.aliases)) fail(`players[${i}] needs id, name, pos (QB/RB/WR/TE) and aliases.`);
    else if (playerIds.has(p.id)) fail(`Player id ${p.id} appears twice.`);
    else playerIds.add(p.id);
  });
  const team = (id: unknown, where: string) => {
    if (!teamIds.has(id as number)) fail(`${where}: unknown team ${String(id)}.`);
  };
  const player = (id: unknown, where: string) => {
    if (!playerIds.has(id as string)) fail(`${where}: unknown player ${String(id)}.`);
  };
  const onRoster = new Map<string, number>();
  ds.rosters.forEach((r, i) => {
    team(r.teamId, `rosters[${i}]`);
    player(r.playerId, `rosters[${i}]`);
    if (r.slot !== 'active' && r.slot !== 'ir') fail(`rosters[${i}]: slot must be active or ir.`);
    const prev = onRoster.get(r.playerId);
    if (prev !== undefined && prev !== r.teamId) fail(`Player ${r.playerId} is on two rosters.`);
    onRoster.set(r.playerId, r.teamId);
  });
  ds.games.forEach((g, i) => {
    team(g.homeId, `games[${i}]`);
    team(g.awayId, `games[${i}]`);
    if (!Number.isInteger(g.week) || g.week < 1) fail(`games[${i}]: bad week.`);
    if (g.status === 'final' ? !isNum(g.homePts) || !isNum(g.awayPts) : g.status !== 'scheduled') fail(`games[${i}]: a final game needs both scores.`);
  });
  ds.playerWeeks.forEach((w, i) => {
    player(w.playerId, `playerWeeks[${i}]`);
    if (w.teamId !== null) team(w.teamId, `playerWeeks[${i}]`);
    if (!isNumOrNull(w.points) || !isNumOrNull(w.projection)) fail(`playerWeeks[${i}]: points and projection must be numbers or null.`);
  });
  ds.playerStats.forEach((s, i) => {
    player(s.playerId, `playerStats[${i}]`);
    if (!isNumOrNull(s.projPerWeek) || !isNumOrNull(s.seasonAvg) || !isNumOrNull(s.seasonPoints)) fail(`playerStats[${i}]: numbers expected.`);
  });
  ds.valuations.forEach((v, i) => {
    player(v.playerId, `valuations[${i}]`);
    if (!isNum(v.value) || v.value < 0 || !isStr(v.source)) fail(`valuations[${i}]: value must be a number >= 0.`);
  });
  ds.rankings.forEach((r, i) => {
    player(r.playerId, `rankings[${i}]`);
    if (!Number.isInteger(r.rank) || r.rank < 1) fail(`rankings[${i}]: rank must be a whole number from 1.`);
  });
  ds.injuries.forEach((x, i) => {
    player(x.playerId, `injuries[${i}]`);
    if (!['Q', 'OUT', 'IR'].includes(x.status)) fail(`injuries[${i}]: status must be Q, OUT or IR.`);
  });
  ds.news.forEach((n, i) => {
    player(n.playerId, `news[${i}]`);
    if (!isNum(n.pct) || Math.abs(n.pct) > 100) fail(`news[${i}]: pct must be between -100 and 100.`);
  });
  ds.keepers.forEach((k, i) => {
    player(k.playerId, `keepers[${i}]`);
    if (!isNumOrNull(k.cost)) fail(`keepers[${i}]: cost must be a number or null.`);
  });
  ds.transactions.forEach((t, i) => {
    if (!isStr(t.id) || !Array.isArray(t.legs) || !t.legs.length) fail(`transactions[${i}] needs an id and legs.`);
    else t.legs.forEach((l, j) => {
      player(l.playerId, `transactions[${i}].legs[${j}]`);
      team(l.fromTeamId, `transactions[${i}].legs[${j}]`);
      team(l.toTeamId, `transactions[${i}].legs[${j}]`);
    });
  });
  if (ds.usage !== undefined) {
    if (!Array.isArray(ds.usage)) fail('usage must be a list.');
    else ds.usage.forEach((u, i) => {
      player(u.playerId, `usage[${i}]`);
      if (!isPos(u.pos) || !isNum(u.g) || !isNum(u.fpg) || !isNum(u.xpg)) fail(`usage[${i}] needs pos, g, fpg and xpg.`);
    });
  }
  if (teamIds.size < 2) fail('A league needs at least two teams.');
  return errors.length ? { ok: false, errors } : { ok: true, value: ds };
}

// Settings come from localStorage, which anyone can edit: keep known fields, clamp numbers, drop the rest.
export function coerceSettings(input: unknown, teamIds: ReadonlySet<number> | null): Settings {
  const s = isObj(input) ? input : {};
  const clamp = (x: unknown, lo: number, hi: number, d: number) => (isNum(x) ? Math.min(hi, Math.max(lo, x)) : d);
  const cw = isObj(s.chartWeights) ? s.chartWeights : {};
  const D = DEFAULT_SETTINGS;
  const my = Number.isInteger(s.myTeamId) && (!teamIds || teamIds.has(s.myTeamId as number)) ? (s.myTeamId as number) : null;
  return {
    version: 1,
    myTeamId: my,
    marketShare: clamp(s.marketShare, 0, 100, D.marketShare),
    chartWeights: {
      peaked: clamp(cw.peaked, 0, 100, D.chartWeights.peaked),
      menton: clamp(cw.menton, 0, 100, D.chartWeights.menton),
      fantasypros: clamp(cw.fantasypros, 0, 100, D.chartWeights.fantasypros),
    },
    injuryStrength: clamp(s.injuryStrength, 0, 1, D.injuryStrength),
    useNews: typeof s.useNews === 'boolean' ? s.useNews : D.useNews,
    productionRamp: typeof s.productionRamp === 'boolean' ? s.productionRamp : D.productionRamp,
    rampMedian: typeof s.rampMedian === 'boolean' ? s.rampMedian : D.rampMedian,
    handcuff: typeof s.handcuff === 'boolean' ? s.handcuff : D.handcuff,
    returnWeeks: isObj(s.returnWeeks) ? Object.fromEntries(Object.entries(s.returnWeeks).filter(([k, v]) => /^pl-\d+$/.test(k) && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 18).slice(0, 200)) as Record<string, number> : {},
  };
}

// Saved trades come from storage or a backup file: keep the well-formed ones, drop the rest.
export function coerceSavedTrades(input: unknown): SavedTrade[] {
  if (!Array.isArray(input)) return [];
  const ids = (x: unknown) => Array.isArray(x) && x.length <= 6 && x.every((p) => typeof p === 'string' && /^pl-\d+$/.test(p));
  const team = (x: unknown) => Number.isInteger(x) && (x as number) > 0;
  const seen = new Set<string>();
  return input.filter((t): t is SavedTrade => {
    if (typeof t !== 'object' || t === null) return false;
    const o = t as Record<string, unknown>;
    const ok = typeof o.id === 'string' && !seen.has(o.id) && typeof o.name === 'string' && o.name.length <= 80 && typeof o.savedAt === 'string' &&
      team(o.a) && team(o.b) && o.a !== o.b && ids(o.aGives) && ids(o.bGives);
    if (ok) seen.add(o.id as string);
    return ok;
  }).slice(0, 200).map((t) => ({ id: t.id, name: t.name.trim() || 'Saved trade', savedAt: t.savedAt, a: t.a, b: t.b, aGives: [...t.aGives], bGives: [...t.bGives] }));
}
