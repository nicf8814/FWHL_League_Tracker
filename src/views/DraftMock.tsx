// Mock draft (Draft > Mock draft): your draft, simulated. Plays 100 full auctions with all 12 teams on the
// live board (the other 11 bid by persona, Draft > Settings; Nic's team bids his plan and fills the rest
// with $1 bids or an auto-fill strategy) in the mock-auction worker, and answers his questions in his
// terms: does my plan come together, which targets am I likely to lose and to whom, what does my team
// usually look like. Below that, a few of those drafts to watch, the most typical first.
import { useEffect, useMemo, useState } from 'react';
import type { DraftPrep as Prep, DraftPrepFile, Persona } from '../data/draftPrep.ts';
import { useLeague } from '../data/store.tsx';
import { STRATEGIES, type Strategy } from '../engine/autoFill.ts';
import { priceBoard } from '../engine/draftPrep.ts';
import { teamName } from '../engine/league.ts';
import { DEFAULT_DIALS, calibrate, playerTeam, poolOf, type Auction, type DraftOutlook, type PlainTeam, type TargetOutlook } from '../engine/mockAuction.ts';
import { draftOutlookAsync } from '../engine/auctionClient.ts';
import { useJob } from '../ui/useJob.ts';
import { Empty, PosMark, Section, Seg } from '../ui/components.tsx';
import { DraftGate, Help, usePersonas } from './draftCommon.tsx';
import { rowKey, usePlan } from './DraftPlan.tsx';
import { useKeepers, useLiveEdition } from './draftLive.ts';

type Mode = 'plan' | Strategy;
const DRAFTS = 100;
const pct = (x: number) => `${Math.round(x * 100)}%`;
const chanceTone = (x: number) => (x >= 0.6 ? 'text-gain' : x < 0.3 ? 'text-loss' : '');

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
  const me = settings.myTeamId !== null && idx.teams.has(settings.myTeamId) ? teamName(idx, settings.myTeamId) : null;
  const label = (p: Persona) => (idx.teams.has(p.teamId) ? teamName(idx, p.teamId) : p.name);
  const board = useMemo(() => priceBoard(filled.prep, keepers), [filled.prep, keepers]);

  const teams = useMemo<PlainTeam[]>(() => P.list.map((p) => {
    const ks = keepers.filter((k) => k[3] === label(p));
    const f: PlainTeam['filled'] = {};
    for (const k of ks) f[k[1]] = (f[k[1]] ?? 0) + 1;
    const mine = label(p) === me;
    // His planned players at his planned bids in every mode; the rest bid like a plain owner (My plan +
    // market: expected cost, spending his money) or by the strategy. Plain data, for the worker.
    return { name: label(p), budget: prep.budget - ks.reduce((s, k) => s + k[2], 0), filled: f, persona: mine ? null : p, bids: mine ? plan.bids : undefined, rest: mode === 'plan' ? 'one' : mode, market: mine && mode === 'plan' };
  }), [JSON.stringify(P.list), keepers, me, mode, plan.bids, prep.budget, idx]);

  const pool = useMemo(() => poolOf(board.rows), [board]);
  const dials = file.mockDials?.dials ?? DEFAULT_DIALS; // fitted to real auctions (Draft > Settings)
  const calib = useMemo(() => calibrate(teams.filter((t) => !t.bids), 8, dials.noise), [teams, dials.noise]);
  // Runs by itself (in the worker) whenever the plan, keepers or fill mode change. Same inputs, same answer.
  const job = useJob(() => draftOutlookAsync({ pool, teams, me, plan: me ? plan.bids : {}, run: 1, n: DRAFTS, nomination: file.nomination, calib, dials }), [pool, teams, me, plan.bids, file.nomination, calib, dials]);
  const out = job.value;

  const myKeepers = me ? keepers.filter((k) => k[3] === me) : [];
  const budget = prep.budget - myKeepers.reduce((s, k) => s + k[2], 0);
  const planned = Object.entries(plan.bids).map(([k, bid]) => ({ k, bid, row: board.rows.find((r) => rowKey(r) === k) })).filter((x) => x.row && !x.row.keeper).sort((a, b) => b.bid - a.bid);
  const plannedSpend = planned.reduce((s, x) => s + x.bid, 0);
  const fillHelp = mode === 'plan' ? 'about expected cost, more when you have money to spend' : STRATEGIES.find((s) => s.id === mode)!.help.toLowerCase();

  return (
    <div className="grid gap-6">
      <Section title={`${prep.year} mock draft`} aside={<span className="flex items-center gap-2 text-ink-3">How it works <Help label="How the mock draft works"><ul className="grid gap-1.5 text-sm text-ink-2">
        <li>This page plays {DRAFTS} full auctions on the live board, after keepers, and sums them up for you. It reruns by itself when your plan, keepers or fill choice change.</li>
        <li>Each team nominates in turn the way this league does: early on mostly top players, then middle, then cheap ones (measured from the 2022-26 auctions), usually the priciest one at a position the nominator doesn't need, about 30% of the time a wild card.</li>
        <li>The other 11 bid by persona (Draft &gt; Settings). Your team bids your planned prices on your planned players and fills the rest your chosen way, keeping back the money the planned players still need. Price = second-highest bid + $1, within everyone's money, the max-bid rule and position limits.</li>
        <li>Unlike Chance at your price on the Board, which looks at one player at a time, this plays your whole plan with your real budget, so the numbers can differ: here you can run out of money.</li>
      </ul></Help></span>}>
        <div className="flex flex-wrap items-center gap-3">
          <Seg label="Fill the rest of my team" value={mode} options={[['plan', 'Like the market'], ...STRATEGIES.map((s) => [s.id, s.label] as const)] as const} onChange={(v) => setMode(v as Mode)} />
          <span className="text-sm text-ink-3" aria-live="polite">{job.busy ? `Playing ${DRAFTS} drafts…` : out ? `From ${DRAFTS} simulated drafts` : ''}</span>
        </div>
        <p className="max-w-[75ch] text-sm text-ink-2">Your team bids your planned price on each planned player and fills the rest {fillHelp}. A planned price is your top bid: an owner who wants him more takes him.</p>
        {!me && <p className="text-sm text-ink-2">Pick your team in Data &amp; settings to see your own odds. Until then this shows the league without you.</p>}
        {me && out && <Headline out={out} hasPlan={planned.length > 0} />}
      </Section>

      {me && out && out.targets.length > 0 && <Targets targets={out.targets} n={out.n} />}

      {me && !out && (
        <Section title="Your team going in" aside={<span className="num text-ink-3">${budget} after keepers · ${plannedSpend} planned · ${budget - plannedSpend} for the rest</span>}>
          <ul className="grid max-w-xl gap-0.5 text-sm">
            {myKeepers.map((k) => <li key={k[0]} className="flex items-center gap-2"><PosMark pos={k[1]} /><span className="flex-1 truncate">{k[0]}</span><span className="num text-xs text-ink-3">Keeper ${k[2]}</span></li>)}
            {planned.map((x) => <li key={x.k} className="flex items-center gap-2"><PosMark pos={x.row!.pos} /><span className="flex-1 truncate">{x.row!.name}</span><span className="num text-xs font-semibold">your bid ${x.bid}</span></li>)}
          </ul>
        </Section>
      )}

      {out && <Examples out={out} me={me} teams={teams} keepers={keepers} plan={plan.bids} />}
    </div>
  );
}

