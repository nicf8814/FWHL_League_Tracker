// All-time players, traders and keeper picks. Run with `npm test`. Built from data/history.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateCareers } from '../data/careers.ts';
import { buildHistory } from '../../scripts/history.ts';
import { buildLineups } from '../../scripts/lineups.ts';
import { buildDrafts } from '../../scripts/drafts.ts';
import { buildTrades } from '../../scripts/trades.ts';
import { buildCareers, formatCareers } from '../../scripts/careers.ts';
import { buildCareerBook, ringLeaders, ringRosters } from './careers.ts';
import { buildDraftBook } from './drafts.ts';
import { bestAndWorst, historyLines, traderCareers } from './traders.ts';
import { bestAndWorstKeepers, keeperBets, keeperCareers } from './keeperSkill.ts';

const dir = new URL('../../data/history', import.meta.url).pathname;
const h = buildHistory(dir);
const L = buildLineups(h, `${dir}/rosters`);
const { careers } = buildCareers(h, L);
const book = buildCareerBook(careers);
const who = (name: string) => book.players.find((p) => p.name === name)!;

test('the careers file covers every finished season and validates', () => {
  assert.equal(careers.through, 2025);
  assert.ok(validateCareers(JSON.parse(formatCareers(careers))).ok);
  assert.deepEqual(careers.full, [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025], 'bench detail starts in 2018');
  const years = new Set(careers.rows.map((r) => r[1]));
  assert.deepEqual([...years].sort((a, b) => a - b), Array.from({ length: 16 }, (_, i) => 2010 + i));
  assert.equal(book.live, null, 'no live season unless the seed is handed in');
});

test('a career adds up its seasons, and one player is one row across them', () => {
  const rodgers = who('Aaron Rodgers');
  assert.equal(rodgers.pos, 'QB');
  assert.equal(rodgers.years.length, 16, 'on a roster every season since 2010');
  assert.equal(rodgers.first, 2010);
  assert.equal(rodgers.last, 2025);
  const byHand = rodgers.seasons.reduce((a, s) => a + s.startPts, 0);
  assert.ok(Math.abs(rodgers.startPts - byHand) < 0.01);
  assert.equal(rodgers.weeks, rodgers.seasons.reduce((a, s) => a + s.weeks, 0));
  assert.ok(Math.abs(rodgers.ppw! - rodgers.startPts / rodgers.weeks) < 0.01);
  // Starter points are the all-time number because 2010-2017 kept no bench.
  assert.ok(rodgers.seasons.filter((s) => s.year < 2018).every((s) => s.benchPts === null && s.rosterWeeks === null));
  assert.ok(rodgers.seasons.filter((s) => s.year >= 2018).every((s) => s.benchPts !== null && s.rosterWeeks !== null));
});

test('championship rosters: counted once a season, and only for the winner', () => {
  const champs = new Map(h.seasons.map((s) => [s.year, s.podium[0]!]));
  for (const p of book.players)
    for (const s of p.seasons) if (s.ring) assert.equal(s.owner, champs.get(s.year), `${p.name} ${s.year}`);
  for (const p of book.players) assert.equal(p.rings, new Set(p.ringYears).size);
  const leaders = ringLeaders(book, 5);
  assert.equal(leaders[0]!.rings, 3);
  assert.ok(leaders.map((p) => p.name).includes('Aaron Rodgers'));
  // Every title in the league's history has a roster behind it.
  const rosters = ringRosters(book);
  assert.equal(rosters.length, 16);
  for (const r of rosters) assert.ok(r.players.length >= 13 && r.players.length <= 20, `${r.year}: ${r.players.length}`);
});

test('traders: one line per side, and a career averages its grades', () => {
  const { trades } = buildTrades(h, dir, L);
  const lines = historyLines(trades);
  assert.equal(lines.length, trades.trades.length * 2);
  const cs = traderCareers(lines);
  assert.equal(cs.reduce((a, c) => a + c.trades, 0), lines.length);
  for (const c of cs) {
    const graded = c.lines.filter((l) => l.score !== null);
    if (!graded.length) { assert.equal(c.score, null); continue; }
    const avg = graded.reduce((a, l) => a + l.score!, 0) / graded.length;
    assert.ok(Math.abs(c.score! - avg) < 0.002, c.owner);
    assert.equal(c.wins + c.losses <= c.graded, true);
  }
  // Both sides of one trade are mirror images on raw points.
  const t = trades.trades[0]!;
  const [a, b] = lines.filter((l) => l.id === t.id);
  assert.ok(Math.abs((a!.rawGot! - a!.rawGave!) + (b!.rawGot! - b!.rawGave!)) < 0.01);
  const { best, worst } = bestAndWorst(cs, 'score');
  assert.ok(best && worst && best.score! > worst.score!);
  assert.ok(best.trades >= 3 && worst.trades >= 3, 'a one-trade owner is not the league best');
});

test('keeper picks: value is worth minus price, and points over replacement never goes negative', () => {
  const { drafts } = buildDrafts(h, dir, L);
  const db = buildDraftBook(drafts);
  const bets = keeperBets(db);
  assert.ok(bets.length > 300);
  assert.ok(bets.every((b) => b.pick.keeper));
  for (const b of bets) {
    if (b.value !== null) assert.equal(b.value, b.worth! - b.price);
    if (b.par !== null) assert.ok(b.par >= 0);
    assert.equal(b.hit, (b.value ?? 0) > 0);
  }
  const cs = keeperCareers(bets);
  assert.equal(cs.reduce((a, c) => a + c.keepers, 0), bets.length);
  for (const c of cs) {
    assert.equal(c.hits + c.misses, c.scored);
    if (c.value !== null) assert.ok(Math.abs(c.value - c.bets.filter((b) => b.value !== null).reduce((a, b) => a + b.value!, 0)) < 0.5, c.owner);
  }
  const { best, worst } = bestAndWorstKeepers(cs, 'value');
  assert.ok(best && worst && best.value! > worst.value!);
  assert.ok(best.scored >= 3 && worst.scored >= 3);
});
