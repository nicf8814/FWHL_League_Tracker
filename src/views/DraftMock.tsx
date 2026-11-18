// Mock draft (Draft > Mock draft): one full auction at a time with all 12 teams on the live board. The
// other 11 bid by persona (Draft > Settings); Nic's team bids his plan or an auto-fill strategy. Shows
// every roster, his lost targets and the nomination log; Run 100 shows who each team usually ends up with.
import { useMemo, useState } from 'react';
import type { DraftPrep as Prep, DraftPrepFile, Persona } from '../data/draftPrep.ts';
import { useLeague } from '../data/store.tsx';
import { STRATEGIES, type Strategy } from '../engine/autoFill.ts';
import { priceBoard, type PrepRow } from '../engine/draftPrep.ts';
import { teamName } from '../engine/league.ts';
import { DEFAULT_DIALS, calibrate, poolOf, rng, runAuction, strategyBid, type Auction, type SimTeam } from '../engine/mockAuction.ts';
import { Empty, PosMark, Section, Seg } from '../ui/components.tsx';
import { DraftGate, Help, usePersonas } from './draftCommon.tsx';
import { rowKey, usePlan } from './DraftPlan.tsx';
import { useKeepers, useLiveEdition } from './draftLive.ts';

type Mode = 'plan' | Strategy;
const MANY = 100;

export default function DraftMock() {
  return <DraftGate title="Mock draft">{(f) => {
    const live = f.editions.find((e) => e.kind === 'standin');
    return live ? <Mock prep={live} file={f} /> : <Empty>No live board to mock.</Empty>;
  }}</DraftGate>;
}

