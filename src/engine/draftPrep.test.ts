// Draft prep checks. Run with `npm test`. Uses data/draft-prep/ and the built history seeds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { validateDraftPrep, type DraftPrep, type PrepPos } from '../data/draftPrep.ts';
import { buildDraftPrep, formatDraftPrep } from '../../scripts/draftPrep.ts';
import { fitFlex, priceBoard, ranks, replacementRanks, tierIndex } from './draftPrep.ts';

const tiers = (factor = 1) => ({ upTo: 999, label: 'All', factor, n: 10 });
function tiny(keepers: DraftPrep['keepers'] = []): DraftPrep {
  const board: DraftPrep['board'] = [];
  for (const [pos, n, top] of [['QB', 30, 300], ['RB', 60, 250], ['WR', 80, 240], ['TE', 30, 180]] as [PrepPos, number, number][]) {
    for (let i = 0; i < n; i++) board.push([`${pos} ${i + 1}`, pos, 'XX', top - i * 4, Math.max(0, 40 - i * 2)]);
  }
  return {
    version: 1, year: 2027, teams: 12, budget: 200, roster: 13, source: 'test', board, keepers,
    fit: {
      marketYears: [[2026, 4]], tiers: { QB: [tiers()], RB: [tiers()], WR: [tiers()], TE: [tiers()] },
      projYears: [2018], shrink: { QB: 1, RB: 1, WR: 1, TE: 1 }, miss: { QB: 0.3, RB: 0.3, WR: 0.3, TE: 0.3 },
      flex: { years: [2025], flexRB: 0.5, flexWR: 0.4, flexTE: 0.1, recWR: 0.7, recTE: 0.3 },
      slotYears: [2025], slots: { QB: [[1, 999]], RB: [[1, 999]], WR: [[1, 999]], TE: [[1, 999]] },
    },
  };
}

test('ranks share ties and tiers follow the cutoffs', () => {
  assert.deepEqual(ranks([63, 63, 51, 40]), [1, 1, 3, 4]);
  assert.equal(tierIndex('RB', 6), 0);
  assert.equal(tierIndex('RB', 7), 1);
  assert.equal(tierIndex('RB', 30), 3);
});

test('flex shares and replacement ranks come from lineup starts', () => {
  const f = fitFlex([{ slot: 'FLEX', pos: 'RB', n: 5 }, { slot: 'FLEX', pos: 'WR', n: 4 }, { slot: 'FLEX', pos: 'TE', n: 1 }, { slot: 'REC_FLEX', pos: 'WR', n: 7 }, { slot: 'WR/TE', pos: 'TE', n: 3 }], [2025]);
  assert.deepEqual([f.flexRB, f.flexWR, f.flexTE, f.recWR, f.recTE], [0.5, 0.4, 0.1, 0.7, 0.3]);
  assert.deepEqual(replacementRanks({ ...tiny().fit, flex: f }, 12), { QB: 12, RB: 30, WR: 37, TE: 5 });
});

test('cost and worth each spend the money left after keepers', () => {
  const b = priceBoard(tiny());
  assert.equal(b.moneyLeft, 2400);
  assert.equal(b.openSlots, 156);
  const open = b.rows.filter((r) => !r.keeper);
  const top = (key: 'cost' | 'worth') => [...open].sort((x, y) => y[key] - x[key]).slice(0, b.openSlots).reduce((s, r) => s + r[key], 0);
  assert.ok(Math.abs(top('cost') - 2400) < 5, `cost sums to ${top('cost')}`);
  assert.ok(Math.abs(top('worth') - 2400) < 5, `worth sums to ${top('worth')}`);
  for (const r of b.rows) assert.equal(r.edge, Math.round((r.worth - r.cost) * 10) / 10);
});

test('a cheap keeper pushes everyone else up; an expensive one pulls them down', () => {
  const none = priceBoard(tiny()), wr = (b: ReturnType<typeof priceBoard>) => b.rows.find((r) => r.name === 'WR 2')!.cost;
  const cheap = priceBoard(tiny(), [['RB 1', 'RB', 5, 'x']]);
  const dear = priceBoard(tiny(), [['RB 1', 'RB', 90, 'x']]);
  assert.equal(cheap.keeperSpend, 5);
  assert.ok(wr(cheap) > wr(none) && wr(dear) < wr(none), `${wr(cheap)} > ${wr(none)} > ${wr(dear)}`);
  assert.ok(cheap.rows.find((r) => r.name === 'RB 1')!.keeper);
});

test('no cost or ceiling above what the league has paid for that slot', () => {
  const prep = tiny();
  prep.fit.slots = { QB: [[30, 40]], RB: [[70, 82], [60, 75]], WR: [[60, 89]], TE: [[10, 20]] };
  const b = priceBoard(prep);
  const rb = b.rows.filter((r) => r.pos === 'RB').sort((x, y) => y.cost - x.cost);
  assert.deepEqual([rb[0]!.floor, rb[0]!.ceiling], [Math.round(Math.min(70, rb[0]!.cost)), 82]);
  assert.ok(rb[0]!.cost <= 82 && rb[1]!.cost <= 75);
  for (const r of b.rows) assert.ok(r.floor <= Math.max(1, r.cost) + 0.5 && r.cost <= r.ceiling + 0.5, `${r.name} ${r.floor} ${r.cost} ${r.ceiling}`);
});

test('the 2026 board builds, validates and prices the studs on top', () => {
  const { prep, report } = buildDraftPrep(2026);
  const v = validateDraftPrep(JSON.parse(formatDraftPrep(prep)));
  assert.ok(v.ok, v.ok ? '' : v.errors.join('; '));
  assert.equal(report.keepers, 19);
  assert.deepEqual(report.keepersNotOnBoard, []);
  assert.deepEqual(prep.fit.marketYears, [[2025, 4]]);
  const seed = JSON.parse(readFileSync('public/seed/draft-prep.json', 'utf8')) as DraftPrep;
  assert.equal(formatDraftPrep(seed), formatDraftPrep(prep), 'public/seed/draft-prep.json is out of date: npm run data -- draftprep 2026');
  const b = priceBoard(prep);
  const cost = (n: string) => b.rows.find((r) => r.name === n)!.cost;
  assert.ok(cost('Jahmyr Gibbs') > cost('Christian McCaffrey') && cost('Christian McCaffrey') > cost('Josh Allen'));
  assert.equal(b.keeperSpend, 560);
  const top = Math.max(...b.rows.map((r) => r.ceiling));
  assert.ok(top <= 100, `highest ceiling ${top}`);
});
