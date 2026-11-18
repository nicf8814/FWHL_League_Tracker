// Trade history checks. Run with `npm test`. Built from data/history (trades, lineups, drafts).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateTrades } from '../data/trades.ts';
import { buildHistory } from '../../scripts/history.ts';
import { buildTrades, formatTrades, seasonRules } from '../../scripts/trades.ts';
import { bestLineup, parseSlots, standings, type SeasonInput } from './tradeHistory.ts';

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

test('playoff rules by season give the real playoff field (but 2011)', () => {
  for (const s of h.seasons) {
    const S = { playoffTeams: s.playoffTeams, rules: seasonRules(dir, s.year), games: s.games.filter((g) => g[0] <= s.regularWeeks).map(([week, home, away, hs, as]) => ({ week, home, away, hs, as })) } as SeasonInput;
    const st = standings(S, (_w, _o, r) => r);
    const real = s.teams.filter((t) => t.finish !== null && t.finish <= s.playoffTeams).map((t) => t.owner).sort();
    const ours = s.teams.filter((t) => st(t.owner).playoffs).map((t) => t.owner).sort();
    if (s.year === 2011) assert.notDeepEqual(ours, real, '2011 now fits: drop the shortcut in standings()');
    else assert.deepEqual(ours, real, String(s.year));
  }
  const tommy = find(2023, 'tommy-teves', "De'Von Achane").sides.find((x) => x.owner === 'tommy-teves')!;
  assert.deepEqual([tommy.record.w, tommy.record.l, tommy.record.seed, tommy.record.playoffs], [7, 7, 6, true], '2023: 7-7 Tommy took seed 6 on points for');
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
  assert.equal(tom.grade, 'C+', 'a fair-plus deal, but it cost a win and the bye');
  assert.equal(nic.grade, 'F');
  assert.ok(nic.alt.playoffs && !nic.record.playoffs, 'undone, Nic makes the playoffs');
  assert.deepEqual([tom.record.seed, tom.alt.seed, tom.winsGain], [4, 2, -2], 'undone, Tommy is the 2 seed with a bye');
  assert.ok(tom.prod! > 15 && tom.ptsGain! < 0, 'Jacobs scored for Ryan after Week 10: only points in Tommy\'s lineup count');
  assert.equal(tom.path[0], tom.initGrade);
  assert.equal(tom.path.at(-1), tom.grade);
});

test('2020 Week 8: the Kelce trade is found from the rosters and graded', () => {
  const t = find(2020, 'ty-carlson', 'Travis Kelce');
  assert.equal(t.confidence, 'likely');
  const ty = t.sides.find((s) => s.owner === 'ty-carlson')!, dm = t.sides.find((s) => s.owner === 'david-morris')!;
  assert.ok(ty.score! > 0.04 && dm.score! > 0.04, 'both sides won: each lineup scored more');
  assert.ok(ty.ptsGain! > 0 && dm.ptsGain! > 0);
  assert.ok(dm.kept.some((k) => name(k.p) === 'Patrick Mahomes' && k.year === 2021), 'Morris kept Mahomes in 2021');
  assert.ok(dm.keep < 0 && !ty.rights.length, 'a $37 QB keep cost more than a QB finish buys at auction: no right lost for Ty');
});

test('keepers: good and bad keeps count for the keeper, rights given up against the other side', () => {
  const t = find(2023, 'tommy-teves', "De'Von Achane");
  const tom = t.sides.find((s) => s.owner === 'tommy-teves')!, dm = t.sides.find((s) => s.owner === 'david-morris')!;
  assert.equal(tom.keep, 44, 'Tommy kept Achane in 2024 at $12: an RB4 finish, worth $56');
  assert.equal(dm.keep, -44, 'David gave up that right');
  const a = find(2023, 'travis-mattson', 'Brandon Aiyuk').sides.find((s) => s.owner === 'travis-mattson')!;
  assert.equal(a.keep, -31, 'Aiyuk kept at $32 and flopped: a loss for Travis');
  const back = find(2024, 'david-morris', "De'Von Achane").sides.find((s) => s.owner === 'david-morris')!;
  assert.ok(back.next! > 0, 'kept in 2025, Achane changed David\'s next season');
  assert.equal(back.keepFinal, false, 'his 2026 keep is still being played');
});

test('budget-only swaps are listed but not graded', () => {
  const faab = trades.trades.filter((t) => t.sides.every((s) => !s.gets.length));
  assert.equal(faab.length, 2);
  assert.ok(faab.every((t) => t.sides.every((s) => s.grade === null)));
});

test('weeks a player does not play count as even; an unfinished keeper season is not graded', () => {
  const t = find(2025, 'clint-h', 'Cam Skattebo'); // Skattebo for Garrett Wilson, both hurt after the trade
  for (const s of t.sides) {
    assert.equal(s.grade, 'C', `${s.owner}: neither played after the trade`);
    assert.equal(s.prod, 0);
    assert.equal(s.keep, 0);
    assert.equal(s.keepFinal, false, 'the 2026 keeper season is still being played');
  }
  assert.ok(t.sides.find((s) => s.owner === 'clint-h')!.kept.length === 1, 'the keeper is still shown');
});
