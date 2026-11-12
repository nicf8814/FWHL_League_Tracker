// League history checks. Run with `npm test`. Built from the CSVs in data/history, not the
// published JSON, so the numbers below are pinned to the league's own records.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Dataset } from '../data/schema.ts';
import { validateHistory } from '../data/history.ts';
import { buildHistory, formatHistory } from '../../scripts/history.ts';
import { buildHist, careers, headToHead, records, seasonAwards } from './history.ts';
import { buildIndex } from './league.ts';

const raw = buildHistory(new URL('../../data/history', import.meta.url).pathname);
const past = buildHist(raw);
const ds = JSON.parse(readFileSync(new URL('../../test/fixtures/fwhl-2026-11-10.json', import.meta.url), 'utf8')) as Dataset;
const live = buildHist(raw, buildIndex(ds));
const career = (H: typeof past, o: string) => careers(H).find((c) => c.owner === o)!;

test('history builds, validates and round-trips through the file format', () => {
  assert.equal(raw.seasons.length, 16);
  assert.equal(raw.seasons[0]!.year, 2010);
  assert.ok(validateHistory(JSON.parse(formatHistory(raw))).ok);
  assert.deepEqual(raw.seasons.filter((s) => s.platform === 'Sleeper').map((s) => s.year), [2024, 2025]);
});

test('2012 Week 13 follows the official record: Cooper 9-4, Wes 7-6', () => {
  const s = past.byYear.get(2012)!;
  const row = (o: string) => s.rows.find((r) => r.owner === o)!;
  assert.equal(`${row('ryan-cooper').w}-${row('ryan-cooper').l}`, '9-4');
  assert.equal(`${row('wes-anderson').w}-${row('wes-anderson').l}`, '7-6');
  const g = s.games.find((x) => x.week === 13 && x.home === 'wes-anderson')!;
  assert.equal(g.winner, 'wes-anderson');
  assert.ok(g.as > g.hs, 'scores are kept as the box score shows them');
});

test('season luck matches the hand-checked seasons', () => {
  const at = (y: number, o: string) => past.byYear.get(y)!.rows.find((r) => r.owner === o)!;
  assert.equal(at(2018, 'nick-heisterkamp').luck.toFixed(2), '4.77');
  assert.equal(at(2014, 'tommy-teves').luck.toFixed(2), '-3.09');
  for (const s of past.seasons) {
    const sum = s.rows.reduce((a, r) => a + r.luck, 0);
    const fixes = s.notes.length; // a correction moves a win without moving the scores
    assert.ok(Math.abs(sum) < 1e-6 || fixes > 0, `${s.year} luck sums to ${sum}`);
  }
});

test('Ty is one owner, the filler team counts for no one', () => {
  const ty = career(past, 'ty-carlson');
  assert.equal(ty.seasons.length, 16);
  assert.equal(ty.seasons[0]!.year, 2010);
  assert.ok(!careers(past).some((c) => c.owner === 'clint-helling'));
  assert.equal(career(past, 'clint-h').seasons.length, 16);
});

test('careers: titles, finals, droughts', () => {
  assert.deepEqual(career(past, 'nicholas-ferrara').titles, [2014, 2020]);
  assert.equal(career(past, 'david-morris').runnerUps.length, 5);
  assert.equal(career(past, 'ryan-cooper').drought, null);
  assert.equal(career(past, 'travis-mattson').drought, 14);
  assert.equal(careers(past).filter((c) => c.lifer).length, 10, 'Nick counts his co-owned seasons; Tim reaches 10 in 2026');
  assert.equal(careers(live).filter((c) => c.lifer).length, 11);
});

test('the live season joins from the league seed', () => {
  const s = live.seasons.at(-1)!;
  assert.equal(s.year, 2026);
  assert.ok(s.live);
  assert.equal(s.rows.length, 12);
  assert.equal(s.rows.find((r) => r.owner === 'nicholas-ferrara')!.w, 8);
  assert.equal(seasonAwards(live, s).last, undefined, 'no last place until the season ends');
  assert.equal(career(live, 'clint-h').seasons.length, 17);
});

test('records and head to head', () => {
  const R = records(past, 5);
  assert.equal(R.high[0]!.owner, 'travis-mattson');
  assert.equal(R.high[0]!.pts, 191.18);
  assert.equal(R.winStreaks[0]!.owner, 'grant-gosselin');
  assert.equal(R.winStreaks[0]!.len, 13);
  const a = headToHead(past, 'clint-h', 'david-morris'), b = headToHead(past, 'david-morris', 'clint-h');
  assert.equal(a.w, b.l);
  assert.equal(a.pf.toFixed(2), b.pa.toFixed(2));
});

test('Alex Teves through 2011, Tommy Teves from 2012 (aliases.csv)', () => {
  const alex = career(past, 'alex-teves'), tommy = career(past, 'tommy-teves');
  assert.deepEqual(alex.seasons.map((s) => s.year), [2010, 2011]);
  assert.equal(tommy.seasons[0]!.year, 2012);
  assert.equal(tommy.seasons.length, 14);
  assert.deepEqual(tommy.titles, [2016, 2024]);
  assert.deepEqual(alex.runnerUps, [2010]);
  assert.deepEqual(tommy.runnerUps, [2019]);
  assert.ok(career(live, 'tommy-teves').lifer, '15 seasons with 2026');
});

test('Nick Heisterkamp: his own team 2010-2018, co-owner of Tommy\'s from 2022 (coowners.csv)', () => {
  const nick = career(live, 'nick-heisterkamp'), tommy = career(live, 'tommy-teves');
  assert.deepEqual(nick.seasons.map((s) => s.year), [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2022, 2023, 2024, 2025, 2026]);
  assert.deepEqual(nick.titles, [2012, 2017, 2024]);
  assert.deepEqual(nick.thirds, [2011, 2015, 2018]);
  assert.equal(`${career(past, 'nick-heisterkamp').w}-${career(past, 'nick-heisterkamp').l}`, '107-66');
  assert.equal(nick.playoffs, 12);
  assert.ok(nick.active);
  assert.deepEqual(nick.seasons.at(-1)!.with, ['tommy-teves']);
  assert.deepEqual(tommy.seasons.at(-1)!.with, ['nick-heisterkamp']);
  assert.deepEqual(tommy.titles, [2016, 2024], 'Tommy keeps his own seasons');
  // Before 2022 they played each other; from 2022 they are one team.
  const h = headToHead(live, 'nick-heisterkamp', 'tommy-teves');
  assert.ok(h.games.length > 0 && h.games.every((g) => g.year <= 2018));
  const vsClint = headToHead(live, 'nick-heisterkamp', 'clint-h');
  assert.ok(vsClint.games.some((g) => g.year >= 2022));
});

test('Sleeper brackets: invented playoff-week games dropped, the missing 10th-place game added (bracket-fixes.csv)', () => {
  const s25 = past.byYear.get(2025)!, s24 = past.byYear.get(2024)!;
  const at = (s: typeof s25, w: number, o: string) => s.games.filter((g) => g.week === w && (g.home === o || g.away === o));
  assert.equal(at(s25, 17, 'tommy-teves').length, 0, '5th place was Week 16');
  assert.equal(at(s25, 16, 'tommy-teves')[0]!.winner, 'tommy-teves');
  assert.equal(at(s24, 17, 'clint-h').length, 0);
  const tenth = at(s25, 17, 'grant-gosselin');
  assert.equal(tenth.length, 1);
  assert.equal(tenth[0]!.winner, 'clint-helling');
});
