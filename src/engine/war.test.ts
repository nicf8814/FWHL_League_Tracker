// Matchup WAR and the auction-dollar value (Nov 22). Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type Dataset, type Pos } from '../data/schema.ts';
import { buildIndex } from './league.ts';
import { buildBase, buildValues } from './model.ts';
import { canFill, phi, projectedWar, seasonWar, swapIn, type Starter } from './war.ts';

const ds: Dataset = JSON.parse(readFileSync(new URL('../../test/fixtures/fwhl-2026-11-10.json', import.meta.url), 'utf8'));
const idx = buildIndex(ds);
const slots = ds.season.lineup as Pos[][];
const st = (pos: Pos, v: number): Starter => ({ pos, v });
const full = [st('QB', 20), st('RB', 15), st('RB', 10), st('WR', 14), st('WR', 12), st('TE', 6), st('WR', 8)];

test('lineup slots: who can fill what', () => {
  assert.ok(canFill(slots, ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'RB']));
  assert.ok(!canFill(slots, ['QB', 'QB']), 'one QB slot');
  assert.ok(!canFill(slots, ['TE', 'TE', 'TE']), 'TE only fits WR/TE and FLEX');
  assert.ok(canFill(slots, ['TE', 'TE']));
});

test('a player replaces the weakest starter he legally can', () => {
  assert.equal(swapIn(slots, full, 'RB', 30), 85 - 6 + 30, 'an RB replaces the TE (6): a WR slides to WR/TE and the RB takes FLEX');
  assert.equal(swapIn(slots, full, 'QB', 25), 85 - 20 + 25, 'a QB only replaces the QB');
  assert.equal(swapIn(slots, full.slice(0, 6), 'RB', 9), 77 + 9, 'an empty FLEX is filled, nothing replaced');
  assert.equal(swapIn(slots, full, 'QB', 5), 85 - 20 + 5, 'a worse player still swaps in (negative WAR)');
});

test('normal CDF', () => {
  assert.ok(Math.abs(phi(0) - 0.5) < 1e-9);
  assert.ok(Math.abs(phi(1.96) - 0.975) < 1e-3);
  assert.ok(Math.abs(phi(-1) + phi(1) - 1) < 1e-9);
});

test('season WAR: stars add wins, every week counted once per game played', () => {
  const w = seasonWar(idx);
  const top = [...w].sort((a, b) => b[1].war - a[1].war).slice(0, 10);
  assert.ok(top.every(([, x]) => x.war > 0.5), 'the top 10 each added half a win or more');
  for (const x of w.values()) assert.ok(x.games >= 1 && x.games <= idx.scoresThrough);
  const totals = [...w.values()].reduce((s, x) => s + x.war, 0);
  assert.ok(Number.isFinite(totals));
});

test('projected WAR is 0 for a replacement-level swap and grows with points', () => {
  const lineups = new Map([[1, full.map((x, i) => ({ ...x, pid: `a${i}` }))], [2, full.map((x, i) => ({ ...x, v: x.v + 2, pid: `b${i}` }))]]);
  const w = projectedWar(slots, lineups, [{ pid: 'x', pos: 'TE', v: 6 }, { pid: 'y', pos: 'TE', v: 16 }, { pid: 'z', pos: 'TE', v: 26 }], 27.5);
  assert.ok(Math.abs(w.get('x')!) < 0.02);
  assert.ok(w.get('z')! > w.get('y')! && w.get('y')! > w.get('x')!);
});

test('our value: auction dollars that spend the whole pool, ordered by score', () => {
  const V = buildValues(buildBase(idx, true), { ...DEFAULT_SETTINGS, marketShare: 0 }, null);
  const ws = [...idx.players.keys()].map((p) => V.worth(p)).filter((w) => !!w);
  const total = ws.reduce((s, w) => s + w!.dollars, 0);
  assert.ok(Math.abs(total - idx.teamIds.length * 200) < 0.5, `pool spends $2,400 (got ${total.toFixed(1)})`);
  assert.equal(ws.filter((w) => w!.dollars >= 1).length, V.dollarFit.pool);
  const sorted = [...ws].sort((a, b) => b!.score - a!.score);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i]!.dollars <= sorted[i - 1]!.dollars + 1e-9);
  assert.ok(V.dollarFit.k >= 1 && V.dollarFit.k <= 3);
  // Charts at 0%: a player's value is our price with the injury discount, nothing from the charts.
  for (const p of idx.owner.keys()) { const b = V.blend(p); if (b.model !== null) assert.ok(Math.abs(b.ev - b.model) < 1e-9); }
});