// The answer first: does the plan come together, and what is left over.
// The answer first: how much of the plan he usually lands, whether all of it comes together, what is left.
function Headline({ out, hasPlan }: { out: DraftOutlook; hasPlan: boolean }) {
  const total = out.targets.length;
  return (
    <div className="grid gap-1">
      <p className="headline-sm">
        {hasPlan && out.landed !== null
          ? <>You usually land <span className={chanceTone(out.landed / total)}>{Math.round(out.landed)} of your {total}</span> target{total === 1 ? '' : 's'}.</>
          : 'No planned players yet: your team is filled the way you chose.'}
      </p>
      {hasPlan && out.planOdds !== null && <p className="text-ink-2">{total === 1 ? 'You get him' : 'All of them together'} in {pct(out.planOdds)} of drafts{out.planOdds < 0.05 && total > 3 ? ': bids near expected cost rarely all hold at once, so plan on missing some' : ''}.</p>}
      {out.usual && <p className="text-ink-2">You usually buy {out.usual.bought} players and finish with ${Math.round(out.usual.left)} left.</p>}
      {!hasPlan && <p className="text-sm text-ink-2">Add players and bids on the Board to see how often you get them.</p>}
    </div>
  );
}

// Each planned player: his chance, who usually beats Nic to him, and what it would have taken.
function Targets({ targets, n }: { targets: TargetOutlook[]; n: number }) {
  return (
    <Section title="Your targets" aside={<span className="text-ink-3">least likely first</span>}>
      <p className="max-w-[75ch] text-sm text-ink-2">To get a player more often, raise your bid on the Board toward what it took to win him.</p>
      <ul className="grid gap-2 text-sm">
        {targets.map((t) => (
          <li key={t.key} className="grid gap-0.5 border-t border-line pt-2 first:border-0 first:pt-0">
            <div className="flex items-center gap-2">
              <PosMark pos={t.pos} /><b className="flex-1 truncate">{t.name}</b>
              <span className="num text-xs text-ink-3">your bid ${t.bid}</span>
              <span className={`num font-semibold ${chanceTone(t.get)}`}>you get him {pct(t.get)}</span>
            </div>
            {t.get < 0.95 && t.rival && (
              <p className="text-ink-2">
                Usually goes to <b>{t.rival}</b> ({Math.round(t.rivalShare * n)} of {n} drafts){t.rivalPrice !== null ? ` for about $${Math.round(t.rivalPrice)}` : ''}.
                {t.toWin !== null && t.toWin > t.bid && <> It took about <b>${Math.round(t.toWin)}</b> to win him.</>}
              </p>
            )}
            {t.get < 0.95 && !t.rival && <p className="text-ink-2">Sometimes nobody takes him.</p>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// A few of the simulated drafts to watch, the most typical first: every roster, then the nomination log.
function Examples({ out, me, teams, keepers, plan }: { out: DraftOutlook; me: string | null; teams: PlainTeam[]; keepers: Prep['keepers']; plan: Record<string, number> }) {
  const [i, setI] = useState(0);
  useEffect(() => setI(0), [out]); // a new set of drafts starts from the most typical again
  const a: Auction = out.examples[Math.min(i, out.examples.length - 1)]!;
  const k = out.examples.length;
  const order = [...teams].sort((x, y) => Number(y.name === me) - Number(x.name === me) || x.name.localeCompare(y.name));
  const keptBy = (team: string) => keepers.filter((x) => x[3] === team);
  const lost = me ? Object.keys(plan).map((key) => a.log.find((s) => s.key === key)).filter((s) => s && s.winner !== me) : [];
  const share = (key: string, team: string | null) => out.freq.get(playerTeam(key, team)) ?? 0;
  return (
    <Section title="Watch an example draft" aside={
      <span className="flex items-center gap-2">
        <button type="button" className="rowbtn h-8 rounded border border-line px-3 disabled:opacity-40" disabled={i === 0} onClick={() => setI(i - 1)} aria-label="Previous example">‹</button>
        <span className="num text-sm" aria-live="polite">{i === 0 ? 'The most typical' : `Example ${i + 1} of ${k}`}</span>
        <button type="button" className="rowbtn h-8 rounded border border-line px-3 disabled:opacity-40" disabled={i >= k - 1} onClick={() => setI(i + 1)} aria-label="Next example">›</button>
      </span>}>
      <p className="max-w-[75ch] text-sm text-ink-2">
        {i === 0 ? `One real draft from the ${out.n}: the one where the most players went where they usually go.` : `Another of the ${out.n} drafts, to see how it can go differently.`} The % by each price is how often that team landed him across all {out.n}.
      </p>
      {me && <p className="text-sm">In this one: <b>{a.rosters.get(me)?.length ?? 0} bought, ${a.left.get(me) ?? 0} left</b>{lost.length ? <>; lost {lost.map((s, j) => <span key={s!.key}>{j ? ', ' : ''}{s!.name}{s!.winner ? ` to ${s!.winner} ($${s!.price})` : ' (not nominated)'}</span>)}</> : ''}.</p>}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {order.map((t) => (
          <div key={t.name} className={`rounded border p-2.5 text-sm ${t.name === me ? 'border-accent' : 'border-line'}`}>
            <div className="mb-1 flex items-baseline justify-between"><b>{t.name === me ? `${t.name} (you)` : t.name}</b><span className="num text-xs text-ink-3">${a.left.get(t.name) ?? 0} left</span></div>
            <ul className="grid gap-0.5">
              {keptBy(t.name).map((x) => <li key={x[0]} className="flex items-center gap-2"><PosMark pos={x[1]} /><span className="flex-1 truncate">{x[0]}</span><span className="num text-xs text-ink-3">K ${x[2]}</span></li>)}
              {(a.rosters.get(t.name) ?? []).map((s) => <li key={s.key} className="flex items-center gap-2"><PosMark pos={s.pos} /><span className="flex-1 truncate">{s.name}</span><span className="num text-xs"><span className="text-ink-3" title={`How often ${t.name} landed him in the ${out.n} drafts`}>{pct(share(s.key, s.winner))} · </span>${s.price}</span></li>)}
            </ul>
          </div>
        ))}
      </div>
      <details>
        <summary className="cursor-pointer text-sm font-semibold">Nomination log ({a.log.length} players)</summary>
        <div className="mt-2 max-h-[32rem] overflow-auto">
          <table className="w-full min-w-[36rem] text-sm">
            <thead className="sticky top-0 bg-paper"><tr className="text-left text-ink-3"><th className="py-1">#</th><th>Nominated by</th><th>Player</th><th>Sold to</th><th className="text-right">Price</th><th>Runner-up</th></tr></thead>
            <tbody>
              {a.log.map((s) => (
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
      </details>
    </Section>
  );
}
