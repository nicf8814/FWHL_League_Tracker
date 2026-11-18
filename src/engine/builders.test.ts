// Roster building: four separate measures, co-owned seasons credited to both managers.
// Run with `npm test`. Built from data/history, so 2026 numbers move with each weekly push —
// the checks below pin structure and finished seasons, not live magnitudes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Dataset } from '../data/schema.ts';
import { buildHistory } from '../../scripts/history.ts';
import { buildDrafts } from '../../scripts/drafts.ts';
import { buildTrades } from '../../scripts/trades.ts';
import { buildHist, careers } from './history.ts';
import { buildIndex } from './league.ts';
import { buildDraftBook } from './drafts.ts';
import { bestAndWorstBuilders, builderCareers, ranked } from './builders.ts';

const dir = new URL('../../data/history', import.meta.url).pathname;
const h = buildHistory(dir);
// The frozen fixture supplies the live 2026 season, so co-owned 2026 seats resolve and the
// numbers below do not move with a weekly data push.
const ds = JSON.parse(readFileSync(new URL('../../test/fixtures/fwhl-2026-11-10.json', import.meta.url), 'utf8')) as Dataset;
const H = buildHist(h, buildIndex(ds));
const book = buildDraftBook(buildDrafts(h, dir).drafts, undefined, buildTrades(h, dir).trades);
const bs = builderCareers(H, book, careers(H));
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
  // Realized value (Nov 18): only weeks a pick spent with his drafter (or a team he was traded to) count.
  assert.equal(bestAndWorstBuilders(lifers, 'keeper').worst!.owner, 'chandler-hovik', 'the best drafter is the worst keeper');
  assert.equal(bestAndWorstBuilders(lifers, 'keeper').best!.owner, 'wes-anderson');
  // Scoring index is finished seasons only, so it is stable.
  assert.equal(bestAndWorstBuilders(lifers, 'index').best!.owner, 'nick-heisterkamp');
  assert.equal(who('nick-heisterkamp').index, 1.077);
});

test('keepers are judged against that season\'s keeper market, not the open auction', () => {
  const lifers = bs.filter((b) => b.lifer);
  // The keeper price is a rule, so the whole field swings by year. Priced against what their finish
  // costs at auction (keepers' inflation included), most keepers come out ahead in raw dollars;
  // against the other keepers that season about half the managers are above even.
  assert.ok(lifers.filter((b) => (b.keeperAbs ?? 0) > 0).length >= 8, 'raw dollars: keeping usually pays');
  assert.ok(lifers.filter((b) => (b.keeper ?? 0) > 0).length >= 7, 'the relative figure splits the field');
  // Hovik and Braedyn are the two lowest either way.
  const worstAbs = [...lifers].sort((a, b) => (a.keeperAbs ?? 0) - (b.keeperAbs ?? 0)).slice(0, 2).map((b) => b.owner).sort();
  assert.deepEqual(worstAbs, ['braedyn-jones', 'chandler-hovik']);
  // Every keeper beating its own season's average is counted, and the rate agrees with the count.
  for (const b of lifers) if (b.beatRate !== null) assert.equal(b.beatRate, b.beat / b.keepers);
  assert.ok(ranked(who('travis-mattson'), 'keeper'));
  assert.ok(who('wes-anderson').beatRate! > who('travis-mattson').beatRate!, 'Wes is right more often, and by more');
});
