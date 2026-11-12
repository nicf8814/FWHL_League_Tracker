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
  assert.ok(owners(2024).has('clint-helling'), 'braejones12 is the filler team');
  assert.ok(owners(2025).has('chris-walker'), 'BaryGusey is Chris Walker');
  assert.ok(owners(2022).has('tommy-teves'), 'the co-owned team drafts under Tommy');
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

test('value: bargains and busts, keepers priced at their keeper cost', () => {
  assert.equal(pick('Arian Foster', 2010).value, 82);
  assert.ok(pick("Le'Veon Bell", 2018).value! < -90);
  // Non-keepers set the going rate, so their values sum to about zero each season.
  for (const y of book.years.filter((y) => y < 2026)) {
    const open = book.byYear.get(y)!.filter((x) => !x.keeper && x.value !== null);
    const above = open.filter((x) => x.pts! > book.basis.get(y)!.repl[x.pos]!);
    const sum = above.reduce((a, x) => a + x.worth! - 1, 0), paid = open.reduce((a, x) => a + x.price - 1, 0);
    assert.ok(Math.abs(sum - paid) / paid < 0.05, `${y}: worth above $1 tracks dollars above $1`);
  }
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
