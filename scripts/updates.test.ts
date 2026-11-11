// Checks for the weekly data updates. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Dataset } from '../src/data/schema.ts';
import { validateDataset } from '../src/data/validate.ts';
import { applyChart, applyProjections, applyResults, applyRosters, formatDataset, newReport, Players, slug, type ResultsIn, type RostersIn } from './updates.ts';

const fixture = readFileSync(new URL('../test/fixtures/fwhl-2026-11-10.json', import.meta.url), 'utf8');
const fresh = (): Dataset => JSON.parse(fixture);
const name = (ds: Dataset, id: string) => ds.players.find((p) => p.id === id)!;
const TODAY = '2026-11-11';

// Today's rosters as a Quick Refresh would send them, with made-up ESPN ids.
function rostersInput(ds: Dataset, withIds: boolean): RostersIn {
  return {
    teams: ds.teams.map((t) => ({
      teamId: t.id,
      players: ds.rosters.filter((r) => r.teamId === t.id).map((r) => {
        const p = name(ds, r.playerId);
        const inj = ds.injuries.find((i) => i.playerId === r.playerId);
        return { player: { name: p.name, pos: p.pos, ...(withIds ? { espnId: 4000000 + Number(p.id.slice(3)) } : {}) }, slot: r.slot, injury: inj?.status ?? null };
      }),
    })),
  };
}

test('player names match the old keys', () => {
  assert.equal(slug('Luther Burden III'), 'lutherburden');
  assert.equal(slug("Ja'Marr Chase"), 'jamarrchase');
  assert.equal(slug('Aaron Jones Sr.'), 'aaronjones');
});

test('ESPN ids are filled in when present and never required', () => {
  const ds = fresh();
  const noIds = applyRosters(ds, rostersInput(ds, false), TODAY);
  assert.equal(noIds.espnIdsAdded, 0);
  assert.equal(noIds.created.length, 0, 'matching by name still works without ids');
  const withIds = applyRosters(ds, rostersInput(ds, true), TODAY);
  assert.equal(withIds.espnIdsAdded, ds.rosters.length);
  assert.ok(ds.rosters.every((r) => name(ds, r.playerId).espnId !== null));
  assert.ok(validateDataset(ds).ok);
});

test('a same-named player with a different ESPN id is a new player', () => {
  const ds = fresh();
  const rep = newReport();
  const P = new Players(ds, rep);
  const allen = P.resolve({ name: 'Josh Allen', pos: 'QB', espnId: 3918298 }, true)!;
  const other = P.resolve({ name: 'Josh Allen', pos: 'QB', espnId: 1 }, true)!;
  assert.notEqual(allen, other);
  assert.equal(rep.created.length, 1);
  assert.equal(P.resolve({ name: 'Josh Allen', pos: 'QB', espnId: 3918298 }, false), allen, 'later runs match by id');
});

test('rosters: sanity check stops a bad pull, injuries keep their history', () => {
  const ds = fresh();
  const shuffled = rostersInput(ds, false);
  const all = shuffled.teams.flatMap((t) => t.players);
  shuffled.teams.forEach((t, i) => (t.players = all.filter((_, k) => k % shuffled.teams.length === i)));
  assert.throws(() => applyRosters(fresh(), shuffled, TODAY), /changed teams/);
  const inp = rostersInput(ds, false);
  const healthy = inp.teams[0]!.players.find((p) => !p.injury)!;
  healthy.injury = 'IR';
  const rep = applyRosters(ds, inp, TODAY);
  const id = ds.players.find((p) => p.name === healthy.player.name)!.id;
  const inj = ds.injuries.find((i) => i.playerId === id)!;
  assert.equal(inj.status, 'IR');
  assert.equal(inj.since, TODAY);
  assert.match(inj.note, /^IR, ESPN Nov 11$/);
  assert.ok(rep.changes.some((c) => c.includes('healthy -> IR')));
  assert.throws(() => applyRosters(fresh(), { teams: inp.teams.slice(1) }, TODAY), /expected 12 teams/);
});

