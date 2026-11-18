// Draft history checks. Run with `npm test`. Built from the exports in data/history/drafts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Dataset } from '../data/schema.ts';
import { validateDrafts } from '../data/drafts.ts';
import { buildHistory } from '../../scripts/history.ts';
import { buildDrafts, formatDrafts } from '../../scripts/drafts.ts';
import { buildDraftBook, posRank } from './drafts.ts';
import { buildIndex } from './league.ts';

const dir = new URL('../../data/history', import.meta.url).pathname;
const h = buildHistory(dir);
const { drafts, report } = buildDrafts(h, dir);
const book = buildDraftBook(drafts);
const pick = (name: string, y: number) => book.picks.find((x) => x.name === name && x.year === y)!;

test('every draft since 2010, every owner and Sleeper account matched', () => {
  assert.equal(drafts.picks.length, 3000);
  assert.deepEqual(book.years, Array.from({ length: 17 }, (_, i) => 2010 + i));
  assert.deepEqual(report.unmatched, []);
  assert.ok(validateDrafts(JSON.parse(formatDrafts(drafts))).ok);
  const owners = (y: number) => new Set(book.byYear.get(y)!.map((x) => x.owner));
  assert.ok(owners(2024).has('braedyn-jones'), 'braejones12 is Braedyn Jones');
  assert.ok(owners(2025).has('chris-walker'), 'BaryGusey is Chris Walker');
  assert.ok(owners(2022).has('tommy-teves'), 'the co-owned team drafts under Tommy');
});

test('2024 keepers come from the league keeper list, not the Sleeper flag', () => {
  const kept = book.byYear.get(2024)!.filter((x) => x.keeper);
  assert.equal(kept.length, 30);
  assert.ok(pick('Kyren Williams', 2024).keeper, 'unflagged in the Sleeper export');
  assert.ok(pick('Tee Higgins', 2024).keeper, 'flagged in the export too');
  assert.ok(!pick('Christian McCaffrey', 2024).keeper, 'drafted among the keeper rows, not kept');
});

test('value: Kelce 2020 worked through by hand', () => {
  const k = pick('Travis Kelce', 2020);
  const b = book.basis.get(2020)!;
  assert.equal(k.price, 49);
  assert.equal(Math.round(b.repl.TE!), 84);
  assert.equal(b.dollarsPerPoint.toFixed(2), '0.45');
  assert.equal(k.worth, 56);
  assert.equal(k.value, 7);
  assert.equal(posRank(book, k), 1);
  assert.deepEqual(k.held!.map((x) => [x.owner, x.from]), [['david-morris', 1], ['ty-carlson', 8]], 'traded to Ty in week 8');
});

test('value: worth is what his finish costs at auction, by position', () => {
  // Worth is the price curve at his finish: RB1 is worth the RB1 slot, averaged over that draft and the ones either side.
  const dj = pick('David Johnson', 2016), b = book.basis.get(2016)!;
  assert.equal(posRank(book, dj), 1);
  assert.equal(dj.worth, Math.round(b.curve.RB![0]!));
  assert.deepEqual([dj.keeper, dj.price, dj.worth, dj.value], [true, 11, 83, 72], 'the best keeper of the ESPN years');
  assert.equal(pick('Arian Foster', 2010).value, 66);
  assert.ok(pick("Le'Veon Bell", 2018).value! < -90);
  // QBs and kickers are priced off their own, cheaper curves: a $2 QB season is no longer a +$75 steal.
  assert.ok(pick('Dak Prescott', 2023).value! < 30);
  assert.ok(pick('Bears D/ST', 2012).value! < 10);
  // Keepers sit in the curve at what they would have cost at auction, so kept stars don't push
  // auctioned players up a slot; the curve falls as the slots go down.
  for (const pos of ['QB', 'RB', 'WR', 'TE']) { const c = b.curve[pos]!; assert.ok(c.every((v, i) => i === 0 || v <= c[i - 1]!), `${pos} curve falls`); }
  assert.ok(b.inflation! > 1.3, '2016 paid 44% over market for auctioned players');
});

test('value: points for his price', () => {
  const dj = pick('David Johnson', 2016);
  assert.ok(dj.xPts! > 80 && dj.xPts! < 110, 'an $11 RB usually scores about 95');
  assert.ok(dj.pts! - dj.xPts! > 200);
  assert.equal(pick('Jaxon Smith-Njigba', 2026)?.xPts ?? null, null, 'not for a season still being played');
});

test('Sleeper seasons: points come from the lineups, projections are labelled hindsight', () => {
  const s = book.seasons.get(2024)!;
  assert.equal(s.pts, 'rostered');
  assert.equal(s.proj, 'sleeper');
  assert.ok(pick('Travis Kelce', 2024).pts! > 180);
});

test('the live season follows the league seed', () => {
  const ds = JSON.parse(readFileSync(new URL('../../test/fixtures/fwhl-2026-11-10.json', import.meta.url), 'utf8')) as Dataset;
  const idx = buildIndex(ds);
  const byTeam = new Map(h.owners.filter((o) => o.teamId !== null && !o.filler).map((o) => [o.teamId!, o.key]));
  const live = buildDraftBook(drafts, { year: 2026, idx, teamOwner: (t) => byTeam.get(t) });
  const started = live.byYear.get(2026)!.filter((x) => x.held && x.held.some((hh) => hh.started > 0));
  assert.ok(started.length > 100, `${started.length} 2026 picks have weekly use from the seed`);
  assert.equal(live.seasons.get(2026)!.pts, 'to-date');
});
