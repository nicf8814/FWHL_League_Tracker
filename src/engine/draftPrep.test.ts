// Draft prep checks. Run with `npm test`. Uses data/draft-prep/ and the built history seeds.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NEXT_UNPRICED, validateDraftPrep, type DraftPrep, type NextSample, type PrepPos, type StandIn } from '../data/draftPrep.ts';
import { buildDraftPrep, formatDraftPrep } from '../../scripts/draftPrep.ts';
import { fitFlex, nextRank, priceBoard, ranks, replacementRanks, standInBoard, tierIndex } from './draftPrep.ts';

const tiers = (factor = 1) => ({ upTo: 999, label: 'All', factor, n: 10 });
function tiny(keepers: DraftPrep['keepers'] = []): DraftPrep {
  const board: DraftPrep['board'] = [];
  for (const [pos, n, top] of [['QB', 30, 300], ['RB', 60, 250], ['WR', 80, 240], ['TE', 30, 180]] as [PrepPos, number, number][]) {
    for (let i = 0; i < n; i++) board.push([`${pos} ${i + 1}`, pos, 'XX', top - i * 4, Math.max(0, 40 - i * 2)]);
  }
  return {
    year: 2027, kind: 'board', teams: 12, budget: 200, roster: 13, source: 'test', board, keepers,
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

test('an overbid in my plan makes everyone left cheaper; a bargain makes them dearer', () => {
  const wr = (b: ReturnType<typeof priceBoard>) => b.rows.find((r) => r.name === 'WR 2')!.cost;
  const none = priceBoard(tiny());
  const fair = none.rows.find((r) => r.name === 'RB 1')!.cost;
  const over = priceBoard(tiny(), [], { 'rb1|RB': fair + 30 }), under = priceBoard(tiny(), [], { 'rb1|RB': Math.max(1, fair - 30) });
  assert.equal(over.moneyLeft, 2400 - fair - 30);
  assert.equal(over.openSlots, 155);
  assert.ok(wr(over) < wr(none) && wr(under) > wr(none), `${wr(over)} < ${wr(none)} < ${wr(under)}`);
  assert.equal(over.rows.find((r) => r.name === 'RB 1')!.bought, fair + 30);
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

test('a season lost to injury drops a player further than a full one', () => {
  const samples: NextSample[] = [];
  for (let i = 0; i < 12; i++) for (const r of [1, 2, 3, 4, 5, 6]) {
    samples.push(['RB', r, 0.95, r + 1]); // full seasons: priced about one spot lower
    samples.push(['RB', r, 0.3, r * 3]); // lost seasons: priced about three times lower
  }
  const full = nextRank(samples, 'RB', 2, 0.9), lost = nextRank(samples, 'RB', 2, 0.25);
  assert.ok(full.mid <= 3 && lost.mid >= 5, `full ${full.mid}, lost ${lost.mid}`);
  assert.ok(lost.lo <= lost.mid && lost.mid <= lost.hi);
  assert.equal(nextRank([], 'TE', 4, 1).mid, 4);
});

test('the stand-in ranks 70% on production, 30% on trade value, and prices that rank', () => {
  const si: StandIn = {
    fromYear: 2026, curveYear: 2026, sampleYears: [[2025, 2026]],
    curve: { QB: { price: [30, 20], proj: [400, 380] }, RB: { price: [80, 60, 40, 20], proj: [400, 350, 300, 250] }, WR: { price: [70], proj: [300] }, TE: { price: [10], proj: [200] } },
    samples: Array.from({ length: 40 }, (_, i) => ['RB', 1 + (i % 4), 1, 1 + (i % 4)] as NextSample),
  };
  const line = (name: string, ppg: number | null, value: number | null, games = 10) => ({ name, pos: 'RB' as PrepPos, team: 'X', ppg, games, share: 1, value });
  // A leads on production, B on value; C has only a trade value (too few games).
  const { board, rows } = standInBoard(si, [line('A', 30, 50), line('B', 20, 90), line('C', 25, 70, 2), line('D', 10, 10)]);
  const at = (n: string) => rows.get(`${n.toLowerCase()}|RB`)!;
  assert.equal(at('A').today, 1);
  assert.equal(at('C').ppgRank, null);
  assert.deepEqual(board.find((b) => b[0] === 'A')!.slice(3), [400, 80]);
  assert.ok(NEXT_UNPRICED > 60);
});

test('the board file builds, validates and matches the seed', () => {
  const { file, report } = buildDraftPrep();
  const v = validateDraftPrep(JSON.parse(formatDraftPrep(file)));
  assert.ok(v.ok, v.ok ? '' : v.errors.join('; '));
  assert.deepEqual(report.keepersNotOnBoard, []);
  assert.deepEqual(file.editions.map((e) => `${e.year} ${e.kind}`), ['2026 board', '2027 standin']);
  const seed = JSON.parse(readFileSync('public/seed/draft-prep.json', 'utf8'));
  assert.equal(formatDraftPrep(seed), formatDraftPrep(file), 'public/seed/draft-prep.json is out of date: npm run data -- draftprep');
  const live = file.editions[1]!;
  assert.deepEqual(live.fit.marketYears.map(([y]) => y), [2025, 2026]);
  assert.ok(live.standIn!.samples.length > 1000);
});

test('the 2026 board builds, validates and prices the studs on top', () => {
  const prep = buildDraftPrep().file.editions.find((e) => e.year === 2026)!;
  assert.equal(prep.keepers.length, 19);
  assert.deepEqual(prep.fit.marketYears, [[2025, 4]]);
  const b = priceBoard(prep);
  const cost = (n: string) => b.rows.find((r) => r.name === n)!.cost;
  assert.ok(cost('Jahmyr Gibbs') > cost('Christian McCaffrey') && cost('Christian McCaffrey') > cost('Josh Allen'));
  assert.equal(b.keeperSpend, 560);
  const top = Math.max(...b.rows.map((r) => r.ceiling));
  assert.ok(top <= 100, `highest ceiling ${top}`);
});

test('a plan places keepers first, fills the tightest slot and enforces the money rules', async () => {
  const { placePlan } = await import('./rosterPlan.ts');
  const p = (name: string, pos: PrepPos, bid: number, keeper = false) => ({ key: name, name, pos, bid, keeper });
  const s = placePlan([p('W1', 'WR', 60), p('T1', 'TE', 5), p('K', 'RB', 30, true), p('W2', 'WR', 40), p('W3', 'WR', 20)]);
  const at = (id: string) => s.placed.find((x) => x.slot.id === id)!.pick?.name;
  assert.equal(at('RB1'), 'K');
  assert.deepEqual([at('WR1'), at('WR2'), at('WRTE'), at('FLEX')], ['W1', 'W2', 'W3', 'T1']);
  assert.equal(s.spent, 155);
  assert.equal(s.open, 8);
  assert.equal(s.maxBid, 45 - 7);
  const broke = placePlan([p('A', 'RB', 190), p('B', 'RB', 5), p('C', 'RB', 1), p('D', 'RB', 1), p('E', 'RB', 1), p('F', 'RB', 1)]);
  assert.ok(broke.problems.some((x) => x.includes('limit is 5')));
  assert.ok(broke.problems.some((x) => x.includes("can't fill")));
});

test('no bid can break the max-bid rule', async () => {
  const { maxBidFor } = await import('./rosterPlan.ts');
  const p = (name: string, bid: number) => ({ key: name, name, pos: 'WR' as PrepPos, bid, keeper: false });
  const picks = [p('A', 96), p('B', 64), p('C', 25)];
  assert.equal(maxBidFor(picks, null), 15 - 9); // a new player: $15 left, 9 other spots after him
  assert.equal(maxBidFor(picks, 'C'), 40 - 10); // C's own bid back in: $40 left, 10 other spots
  assert.equal(maxBidFor(Array.from({ length: 13 }, (_, i) => p(`X${i}`, 1)), null), 0); // roster full
  const { posFull } = await import('./rosterPlan.ts');
  const rbs = Array.from({ length: 5 }, (_, i) => ({ ...p(`R${i}`, 1), pos: 'RB' as PrepPos }));
  assert.ok(posFull(rbs, 'RB') && !posFull(rbs, 'WR') && !posFull(rbs, 'TE'));
  const twelve = Array.from({ length: 12 }, (_, i) => ({ ...p(`W${i}`, 1), pos: (i < 5 ? 'RB' : i < 10 ? 'WR' : 'TE') as PrepPos }));
  assert.ok(posFull(twelve, 'WR') && !posFull(twelve, 'QB'), 'the last spot is the QB\'s');
});

test('swaps offer same-position players near his price, best gain first', async () => {
  const { swapOptions } = await import('./autoFill.ts');
  const board = priceBoard(tiny()).rows;
  const keyOf = (r: { name: string; pos: string }) => `${r.name}|${r.pos}`;
  const wr = board.find((r) => r.name === 'WR 10')!;
  const picks = [{ key: 'WR 10|WR', name: 'WR 10', pos: 'WR' as PrepPos, bid: Math.round(wr.cost), keeper: false }];
  const opts = swapOptions(board, picks, 'WR 10|WR', new Set(['WR 9|WR']), keyOf);
  assert.ok(opts.length > 0 && opts.length <= 3);
  assert.ok(opts.every((o) => o.row.pos === 'WR' && o.row.name !== 'WR 10' && o.row.name !== 'WR 9' && o.dCost <= 10));
  assert.ok(opts.every((o, i) => i === 0 || opts[i - 1]!.dVorp >= o.dVorp));
});

test('auto-fill builds a full, legal roster for every button', async () => {
  const { autoFill, STRATEGIES } = await import('./autoFill.ts');
  const { placePlan } = await import('./rosterPlan.ts');
  const board = priceBoard(tiny(), [['RB 3', 'RB', 20, 'me']]).rows;
  const keyOf = (r: { name: string; pos: string }) => `${r.name}|${r.pos}`;
  const kept = { key: 'RB 3|RB', name: 'RB 3', pos: 'RB' as PrepPos, bid: 20, keeper: true };
  const locked = { key: 'WR 5|WR', name: 'WR 5', pos: 'WR' as PrepPos, bid: 15, keeper: false };
  const avoid = new Set(['WR 1|WR', 'QB 1|QB']);
  for (const st of STRATEGIES) {
    const out = autoFill(board, [kept, locked], st.id, avoid, keyOf);
    const s = placePlan(out);
    assert.equal(out.length, 13, st.id);
    assert.deepEqual(s.problems, [], st.id);
    assert.ok(s.spent <= 200, `${st.id} spent ${s.spent}`);
    assert.ok(out.some((p) => p.key === 'RB 3|RB') && out.some((p) => p.key === 'WR 5|WR'), `${st.id} kept the keeper and the lock`);
    assert.ok(!out.some((p) => avoid.has(p.key)), `${st.id} skipped the avoided`);
    const bought = out.filter((p) => !p.keeper && p.key !== 'WR 5|WR');
    if (st.id === 'balanced') assert.ok(bought.every((p) => p.bid <= 50));
  }
});

test('mock auctions: seeded, a higher bid never gets less, and persona habits show', async () => {
  const { simulate } = await import('./mockAuction.ts');
  const board = priceBoard(tiny()).rows;
  const keyOf = (r: { name: string; pos: string }) => `${r.name}|${r.pos}`;
  const persona = (key: string, rb: number) => ({ key, name: key, teamId: 0, lean: { QB: 1, RB: rb, WR: 1, TE: 1 }, overpay: 1, stars: 1, fav: [], drafts: 5 });
  const teams = Array.from({ length: 11 }, (_, i) => ({ name: `T${i}`, budget: 200, filled: {}, persona: persona(`T${i}`, i === 0 ? 1.6 : 1) }));
  const a = simulate(board, teams, (r) => Math.round(r.cost), keyOf, ['RB 1|RB'], 60);
  const b = simulate(board, teams, (r) => Math.round(r.cost), keyOf, ['RB 1|RB'], 60);
  assert.deepEqual([...a.players.get('RB 1|RB')!.buyers], [...b.players.get('RB 1|RB')!.buyers], 'same seed, same result');
  const rich = simulate(board, teams, (r) => Math.round(r.cost) + 15, keyOf, [], 60);
  for (const k of ['RB 1|RB', 'WR 1|WR', 'QB 1|QB']) assert.ok(rich.players.get(k)!.get >= a.players.get(k)!.get, k);
  assert.equal(a.players.get('RB 1|RB')!.buyers[0]![0], 'T0', 'the RB-heavy owner buys the top RB most');
  assert.ok(a.planOdds !== null && a.planOdds >= 0 && a.planOdds <= 1);
});
