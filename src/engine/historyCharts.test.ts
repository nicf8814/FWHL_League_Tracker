// History chart numbers. Run with `npm test`. Built from data/history plus the frozen league seed.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Dataset } from '../data/schema.ts';
import { buildHistory } from '../../scripts/history.ts';
import { buildHist, careers, crew, headToHead } from './history.ts';
import { finishGrid, luckLines, rivalRows, scoreSpread, shortName, starterShares, tier } from './historyCharts.ts';
import { buildIndex } from './league.ts';
import type { PlayerCareer } from './careers.ts';

const raw = buildHistory(new URL('../../data/history', import.meta.url).pathname);
const ds = JSON.parse(readFileSync(new URL('../../test/fixtures/fwhl-2026-11-10.json', import.meta.url), 'utf8')) as Dataset;
const H = buildHist(raw, buildIndex(ds));
const all = careers(H);

test('short names are first names unless two owners share one', () => {
  assert.equal(shortName(H, 'clint-h'), 'Clint');
  assert.equal(shortName(H, 'nicholas-ferrara'), 'Nicholas');
  const firsts = all.map((c) => shortName(H, c.owner));
  assert.equal(new Set(firsts).size, firsts.length);
});

test('finish tiers: title, podium, playoff field, out', () => {
  assert.deepEqual([1, 2, 3, 4, 6, 7, 12].map((f) => tier(f, 6)), ['title', 'podium', 'podium', 'playoffs', 'playoffs', 'out', 'out']);
});

test('finish grid: finished seasons only, lifers by titles, gold only for that year\'s champions', () => {
  const g = finishGrid(H, all);
  assert.equal(g.years.length, 16);
  assert.ok(!g.years.includes(2026));
  assert.ok(g.rows.every((r, i) => i === 0 || g.rows[i - 1]!.titles.length >= r.titles.length));
  for (const [i, y] of g.years.entries()) {
    const champs = crew(H, H.byYear.get(y)!.podium[0]!, y); // a co-owned title is gold for each owner
    const golds = g.rows.filter((r) => r.cells[i]!.tier === 'title').map((r) => r.owner);
    assert.ok(golds.every((o) => champs.includes(o)), `${y}: ${golds.join(', ')}`);
  }
  const clint = g.rows.find((r) => r.owner === 'clint-h')!;
  assert.equal(clint.cells[g.years.indexOf(2023)]!.finish, 1);
  assert.equal(clint.cells[g.years.indexOf(2025)]!.finish, 12);
});

test('rival rows add up to the head-to-head record and sort best first', () => {
  const rows = rivalRows(H, 'nicholas-ferrara', all);
  assert.ok(rows.length > 5);
  for (const r of rows) {
    const h = headToHead(H, 'nicholas-ferrara', r.owner);
    assert.equal(r.w + r.l + r.t, h.games.length);
  }
  assert.ok(rows.every((r, i) => i === 0 || rows[i - 1]!.pct >= r.pct));
  assert.ok(!rows.some((r) => r.owner === 'nicholas-ferrara'));
});

test('luck lines end at career luck, best season is the max', () => {
  const lines = luckLines(H, all.filter((c) => c.active));
  for (const l of lines) {
    const c = all.find((x) => x.owner === l.owner)!;
    assert.ok(Math.abs(l.path.at(-1)!.total - c.luck) < 1e-9);
    assert.ok(Math.abs(l.total - c.luck) < 1e-9);
    assert.ok(l.best.v >= l.worst.v);
    assert.ok(c.seasons.every((s) => s.luck <= l.best.v + 1e-9 && s.luck >= l.worst.v - 1e-9));
  }
  assert.equal(lines.at(-1)!.owner, 'clint-h');
});

test('scoring spread: one row per season, ordered quantiles, the Sleeper jump', () => {
  const s = scoreSpread(H);
  assert.equal(s.length, 17);
  for (const r of s) assert.ok(r.p10 <= r.p25 && r.p25 <= r.med && r.med <= r.p75 && r.p75 <= r.p90 && r.p90 <= r.high.pts);
  const y = (n: number) => s.find((r) => r.year === n)!;
  assert.ok(y(2024).med > y(2023).med + 25, 'Sleeper scoring lifts the median');
  assert.equal(y(2024).high.owner, 'grant-gosselin');
  assert.equal(y(2026).live, true);
});

test('starter shares: per manager, biggest first, zeros left out', () => {
  const p = { seasons: [{ owner: 'a', startPts: 10 }, { owner: 'b', startPts: 30 }, { owner: 'a', startPts: 5 }, { owner: 'c', startPts: 0 }] } as unknown as PlayerCareer;
  assert.deepEqual(starterShares(p), [{ owner: 'b', pts: 30 }, { owner: 'a', pts: 15 }]);
});
