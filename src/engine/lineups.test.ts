// Weekly lineups checks. Run with `npm test`. Built from data/history/rosters, matched to owners by score.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Dataset } from '../data/schema.ts';
import { validateLineups } from '../data/lineups.ts';
import { buildHistory } from '../../scripts/history.ts';
import { buildLineups, formatLineups } from '../../scripts/lineups.ts';
import { buildHist, teamOwners } from './history.ts';
import { buildIndex } from './league.ts';
import { benchBeats, benchTotal, liveLineups, playerLog, startersTotal } from './lineups.ts';

const h = buildHistory(new URL('../../data/history', import.meta.url).pathname);
const all = buildLineups(h, new URL('../../data/history/rosters', import.meta.url).pathname);
const year = (y: number) => all.find((l) => l.year === y)!;

// The live season, built from the league seed rather than a roster export. The fixture is frozen at
// Week 9 of 2026, so these numbers are fixed.
const ds = JSON.parse(readFileSync(new URL('../../test/fixtures/fwhl-2026-11-10.json', import.meta.url), 'utf8')) as Dataset;
const idx = buildIndex(ds);
const H = buildHist(h, idx);
const owners = teamOwners(H);
const live = liveLineups(idx, (t) => owners.get(t));

test('one lineups file per past season, valid after the round trip', () => {
  assert.deepEqual(all.map((l) => l.year), h.seasons.map((s) => s.year));
  for (const l of all) assert.ok(validateLineups(JSON.parse(formatLineups(l)), l.year).ok, String(l.year));
  assert.deepEqual(all.filter((l) => l.detail === 'starters').map((l) => l.year), [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017]);
});

test('every recorded game has both lineups, and ESPN starters add up to the official score', () => {
  for (const s of h.seasons) {
    const L = year(s.year);
    for (const [w, home, away, hs] of s.games) {
      assert.ok(L.weeks[w]?.[home] && L.weeks[w]?.[away], `${s.year} Wk ${w} ${home} v ${away}`);
      if (L.source === 'ESPN' && s.year >= 2012 && !(s.year === 2019 && w >= 14)) assert.equal(L.weeks[w]![home]!.pts, hs);
    }
  }
});

test('2022 Week 5: Clint over Tommy & Nick, box score and bench', () => {
  const t = year(2022).weeks[5]!['clint-h']!;
  assert.equal(startersTotal(t), 123.72);
  assert.equal(year(2022).weeks[5]!['tommy-teves']!.pts, 84.44);
  assert.ok(t.b.length > 0);
  for (const i of benchBeats(year(2022), t)) assert.notEqual(t.b[i]![1], 'IR');
});

test('a player season log follows him across weeks', () => {
  const L = year(2024);
  const i = L.players.findIndex((p) => p[0] === 'James Cook III');
  const log = playerLog(L, i);
  assert.equal(log.length, 18);
  assert.ok(log.every((r) => r.owner === 'vincent-brunoforte'));
  assert.equal(log.filter((r) => r.role === 'start').length, 17);
});

// ---------- the live season ----------

test('the live season builds the same lineups shape, through the last final week only', () => {
  assert.equal(live.year, 2026);
  assert.equal(live.detail, 'full');
  assert.ok(validateLineups(JSON.parse(JSON.stringify(live)), 2026).ok);
  assert.deepEqual(Object.keys(live.weeks).map(Number), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.equal(idx.scoresThrough, 9);
  assert.equal(Object.keys(live.weeks[9]!).length, 12); // all 12 teams
  assert.equal(live.final, undefined); // no end-of-season roster while it is being played
});

test("every live game has both lineups and its starters add up to the league's score", () => {
  const s = H.byYear.get(2026)!;
  assert.equal(s.live, true);
  assert.ok(s.games.length > 0);
  for (const g of s.games) {
    const [ha, aa] = [live.weeks[g.week]?.[g.home], live.weeks[g.week]?.[g.away]];
    assert.ok(ha && aa, `Wk ${g.week} ${g.home} v ${g.away}`);
    assert.equal(startersTotal(ha), g.hs);
    assert.equal(startersTotal(aa), g.as);
  }
});

test('live starters come in lineup order; IR sits at the end of the bench; free agents are left out', () => {
  const t = live.weeks[9]!['nicholas-ferrara']!;
  assert.equal(t.pts, 132.45);
  assert.equal(startersTotal(t), 132.45);
  assert.equal(benchTotal(t), 52.75);
  assert.equal(t.s.length, ds.season.lineup.length);
  // Each starter can legally fill the slot he is listed against.
  t.s.forEach((x, i) => assert.ok(ds.season.lineup[i]!.includes(live.players[x[0]]![1] as never), `slot ${i}`));
  // Lineup slots are not recorded for the live season, so no starter claims one.
  assert.ok(t.s.every((x) => x[1] === null));
  const ir = t.b.map((x) => x[1] === 'IR');
  assert.deepEqual(ir.slice().sort((a, b) => Number(a) - Number(b)), ir, 'IR players come last');
  for (const i of benchBeats(live, t)) assert.notEqual(t.b[i]![1], 'IR');
  // A free agent who scored is in the seed but belongs to nobody's lineup.
  const fa = ds.playerWeeks.find((r) => r.slot === 'fa' && r.week <= 9)!;
  const name = ds.players.find((p) => p.id === fa.playerId)!.name;
  const held = Object.values(live.weeks[fa.week]!).flatMap((x) => [...x.s, ...x.b]).map((x) => live.players[x[0]]![0]);
  assert.ok(!held.includes(name), `${name} should not be in a Week ${fa.week} lineup`);
});

test('a live player season log follows him across weeks', () => {
  const i = live.players.findIndex((p) => p[0] === 'Josh Allen');
  assert.ok(i >= 0);
  const log = playerLog(live, i);
  assert.ok(log.length > 0);
  assert.deepEqual(log.map((r) => r.week), [...log.map((r) => r.week)].sort((a, b) => a - b));
  assert.ok(log.every((r) => r.week <= 9));
  assert.ok(log.every((r) => r.proj !== null), 'the seed carries a projection every week');
});

test('a season with no final week yet builds an empty but valid live file', () => {
  const fresh = structuredClone(ds);
  fresh.games = fresh.games.map((g) => ({ ...g, homePts: null, awayPts: null, status: 'scheduled' as const }));
  const i = buildIndex(fresh);
  const L = liveLineups(i, (t) => owners.get(t));
  assert.equal(i.scoresThrough, 0);
  assert.deepEqual(Object.keys(L.weeks), []);
  assert.deepEqual(L.players, []);
  assert.ok(validateLineups(JSON.parse(JSON.stringify(L)), 2026).ok);
});
