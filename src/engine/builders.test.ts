// Roster building: four separate measures, co-owned seasons credited to both managers.
// Run with `npm test`. Built from data/history, so 2026 numbers move with each weekly push —
// the checks below pin structure and finished seasons, not live magnitudes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Dataset } from '../data/schema.ts';
import { buildHistory } from '../../scripts/history.ts';
import { buildLineups } from '../../scripts/lineups.ts';
import { buildCareers } from '../../scripts/careers.ts';
import { buildDrafts } from '../../scripts/drafts.ts';
import { buildHist, careers } from './history.ts';
import { buildIndex } from './league.ts';
import { buildCareerBook } from './careers.ts';
import { buildDraftBook } from './drafts.ts';
import { bestAndWorstBuilders, builderCareers, MIN_CAPTURE_YEARS, ranked } from './builders.ts';

const dir = new URL('../../data/history', import.meta.url).pathname;
const h = buildHistory(dir);
// The frozen fixture supplies the live 2026 season, so co-owned 2026 seats resolve and the
// numbers below do not move with a weekly data push.
const ds = JSON.parse(readFileSync(new URL('../../test/fixtures/fwhl-2026-11-10.json', import.meta.url), 'utf8')) as Dataset;
const H = buildHist(h, buildIndex(ds));
const cb = buildCareerBook(buildCareers(h, buildLineups(h, `${dir}/rosters`)).careers);
const book = buildDraftBook(buildDrafts(h, dir).drafts);
const bs = builderCareers(H, book, careers(H), cb);
const who = (o: string) => bs.find((b) => b.owner === o)!;

test('one row per career, 14 of them lifers at 5+ seasons', () => {
  assert.equal(bs.length, 27);
  assert.equal(bs.filter((b) => b.lifer).length, 14);
  assert.ok(who('braedyn-jones').lifer, 'Braedyn reaches 5 with the 2024-25 team that was his');
  assert.ok(!who('vincent-brunoforte').lifer, 'Vince is at 4');
});

test('co-owned drafts credit both managers in full (Nic, Nov 13)', () => {
  const nick = who('nick-heisterkamp'), tommy = who('tommy-teves');
  // Nick's own drafts are 2010-2018; from 2024 he shares Tommy's.
  assert.equal(nick.drafts, 12, '9 of his own plus 2024, 2025, 2026');
  const shared = [2024, 2025, 2026];
  for (const y of shared) {
    const picks = book.picks.filter((p) => p.owner === 'tommy-teves' && p.year === y && p.value !== null);
    assert.ok(picks.length > 0, `${y} has judged picks`);
  }
  // Every 2024-on Tommy pick is in both careers, so neither is docked for sharing.
  const sharedPicks = book.picks.filter((p) => p.owner === 'tommy-teves' && shared.includes(p.year) && p.value !== null && !p.keeper).length;
  const nickOwn = book.picks.filter((p) => p.owner === 'nick-heisterkamp' && p.value !== null && !p.keeper).length;
  assert.equal(nick.picks, nickOwn + sharedPicks);
  assert.ok(tommy.picks >= sharedPicks, 'Tommy keeps them too');
});

test('each measure is ranked on its own, never blended', () => {
  const lifers = bs.filter((b) => b.lifer);
  // The reason there is no single score: these two are mirror images of each other.
  assert.equal(bestAndWorstBuilders(lifers, 'draft').best!.owner, 'chandler-hovik');
  assert.equal(bestAndWorstBuilders(lifers, 'draft').worst!.owner, 'wes-anderson');
  assert.equal(bestAndWorstBuilders(lifers, 'keeper').best!.owner, 'wes-anderson');
  assert.equal(bestAndWorstBuilders(lifers, 'keeper').worst!.owner, 'chandler-hovik');
  // Scoring index is finished seasons only, so it is stable.
  assert.equal(bestAndWorstBuilders(lifers, 'index').best!.owner, 'nick-heisterkamp');
  assert.equal(who('nick-heisterkamp').index, 1.077);
});

test('capture needs its own sample: bench detail only starts in 2018', () => {
  const mitman = who('john-mitman');
  assert.equal(mitman.captureYears, 1, 'he left after 2018');
  assert.ok(mitman.capture !== null && !ranked(mitman, 'capture'), 'one season cannot top the column');
  assert.ok(ranked(who('david-morris'), 'capture'));
  for (const b of bs) if (ranked(b, 'capture')) assert.ok(b.captureYears >= MIN_CAPTURE_YEARS);
  const { best } = bestAndWorstBuilders(bs.filter((b) => b.lifer), 'capture');
  assert.equal(best!.owner, 'david-morris');
});
