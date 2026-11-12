// Weekly lineups checks. Run with `npm test`. Built from data/history/rosters, matched to owners by score.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateLineups } from '../data/lineups.ts';
import { buildHistory } from '../../scripts/history.ts';
import { buildLineups, formatLineups } from '../../scripts/lineups.ts';
import { benchBeats, playerLog, startersTotal } from './lineups.ts';

const h = buildHistory(new URL('../../data/history', import.meta.url).pathname);
const all = buildLineups(h, new URL('../../data/history/rosters', import.meta.url).pathname);
const year = (y: number) => all.find((l) => l.year === y)!;

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