function Mock({ prep, file }: { prep: Prep; file: DraftPrepFile }) {
  const { idx, settings } = useLeague();
  const filled = useLiveEdition(prep);
  const { keepers } = useKeepers(prep.year, filled.keepers, filled.candidates);
  const P = usePersonas(file.personas ?? []);
  const plan = usePlan(prep.year);
  const [mode, setMode] = useState<Mode>('plan');
  const [seed, setSeed] = useState(1);
  const [many, setMany] = useState(false);
  const me = settings.myTeamId !== null && idx.teams.has(settings.myTeamId) ? teamName(idx, settings.myTeamId) : null;
  const label = (p: Persona) => (idx.teams.has(p.teamId) ? teamName(idx, p.teamId) : p.name);
  const board = useMemo(() => priceBoard(filled.prep, keepers), [filled.prep, keepers]);

  const teams = useMemo<SimTeam[]>(() => P.list.map((p) => {
    const ks = keepers.filter((k) => k[3] === label(p));
    const f: SimTeam['filled'] = {};
    for (const k of ks) f[k[1]] = (f[k[1]] ?? 0) + 1;
    const mine = label(p) === me;
    const bid = mine ? (mode === 'plan' ? (r: PrepRow) => plan.bids[rowKey(r)] ?? 1 : (r: PrepRow) => strategyBid(mode, r)) : undefined;
    return { name: label(p), budget: prep.budget - ks.reduce((s, k) => s + k[2], 0), filled: f, persona: mine ? null : p, bid, planned: mine && mode === 'plan' ? new Set(Object.keys(plan.bids)) : undefined };
  }), [JSON.stringify(P.list), keepers, me, mode, plan.bids, prep.budget, idx]);

  const pool = useMemo(() => poolOf(board.rows), [board]);
  const dials = file.mockDials?.dials ?? DEFAULT_DIALS; // fitted to real auctions (Draft > Settings)
  const calib = useMemo(() => calibrate(teams.filter((t) => !t.bid), 8, dials.noise), [teams, dials.noise]);
  const one = useMemo<Auction>(() => runAuction(pool, teams, rowKey, rng(seed * 7919), file.nomination, calib, dials), [pool, teams, seed, file.nomination, calib, dials]);
  // Run 100: plays 100 auctions and shows the most typical one, a real single draft (nobody on two
  // teams, every budget and roster rule kept): the run where the most players went where they usually go.
  // freq: how often each player landed with that team over the 100.
  const typical = useMemo(() => {
    if (!many) return null;
    const rand = rng(seed * 104729);
    const runs = Array.from({ length: MANY }, () => runAuction(pool, teams, rowKey, rand, file.nomination, calib, dials));
    const freq = new Map<string, number>();
    const pair = (key: string, team: string | null) => `${key}\u0000${team}`;
    for (const a of runs) for (const x of a.log) if (x.winner) freq.set(pair(x.key, x.winner), (freq.get(pair(x.key, x.winner)) ?? 0) + 1 / MANY);
    const score = (a: Auction) => a.log.reduce((t, x) => t + (x.winner ? freq.get(pair(x.key, x.winner))! : 0), 0);
    const best = runs.reduce((m, a) => (score(a) > score(m) ? a : m));
    return { auction: best, odds: (key: string, team: string | null) => freq.get(pair(key, team)) ?? 0 };
  }, [many, pool, teams, seed, file.nomination, calib, dials]);
  const shown = typical?.auction ?? one;

  const keptBy = (team: string) => keepers.filter((k) => k[3] === team);
  const order = [...teams].sort((a, b) => Number(b.name === me) - Number(a.name === me) || a.name.localeCompare(b.name));
  const lost = me && mode === 'plan' ? Object.keys(plan.bids).map((k) => shown.log.find((s) => s.key === k)).filter((s) => s && s.winner !== me) : [];
  const mineLeft = me ? shown.left.get(me) : undefined;

  return (
    <div className="grid gap-6">
      <Section title={`${prep.year} mock draft`} aside={<span className="flex items-center gap-2 text-ink-3">How the mock works <Help label="How the mock draft works"><ul className="grid gap-1.5 text-sm text-ink-2">
        <li>One full auction on the live board, after keepers. Each team nominates in turn the way this league does: early on mostly top players, then middle, then cheap ones (measured from the 2022-26 auctions), usually the priciest one at a position the nominator doesn't need, about 30% of the time a wild card.</li>
        <li>The other 11 bid by persona (Draft &gt; Settings). Your team bids your plan (your planned bids, and $1 on anyone else, so the leftovers fill your roster) or an auto-fill strategy as bids.</li>
        <li>Price = second-highest bid + $1. Everyone keeps to his money, the max-bid rule and position limits.</li>
        <li>Run again for a different auction from the same setup. Run {MANY} plays {MANY} auctions and shows the most typical one: a single real draft, with how often each team landed each player.</li>
      </ul></Help></span>}>
        <div className="flex flex-wrap items-center gap-3">
          <Seg label="You bid" value={mode} options={[['plan', 'My plan'], ...STRATEGIES.map((s) => [s.id, s.label] as const)] as const} onChange={(v) => setMode(v as Mode)} />
          <button type="button" className="rowbtn h-9 rounded bg-accent px-4 font-semibold text-white" onClick={() => { setMany(false); setSeed((s) => s + 1); }}>Run again</button>
          <button type="button" className={`rowbtn h-9 rounded border border-line px-4 ${many ? 'font-semibold' : ''}`} onClick={() => setMany((m) => !m)}>{many ? 'Back to one mock' : `Most typical of ${MANY}`}</button>
        </div>
        {!me && <p className="text-sm text-ink-2">Pick your team in Data &amp; settings so your team bids your plan.</p>}
        {me && mode === 'plan' && !Object.keys(plan.bids).length && <p className="text-sm text-ink-2">Your plan is empty, so your team only keeps its keepers. Add players on the Board, or bid a strategy.</p>}
        {me && (
          <p className="headline-sm">{shown.rosters.get(me)?.length ?? 0} bought, ${mineLeft ?? 0} left{lost.length ? `, ${lost.length} target${lost.length === 1 ? '' : 's'} lost` : ''}</p>
        )}
        {lost.length > 0 && (
          <ul className="text-sm text-ink-2">{lost.map((s) => <li key={s!.key}>{s!.name}: {s!.winner ? `${s!.winner} paid $${s!.price} (your bid $${plan.bids[s!.key]})` : 'not nominated'}</li>)}</ul>
        )}
      </Section>

      {typical && <p className="max-w-[75ch] text-sm text-ink-2">The most typical of {MANY} mock drafts: one real draft (nobody on two teams), the one where the most players went where they usually go. The % by each price is how often that team landed him across all {MANY}.</p>}
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {order.map((t) => (
              <div key={t.name} className={`rounded border p-2.5 text-sm ${t.name === me ? 'border-accent' : 'border-line'}`}>
                <div className="mb-1 flex items-baseline justify-between"><b>{t.name === me ? `${t.name} (you)` : t.name}</b><span className="num text-xs text-ink-3">${shown.left.get(t.name) ?? 0} left</span></div>
                <ul className="grid gap-0.5">
                  {keptBy(t.name).map((k) => <li key={k[0]} className="flex items-center gap-2"><PosMark pos={k[1]} /><span className="flex-1 truncate">{k[0]}</span><span className="num text-xs text-ink-3">K ${k[2]}</span></li>)}
                  {(shown.rosters.get(t.name) ?? []).map((s) => <li key={s.key} className="flex items-center gap-2"><PosMark pos={s.pos} /><span className="flex-1 truncate">{s.name}</span><span className="num text-xs">{typical && <span className="text-ink-3" title="How often this team landed him in the 100 drafts">{Math.round(typical.odds(s.key, s.winner) * 100)}% · </span>}${s.price}</span></li>)}
                </ul>
              </div>
            ))}
          </div>
          <Section title="Nomination log">
            <div className="max-h-[32rem] overflow-auto">
              <table className="w-full min-w-[36rem] text-sm">
                <thead className="sticky top-0 bg-paper"><tr className="text-left text-ink-3"><th className="py-1">#</th><th>Nominated by</th><th>Player</th><th>Sold to</th><th className="text-right">Price</th><th>Runner-up</th></tr></thead>
                <tbody>
                  {shown.log.map((s) => (
                    <tr key={s.n} className={`border-t border-line ${s.winner === me ? 'bg-primary-soft' : ''}`}>
                      <td className="num py-0.5 text-ink-3">{s.n}</td><td className="text-ink-2">{s.by}</td>
                      <td><span className="flex items-center gap-2"><PosMark pos={s.pos} />{s.name}</span></td>
                      <td>{s.winner ?? <span className="text-ink-3">nobody</span>}</td>
                      <td className="num text-right">{s.winner ? `$${s.price}` : ''}</td>
                      <td className="text-ink-3">{s.runnerUp ? `${s.runnerUp} $${s.runnerBid}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        </>
    </div>
  );
}
