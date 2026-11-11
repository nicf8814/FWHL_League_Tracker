// Engine checks. Run with `npm test` (Node's built-in runner, no test framework).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type Dataset } from '../data/schema.ts';
import { coerceSettings, validateDataset } from '../data/validate.ts';
import { findTrades } from './finder.ts';
import { buildIndex, freshness, standings, weekOfDate } from './league.ts';
import { buildBase, buildValues, lineup } from './model.ts';
import { rank6, seed, simulate, tally, type SimInput } from './sim.ts';
import { evaluate, tradeFromQuery, tradeToQuery, validateTrade } from './trade.ts';

const raw = JSON.parse(readFileSync(new URL('../../test/fixtures/fwhl-2026-11-10.json', import.meta.url), 'utf8'));
const checked = validateDataset(raw);
assert.ok(checked.ok, 'seed must validate');
const ds = (checked as { value: Dataset }).value;
const idx = buildIndex(ds);
const base = buildBase(idx, true);
const team = (name: string) => ds.teams.find((t) => t.name === name)!.id;
const pid = (name: string) => ds.players.find((p) => p.name === name)!.id;
const simInput: SimInput = { teamIds: idx.teamIds, games: idx.games, strength: base.strength, cfg: ds.season.sim, top6Weeks: ds.season.top6Weeks, seedsByRecord: ds.season.seedsByRecord };
const sim = simulate(simInput);
const V = buildValues(base, DEFAULT_SETTINGS, sim);

test('seed is normalized and names no one as "you" (DATA-2)', () => {
  assert.equal(ds.teams.length, 12);
  assert.ok(!JSON.stringify(ds).includes('(you)'));
  assert.ok(ds.players.every((p) => /^pl-\d{4}$/.test(p.id)), 'opaque player ids (DATA-1)');
});

test('current week comes from the schedule (LOGIC-2)', () => {
  assert.equal(idx.currentWeek, 10);
  assert.equal(idx.scoresThrough, 9);
  assert.equal(weekOfDate('2026-09-14', ds.season.week1EndsUtc), 1);
  assert.equal(weekOfDate('2026-09-15', ds.season.week1EndsUtc), 2);
  assert.equal(weekOfDate('2026-11-10', ds.season.week1EndsUtc), 10);
});

test('freshness reads each source stamp (LOGIC-1)', () => {
  const f = freshness(idx, new Date('2026-11-10T20:00:00'));
  assert.equal(f.find((s) => s.id === 'espn')!.stale, false);
  assert.equal(f.find((s) => s.id === 'peaked')!.stale, true, 'Week 8 chart is two weeks behind Week 10');
  assert.equal(freshness(idx, new Date('2026-11-20T12:00:00')).find((s) => s.id === 'espn')!.stale, true);
});

test('standings match the league table through Week 9', () => {
  const rows = standings(idx);
  assert.deepEqual(rows.slice(0, 5).map((r) => ds.teams.find((t) => t.id === r.teamId)!.name), ['Grant', 'Nic', 'David', 'Coop', 'Tim']);
  const nic = rows.find((r) => r.teamId === team('Nic'))!;
  assert.equal(`${nic.w}-${nic.l}`, '8-1');
  assert.equal(nic.pf.toFixed(1), '1295.4');
});

test('top-6 weeks and tiebreaks', () => {
  assert.equal(rank6(100, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]), 'W');
  assert.equal(rank6(1, [100, 100, 100, 100, 100, 100, 0, 0, 0, 0, 0]), 'L');
  assert.equal(rank6(50, [90, 80, 70, 60, 55, 50, 10, 10, 10, 10, 10]), 'T');
  // 1 and 2 tied on wins; 2 beat 1 head to head, so 2 seeds first even with fewer points.
  const order = seed([1, 2, 3], (i) => (i === 3 ? 1 : 5), (i) => (i === 1 ? 900 : 800), (i, j) => (i === 2 && j === 1 ? 1 : 0), 1);
  assert.deepEqual(order, [2, 1, 3]);
});

test('playoff sim is deterministic and fills six spots', () => {
  const again = simulate(simInput);
  assert.deepEqual(again.odds, sim.odds);
  const total = Object.values(sim.odds).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 6) < 1e-9, `odds sum to ${total}`);
});

test('lineup fills every slot from healthy players', () => {
  const lu = lineup(base, (idx.roster.get(team('Nic')) ?? []).filter((p) => !base.isOut(p)), () => 1);
  assert.equal(lu.slots.length, 7);
  assert.ok(lu.slots.every((s) => s.pid));
});

