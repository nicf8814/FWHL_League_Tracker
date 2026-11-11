// Golden checks for the Trade tracker and What if (audit LOGIC-11): the port must reproduce the
// Sandbox engine's results for every trade and vetoed trade. Run with `npm test`.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, type Dataset } from '../data/schema.ts';
import { buildIndex } from './league.ts';
import { buildBase, buildValues } from './model.ts';
import { evaluate, gradePath, scenarioOf } from './replay.ts';
import { simulate } from './sim.ts';

const ds: Dataset = JSON.parse(readFileSync(new URL('../../test/fixtures/fwhl-2026-11-10.json', import.meta.url), 'utf8'));
const G = JSON.parse(readFileSync(new URL('../../test/fixtures/tracker-golden.json', import.meta.url), 'utf8'));
// The Sandbox believed it was Week 9; vetoes are valued at today's prices, so match its week.
const idx = { ...buildIndex(ds), currentWeek: 9 };
const base = buildBase(idx, true);
const sim = simulate({ teamIds: idx.teamIds, games: idx.games, strength: base.strength, cfg: ds.season.sim, top6Weeks: ds.season.top6Weeks, seedsByRecord: ds.season.seedsByRecord });
const V = buildValues(base, DEFAULT_SETTINGS, sim);
const team = (name: string) => ds.teams.find((t) => t.name === name.replace(' (you)', ''))!.id;
const near = (a: number | null, b: number | null, tol: number, what: string) => {
  assert.equal(a == null, b == null, `${what}: ${a} vs ${b}`);
  if (a != null && b != null) assert.ok(Math.abs(a - b) <= tol, `${what}: ${a.toFixed(3)} vs ${b}`);
};

for (const tx of ds.transactions) {
  const g = tx.type === 'veto' ? G.whatif[tx.id] : G.trades[tx.id];
  test(`${tx.type} ${tx.id.slice(0, 11)} matches the Sandbox`, () => {
    assert.ok(g, 'golden result exists');
    const s = scenarioOf(tx);
    const ev = evaluate(V, s);
    const path = gradePath(V, s, ev);
    const wantUndo = g.undo.filter((x: string) => !x.startsWith('wi')).sort();
    assert.deepEqual(ev.calc.undo.map((u) => u.id).sort(), wantUndo, 'chain of undone trades');
    for (const [name, want] of Object.entries<any>(g.res)) {
      const t = team(name), r = ev.res.get(t)!;
      assert.equal(r.grade, want.grade, `${name} grade`);
      assert.equal(r.initL, want.initL, `${name} grade at trade`);
      near(r.score, want.score, 0.002, `${name} score`);
      near(r.act, want.act, 0.02, `${name} pts/wk vs other world`);
      near(r.par, want.par, 0.02, `${name} production`);
      near(r.val, want.val, 0.06, `${name} value received`);
      near(r.pGain, want.pGain, 0.02, `${name} projected gain`);
      near(r.keep, want.keep, 0.05, `${name} keeper edge`);
      assert.deepEqual(r.rows.map((x) => [x.w, x.act.toFixed(2), x.cf.toFixed(2), x.rAct, x.rCf]), want.wks.map((x: any) => [x.w, x.act.toFixed(2), x.cf.toFixed(2), x.rAct, x.rCf]), `${name} weeks`);
      const now = ev.calc.real.get(t)!, alt = ev.calc.alt.get(t)!;
      assert.deepEqual([now.w, now.l, alt.w, alt.l, alt.seed], [want.rec.now.w, want.rec.now.l, want.rec.alt.w, want.rec.alt.l, want.rec.alt.seed], `${name} records`);
      near(alt.pf, want.rec.alt.pf, 0.05, `${name} points for in the other world`);
      assert.deepEqual(path.get(t)!.slice(1), g.hist.map((h: any) => h[name]), `${name} grade path`);
    }
  });
}