test('charts are scaled so the top player is 100, unknown names are reported not fatal', () => {
  const ds = fresh();
  const cur = ds.valuations.filter((v) => v.source === 'menton' && v.week === 10);
  const rows = cur.map((v) => ({ name: name(ds, v.playerId).name, value: v.value * 0.78 }));
  rows.push({ name: 'Nobody Real', value: 12 });
  const rep = applyChart(ds, 'menton', 11, rows);
  const wk11 = ds.valuations.filter((v) => v.source === 'menton' && v.week === 11);
  assert.equal(wk11.length, cur.length);
  assert.equal(Math.max(...wk11.map((v) => v.value)), 100);
  assert.deepEqual(rep.unmatched, ['Nobody Real']);
  assert.equal(ds.meta.sources.find((s) => s.id === 'menton')!.week, 11);
  assert.throws(() => applyChart(fresh(), 'menton', 11, rows.slice(0, 10)), /need 50/);
});

test('projections: rest-of-season math, and a thin pull is stopped', () => {
  const ds = fresh();
  const gibbs = ds.players.find((p) => p.name === 'Jahmyr Gibbs')!;
  const one = { week: 10, started: false, players: [{ player: { name: gibbs.name, pos: gibbs.pos }, bye: 6, ros: 270, weekly: { '10': 28.4, '11': 27.1 } }] };
  assert.throws(() => applyProjections(ds, one, TODAY), /no projection/);
  applyProjections(ds, one, TODAY, true);
  const st = ds.playerStats.find((s) => s.playerId === gibbs.id)!;
  assert.equal(st.projPerWeek, 30); // 270 over Weeks 10-18 (bye already past) = 9 games
  assert.equal(st.projRegularRest, 150); // 5 regular-season games left
  assert.equal(ds.playerWeeks.find((w) => w.playerId === gibbs.id && w.week === 11)!.projection, 27.1);
  assert.ok(validateDataset(ds).ok);
});

test('results: starters must add up to the score; trades are added once', () => {
  const ds = fresh();
  const rows = ds.playerWeeks.filter((w) => w.week === 9).map((w) => ({ player: { name: name(ds, w.playerId).name, pos: name(ds, w.playerId).pos }, teamId: w.teamId, slot: w.slot, points: w.points, projection: w.projection, opponent: w.opponent }));
  const games = ds.games.map((g) => [g.week, g.homeId, g.awayId, g.homePts, g.awayPts, g.status] as ResultsIn['games'][number]);
  const tx = { id: 'tTEST', type: 'trade' as const, date: '2026-11-11', week: 10, effectiveWeek: 10, legs: [
    { player: { name: 'Josh Allen', pos: 'QB' as const }, from: 10, to: 9 }, { player: { name: 'Dak Prescott', pos: 'QB' as const }, from: 9, to: 10 }] };
  const rep = applyResults(ds, { week: 9, games, rows, season: [], transactions: [tx, tx] }, TODAY);
  assert.equal(ds.transactions.filter((t) => t.id === 'tTEST').length, 1);
  assert.ok(rep.changes.some((c) => c.startsWith('New trade')));
  const bad = rows.map((r) => (r.slot === 'start' && r.teamId === 10 ? { ...r, points: (r.points ?? 0) + 5 } : r));
  assert.throws(() => applyResults(fresh(), { week: 9, games, rows: bad, season: [] }, TODAY), /starters add to/);
  assert.throws(() => applyResults(fresh(), { week: 10, games, rows, season: [] }, TODAY), /not final/);
  // Backfilling Week 3 replaces that week only and leaves "scores through" at Week 9 (DATA-10).
  const b = fresh();
  const rows3 = b.playerWeeks.filter((w) => w.week === 3).map((w) => ({ player: { name: name(b, w.playerId).name, pos: name(b, w.playerId).pos }, teamId: w.teamId, slot: w.slot, points: w.points, projection: w.projection, opponent: w.opponent }));
  const n9 = b.playerWeeks.filter((w) => w.week === 9).length;
  applyResults(b, { week: 3, games, rows: rows3, season: [] }, TODAY);
  assert.equal(b.meta.sources.find((x) => x.id === 'scores')?.throughWeek, 9);
  assert.equal(b.playerWeeks.filter((w) => w.week === 9).length, n9);
});

test('the file format round-trips', () => {
  const ds = fresh();
  assert.deepEqual(JSON.parse(formatDataset(ds)), ds);
});