test('trades are two teams sending only their own players (LOGIC-4)', () => {
  const nic = team('Nic'), vince = team('Vince');
  const allen = pid('Josh Allen'), dak = pid('Dak Prescott');
  assert.deepEqual(validateTrade({ a: nic, b: vince, aGives: [allen], bGives: [dak] }, idx), []);
  assert.ok(validateTrade({ a: nic, b: nic, aGives: [allen], bGives: [] }, idx).length);
  assert.ok(validateTrade({ a: nic, b: vince, aGives: [dak], bGives: [] }, idx).some((e) => e.includes('not on that team')));
  assert.ok(validateTrade({ a: nic, b: vince, aGives: [allen, allen], bGives: [] }, idx).length);
  const q = tradeToQuery({ a: nic, b: vince, aGives: [allen], bGives: [dak] });
  assert.deepEqual(tradeFromQuery(new URLSearchParams(q)), { a: nic, b: vince, aGives: [allen], bGives: [dak] });
});

test('regression: the port reproduces the Sandbox engine exactly', () => {
  // The Sandbox (Nov 10) believed it was Week 9 (the LOGIC-2 bug). Run the port at Week 9 and it must
  // show the same numbers it did: send 137.8, get 16.2, Nic −24.1 pts/wk, Vince +26.1, Vince sees +121.7.
  const ix9 = { ...idx, currentWeek: 9 };
  const b9 = buildBase(ix9, true);
  const v9 = buildValues(b9, DEFAULT_SETTINGS, simulate({ ...simInput, strength: b9.strength }));
  const trade = { a: team('Nic'), b: team('Vince'), aGives: [pid('Josh Allen'), pid('Christian McCaffrey')], bGives: [pid('Dak Prescott')] };
  const ev = evaluate(v9, trade)!;
  const same = (got: number, want: number, what: string) => assert.equal(got.toFixed(1), want.toFixed(1), what);
  same(ev.value.aSends, 137.8, 'Nic sends');
  same(ev.value.bSends, 16.2, 'Vince sends');
  same(ev.gainA, -24.1, 'Nic pts/wk');
  // The Sandbox showed +26.1; Vince takes 2 for 1, and since LOGIC-5 he cuts his lowest-valued player
  // to stay at roster size, which costs him 0.2 pts/wk of bye-week depth.
  same(ev.gainB, 25.9, 'Vince pts/wk');
  assert.equal(v9.autoDrops(trade.b, trade.bGives, trade.aGives).length, 1, 'Vince cuts one player');
  assert.deepEqual(v9.autoDrops(trade.a, trade.aGives, trade.bGives), [], 'Nic cuts nobody');
  same(ev.partnerEdge, 121.7, 'Vince on paper');
  assert.equal(ev.verdict.kind, 'lose');
  // At the real current week the value side is unchanged; only the weeks left change.
  same(evaluate(V, trade)!.value.aSends, 137.8, 'Week 10 value');
});

test('finder returns fair offers that help the asking team', () => {
  const res = findTrades(V, { team: team('Nic'), pos: 'RB', sell: [], keep: [], want: [], gap: 3, maxLoss: 1, partner: 'all', sort: 'me' });
  assert.ok(res.length > 0);
  for (const g of res) for (const o of g.offers) {
    assert.ok(o.myGain >= -1);
    assert.ok(Math.abs(o.edge - 3) <= 2.5);
    assert.ok(o.get.some((p) => idx.players.get(p)!.pos === 'RB'));
  }
});

test('validation rejects broken data and coerces settings', () => {
  const bad = structuredClone(raw);
  bad.rosters[0].playerId = 'pl-9999';
  const r = validateDataset(bad);
  assert.ok(!r.ok && r.errors.some((e) => e.includes('unknown player')));
  assert.equal(validateDataset({ schemaVersion: 2 }).ok, false);
  const s = coerceSettings({ myTeamId: 99, marketShare: 500, chartWeights: { peaked: -3 } }, new Set(idx.teamIds));
  assert.equal(s.myTeamId, null);
  assert.equal(s.marketShare, 100);
  assert.equal(s.chartWeights.peaked, 0);
});

test('exact ties count as ties (LOGIC-17)', () => {
  const T = tally([1, 2], [[1, 1, 2, 100, 100, true]], []);
  assert.deepEqual([T.get(1)!.w, T.get(1)!.t, T.get(2)!.t], [0, 1, 1]);
  assert.equal(rank6(100, [120, 110, 105, 104, 103, 100, 90, 80, 70, 60, 50]), 'T'); // 5 above, 1 level: straddles 6th
  // A team 1 game up on a tie keeps the edge: 1.5 wins beats 1.
  assert.deepEqual(seed([1, 2], (i) => (i === 1 ? 1.5 : 1), () => 0, () => 0, 1), [1, 2]);
});
