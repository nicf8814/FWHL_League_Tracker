// Trade history checks. Run with `npm test`. Built from data/history (trades, lineups, drafts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTrades } from '../data/trades.ts';
import { buildHistory } from '../../scripts/history.ts';
import { buildTrades, formatTrades } from '../../scripts/trades.ts';
import { bestLineup, parseSlots } from './tradeHistory.ts';

const dir = new URL('../../data/history', import.meta.url).pathname;
const h = buildHistory(dir);
const { trades, report } = buildTrades(h, dir);
const name = (p: number) => trades.players[p]![0];
const find = (y: number, who: string, player: string) => trades.trades.find((t) => t.year === y && t.sides.some((s) => s.owner === who && s.gets.some((g) => name(g.p) === player)))!;

test('lineup slots and the best lineup', () => {
  const slots = parseSlots('BE x6, IR x1, QB x1, RB x2, RB/WR/TE x1, WR x2, WR/TE x1');
  assert.equal(slots.length, 7);
  const pts = bestLineup(slots, [{ pos: 'QB', pts: 20 }, { pos: 'RB', pts: 15 }, { pos: 'RB', pts: 10 }, { pos: 'RB', pts: 9 }, { pos: 'WR', pts: 12 }, { pos: 'WR', pts: 8 }, { pos: 'WR', pts: 7 }, { pos: 'TE', pts: 6 }, { pos: 'QB', pts: 30 }]);
  assert.equal(pts, 30 + 15 + 10 + 12 + 8 + 9 + 7, 'flex takes the best leftover RB, WR/TE the best leftover WR');
});

test('every trade 2018-2025, both platforms, owners matched', () => {
  assert.equal(trades.trades.length, 77);
  assert.ok(validateTrades(JSON.parse(formatTrades(trades))).ok);
  assert.equal(trades.trades.filter((t) => t.confidence === 'likely').length, 28);
  assert.ok(trades.trades.every((t) => t.year >= 2018 && t.year <= 2025), 'the live season stays on the Tracker');
  assert.ok(report.unseen.length <= 2);
});

test('with the trade left in, the replay reproduces every official record', () => {
  for (const t of trades.trades) for (const s of t.sides) {
    const off = h.seasons.find((x) => x.year === t.year)!.teams.find((x) => x.owner === s.owner)!;
    assert.equal(`${s.record.w}-${s.record.l}`, `${off.w}-${off.l}`, `${t.id} ${s.owner}`);
  }
});

test('2024 Week 9: Tommy & Nick got Jacobs and A.J. Brown from Nic', () => {
  const t = find(2024, 'tommy-teves', 'Josh Jacobs');
  const [tom, nic] = t.sides[0].owner === 'tommy-teves' ? t.sides : [t.sides[1], t.sides[0]];
  assert.equal(tom.grade, 'A+');
  assert.equal(nic.grade, 'F');
  assert.ok(nic.alt.playoffs && !nic.record.playoffs, 'undone, Nic makes the playoffs');
  assert.equal(tom.path[0], tom.initGrade);
  assert.equal(tom.path.at(-1), tom.grade);
});

test('2020 Week 8: the Kelce trade is found from the rosters and graded', () => {
  const t = find(2020, 'ty-carlson', 'Travis Kelce');
  assert.equal(t.confidence, 'likely');
  const ty = t.sides.find((s) => s.owner === 'ty-carlson')!, dm = t.sides.find((s) => s.owner === 'david-morris')!;
  assert.ok(ty.score! > 0 && dm.score! < 0);
  assert.ok(dm.kept.some((k) => name(k.p) === 'Patrick Mahomes'), 'Morris kept Mahomes in 2021');
});

test('budget-only swaps are listed but not graded', () => {
  const faab = trades.trades.filter((t) => t.sides.every((s) => !s.gets.length));
  assert.equal(faab.length, 2);
  assert.ok(faab.every((t) => t.sides.every((s) => s.grade === null)));
});
