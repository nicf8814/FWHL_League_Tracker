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
  const [run, setRun] = useState(1); // which set of 100 drafts: same set, same answer; "Run 100 new drafts" moves on
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
  const job = useJob(() => draftOutlookAsync({ pool, teams, me, plan: me ? plan.bids : {}, run, n: DRAFTS, nomination: file.nomination, calib, dials }), [pool, teams, me, plan.bids, run, file.nomination, calib, dials]);
  const out = job.value;
  const busy = job.busy || (out !== null && out.run !== run); // the label never runs ahead of the numbers shown
  const [ex, setEx] = useState(0); // which example draft is shown (Your targets says what happened in it)
  useEffect(() => setEx(0), [out]); // a new set of drafts starts from the most typical again

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
          <button type="button" className="rowbtn h-11 rounded bg-accent px-5 text-base font-semibold text-white disabled:opacity-60" disabled={busy} onClick={() => setRun((r) => r + 1)}>Re-Roll Draft</button>
          <span className="text-sm text-ink-3" aria-live="polite">{busy ? `Playing ${DRAFTS} drafts…` : out ? `Roll ${out.run} · ${DRAFTS} drafts` : ''}</span>
        </div>
        {run > 1 && <p className="text-sm text-ink-3">Each re-roll plays the same plan {DRAFTS} more times with fresh luck, so the numbers move a few points from roll to roll; a much bigger move means the plan is on a knife's edge.</p>}
        <p className="max-w-[75ch] text-sm text-ink-2">Your team bids your planned price on each planned player and fills the rest {fillHelp}. A planned price is your top bid: an owner who wants him more takes him.</p>
        {!me && <p className="text-sm text-ink-2">Pick your team in Data &amp; settings to see your own odds. Until then this shows the league without you.</p>}
        {me && out && <Headline out={out} hasPlan={planned.length > 0} />}
      </Section>

      {me && out && out.targets.length > 0 && <Targets targets={out.targets} me={me} example={out.examples[Math.min(ex, out.examples.length - 1)]!} i={ex} k={out.examples.length} setI={setEx} />}

      {me && !out && (
        <Section title="Your team going in" aside={<span className="num text-ink-3">${budget} after keepers · ${plannedSpend} planned · ${budget - plannedSpend} for the rest</span>}>
          <ul className="grid max-w-xl gap-0.5 text-sm">
            {myKeepers.map((k) => <li key={k[0]} className="flex items-center gap-2"><PosMark pos={k[1]} /><span className="flex-1 truncate">{k[0]}</span><span className="num text-xs text-ink-3">Keeper ${k[2]}</span></li>)}
            {planned.map((x) => <li key={x.k} className="flex items-center gap-2"><PosMark pos={x.row!.pos} /><span className="flex-1 truncate">{x.row!.name}</span><span className="num text-xs font-semibold">your bid ${x.bid}</span></li>)}
          </ul>
        </Section>
      )}

      {out && <Examples out={out} me={me} teams={teams} keepers={keepers} i={ex} setI={setEx} />}
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

const exampleName = (i: number) => (i === 0 ? 'the most typical draft' : `example draft ${i + 1}`);

// Each planned player: his odds of winning the bid at Nic's price (Nic, Nov 19: just the odds), what it
// usually took to win him, and under his name what happened to him in the example draft shown below
// (Nic, Nov 19: one place for it, not a second list).
function Targets({ targets, me, example, i, k, setI }: { targets: TargetOutlook[]; me: string; example: Auction; i: number; k: number; setI: (i: number) => void }) {
  const sale = useMemo(() => new Map(example.log.map((s) => [s.key, s])), [example]);
  // Step through the drafts from here too, so the "Here:" lines change where he is reading them.
  return (
    <Section title="Your targets" aside={
      <span className="flex items-center gap-2 whitespace-nowrap">
        <span className="text-ink-3">Here: {exampleName(i)}</span>
        <button type="button" className="rowbtn h-9 rounded border-2 border-ink px-3 font-semibold text-ink" onClick={() => setI((i + 1) % k)}>{i >= k - 1 ? 'Back to most typical' : 'Next draft ›'}</button>
      </span>}>
      <p className="max-w-[75ch] text-sm text-ink-2">Your odds of winning each bid at your price, and what it usually took to win him (the middle half of the range in brackets: it varies from draft to draft). Under each name: what happened to him in {exampleName(i)}, shown below. Raise a bid on the Board to win him more often.</p>
      <ul className="grid text-sm">
        {targets.map((t) => {
          const s = sale.get(t.key);
          return (
            <li key={t.key} className="grid gap-0.5 border-t border-line py-1.5 first:border-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <PosMark pos={t.pos} /><b className="min-w-0 flex-1 truncate">{t.name}</b>
                <span className="num text-ink-2">at ${t.bid}</span>
                <span className={`num w-24 text-right font-semibold ${chanceTone(t.get)}`}>{pct(t.get)} to win</span>
                {t.toWin && t.toWin.mid > t.bid && <span className="w-full pl-8 text-ink-2 sm:w-auto sm:pl-0">· usually took <b>${Math.round(t.toWin.mid)}</b>{t.toWin.hi > t.toWin.lo ? ` ($${t.toWin.lo}–$${t.toWin.hi})` : ''}</span>}
              </div>
              <p className="pl-8 text-ink-2">
                {!s || !s.winner ? 'Here: nobody bought him.'
                  : s.winner === me ? <span className="text-gain">Here: you won him at ${s.price}.</span>
                  : <>Here: <b>{s.winner}</b> won the bid at ${s.price}; it took <b>${s.winBid + 1}</b> to win him.</>}
              </p>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

// A few of the simulated drafts to watch, the most typical first: every roster, then the nomination log.
// i (which draft is shown) lives in the page, so Your targets above can say what happened in it.
function Examples({ out, me, teams, keepers, i, setI }: { out: DraftOutlook; me: string | null; teams: PlainTeam[]; keepers: Prep['keepers']; i: number; setI: (i: number) => void }) {
  const a: Auction = out.examples[Math.min(i, out.examples.length - 1)]!;
  const k = out.examples.length;
  const order = [...teams].sort((x, y) => Number(y.name === me) - Number(x.name === me) || x.name.localeCompare(y.name));
  const keptBy = (team: string) => keepers.filter((x) => x[3] === team);
  const share = (key: string, team: string | null) => out.freq.get(playerTeam(key, team)) ?? 0;
  return (
    <Section title="Watch an example draft" aside={
      <span className="flex items-center gap-2">
        <button type="button" className="rowbtn h-11 whitespace-nowrap rounded border-2 border-line px-3 text-base disabled:opacity-40 sm:min-w-28 sm:px-4" disabled={i === 0} onClick={() => setI(i - 1)}>‹ Previous</button>
        <span className="num whitespace-nowrap text-center text-sm sm:min-w-24 sm:text-base" aria-live="polite">{i === 0 ? 'Most typical' : `${i + 1} of ${k}`}</span>
        <button type="button" className="rowbtn h-11 whitespace-nowrap rounded border-2 border-ink px-3 text-base font-semibold disabled:opacity-40 sm:min-w-28 sm:px-4" disabled={i >= k - 1} onClick={() => setI(i + 1)}>Next draft ›</button>
      </span>}>
      <p className="max-w-[75ch] text-sm text-ink-2">
        {i === 0 ? `One real draft from the ${out.n}: the one where the most players went where they usually go.` : `Another of the ${out.n} drafts, to see how it can go differently.`} The % by each price is how often that team landed him across all {out.n}.
      </p>
      {me && <p className="text-sm">In this one: <b>{a.rosters.get(me)?.length ?? 0} bought, ${a.left.get(me) ?? 0} left</b>. What happened to each of your targets is under his name in Your targets.</p>}
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
