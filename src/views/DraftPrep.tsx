// Draft prep (Nic's pre-draft board): cost, worth and edge for every player left after keepers.
// Loads public/seed/draft-prep.json once. Two editions: next year's live stand-in (filled here from this
// season's production, trade values and injuries) and the 2026 test run (last August's real board).
// Behind a password screen while Nic builds it.
// shortcut: password screen only, the data is public in the repo; revisit if Nic shares the tool or wants real privacy.
import { useEffect, useMemo, useState } from 'react';
import { playerKey } from '../data/drafts.ts';
import type { DraftPrep as Prep, DraftPrepFile, KeeperRow, Persona } from '../data/draftPrep.ts';
import type { MockDials, Nomination, PlainTeam, SimOut } from '../engine/mockAuction.ts';
import { boardOdds } from '../engine/auctionClient.ts';
import { useLeague } from '../data/store.tsx';
import { gamesBand, priceBoard, type PrepRow, type StandInRow } from '../engine/draftPrep.ts';
import { teamName } from '../engine/league.ts';
import { fmt, PosMark, Section, Seg, signed, tone } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import { PlanButton, PlanPanel, planPicks, rowKey, usePlan } from './DraftPlan.tsx';
import { maxBidFor, posFull } from '../engine/rosterPlan.ts';
import { autoFill, type Strategy } from '../engine/autoFill.ts';
import { DraftGate, Help, usePersonas } from './draftCommon.tsx';
import { useKeepers, useLiveEdition } from './draftLive.ts';


export default function DraftPrep() {
  return <DraftGate title="Draft board">{(f) => <Editions prepFile={f} />}</DraftGate>;
}

function Editions({ prepFile }: { prepFile: DraftPrepFile }) {
  const [year, setYear] = useState<number | null>(null);
  const eds = [...prepFile.editions].reverse(); // newest first
  const ed = eds.find((e) => e.year === year) ?? eds[0]!;
  const label = (e: Prep) => (e.kind === 'standin' ? `${e.year} (live)` : `${e.year} test run`);
  return (
    <div className="grid gap-4">
      {eds.length > 1 && <Seg label="Board" value={String(ed.year)} options={eds.map((e) => [String(e.year), label(e)] as const)} onChange={(v) => setYear(Number(v))} />}
      {ed.kind === 'standin' ? <LiveBoard prep={ed} personas={prepFile.personas ?? []} nomination={prepFile.nomination} dials={prepFile.mockDials?.dials} /> : <Board prep={ed} defaultKeepers={ed.keepers} personas={prepFile.personas ?? []} nomination={prepFile.nomination} dials={prepFile.mockDials?.dials} ownerOf={(p) => p.key} />}
    </div>
  );
}

// Next year's board, filled from this season: points per game and games played (every week with
// points), the latest trade values, and injuries (games he can still play this season).
function LiveBoard({ prep, personas, nomination, dials }: { prep: Prep; personas: Persona[]; nomination?: Nomination; dials?: MockDials }) {
  const { idx, settings } = useLeague();
  const filled = useLiveEdition(prep);
  const me = settings.myTeamId !== null && idx.teams.has(settings.myTeamId) ? teamName(idx, settings.myTeamId) : null;
  return <Board prep={filled.prep} defaultKeepers={filled.keepers} candidates={filled.candidates} live={filled.rows} weeks={idx.scoresThrough} me={me} personas={personas} nomination={nomination} dials={dials} ownerOf={(p) => (idx.teams.has(p.teamId) ? teamName(idx, p.teamId) : p.name)} />;
}

// ownerOf: a persona's owner as the keeper rows name him (team name on the live board, owner key in a test run).
interface BoardProps { prep: Prep; defaultKeepers: KeeperRow[]; candidates?: KeeperRow[]; live?: Map<string, StandInRow>; weeks?: number; me?: string | null; personas: Persona[]; nomination?: Nomination; dials?: MockDials; ownerOf: (p: Persona) => string }

function Board({ prep, defaultKeepers, candidates = defaultKeepers, live, weeks, me = null, personas, nomination, dials, ownerOf }: BoardProps) {
  const P = usePersonas(personas);
  const plan = usePlan(prep.year);
  const { keepers, candidateKeys, toggle, reset, changed, mine } = useKeepers(prep.year, defaultKeepers, candidates);
  const keyOf = (name: string, pos: string) => playerKey(name, pos);

  // Planned buys count as sold at my bid, so an overbid reprices everyone left (live board only).
  const bought = useMemo(() => (live ? plan.bids : {}), [live, plan.bids]);
  const board = useMemo(() => priceBoard(prep, keepers, bought), [prep, keepers, bought]);
  // Mock auctions: the other teams, by persona, after their keepers. Rerun a moment after the last change
  // so typing a bid stays instant. Nic's max per player = his planned bid, else the expected cost.
  const [sim, setSim] = useState<SimOut | null>(null);
  const others = useMemo<PlainTeam[]>(() => P.list.filter((p) => ownerOf(p) !== me).map((p) => {
    const ks = keepers.filter((k) => k[3] === ownerOf(p));
    const filled: PlainTeam['filled'] = {};
    for (const k of ks) filled[k[1]] = (filled[k[1]] ?? 0) + 1;
    return { name: p.name.split(' ')[0]!, budget: prep.budget - ks.reduce((s, k) => s + k[2], 0), filled, persona: p };
  }), [JSON.stringify(P.list), keepers, me, prep.budget]);
  // The runs happen in the mock-auction worker; an answer for inputs that have since changed is dropped.
  useEffect(() => {
    let live = true;
    const id = setTimeout(() => {
      boardOdds({ rows: board.rows, teams: others, myBids: plan.bids, runs: P.runs, nomination, dials }).then((s) => { if (live) setSim(s); }, (e) => console.error('Mock auctions failed', e));
    }, 250);
    return () => { live = false; clearTimeout(id); };
  }, [board, others, plan.bids, P.runs, nomination, dials]);
  const simOf = (r: PrepRow) => sim?.players.get(rowKey(r));
  const rows = useMemo(() => board.rows.filter((r) => r.price > 0 || (r.vorp ?? 0) > 0 || r.keeper || candidateKeys.has(keyOf(r.name, r.pos))), [board, candidateKeys]);
  const liveOf = (r: PrepRow) => live?.get(keyOf(r.name, r.pos));
  const planned = useMemo(() => planPicks(board.rows, me, plan.bids).picks, [board, me, plan.bids]);
  const nextMax = maxBidFor(planned, null, prep.budget);
  // Auto-fill: price the board with only my own buys taken (the old auto picks go back in the pool),
  // keep keepers and my picks, and fill the empty spots.
  const fill = (strategy: Strategy) => {
    const own = Object.fromEntries(Object.entries(plan.bids).filter(([k]) => !plan.auto.has(k)));
    const rowsNow = priceBoard(prep, keepers, own).rows;
    const start = planPicks(rowsNow, me, own).picks;
    const out = autoFill(rowsNow, start, strategy, plan.avoid, rowKey, prep.budget, plan.reach);
    plan.fillWith(Object.fromEntries(out.filter((p) => !p.keeper && !(p.key in own)).map((p) => [p.key, p.bid])));
  };

  const filters = useMemo<FilterDef<PrepRow>[]>(() => [
    { id: 'pos', label: 'Position', options: [['ANY', 'Any position'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], test: (r, v) => r.pos === v },
    { id: 'show', label: 'Shows', options: [['ANY', 'Everyone'], ['open', 'Up for auction'], ['kept', 'Keepers only'], ['can', 'Could be kept']], test: (r, v) => (v === 'open' ? !r.keeper : v === 'kept' ? !!r.keeper : candidateKeys.has(keyOf(r.name, r.pos))) },
  ], [candidateKeys]);
  const search = useMemo(() => ({ placeholder: 'Player name', of: (r: PrepRow) => r.name }), []);
  const cols = useMemo<Col<PrepRow>[]>(() => [
    { id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[9rem]', value: (r) => r.name, cell: (r) => <span className="flex items-center gap-2"><PosMark pos={r.pos} /><span>{r.name}</span></span> },
    ...(live ? [{ id: 'plan', label: '', left: true, fixed: true, value: (r: PrepRow) => (plan.has(rowKey(r)) ? 1 : 0), cell: (r: PrepRow) => <PlanButton row={r} plan={plan} mine={!!me && r.keeper?.[3] === me} maxBid={nextMax} full={posFull(planned, r.pos)} /> }] as Col<PrepRow>[] : []),
    { id: 'keep', label: 'Kept', left: true, value: (r) => (r.keeper ? r.keeper[2] : null), cell: (r) => {
      const k = candidateKeys.get(keyOf(r.name, r.pos));
      if (!k) return '';
      return <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!r.keeper} onChange={(e) => toggle(keyOf(r.name, r.pos), e.target.checked)} aria-label={`Keep ${r.name}`} /><span className={r.keeper ? '' : 'text-ink-3'}>${k[2]} {k[3]}</span></label>;
    } },
    ...(live ? [
      { id: 'today', label: 'Today', hidden: true, value: (r: PrepRow) => liveOf(r)?.today ?? null, cell: (r: PrepRow) => { const x = liveOf(r); return x ? `${r.pos}${x.today}` : '–'; } },
      { id: 'range', label: `Now → ${prep.year}`, value: (r: PrepRow) => liveOf(r)?.next.mid ?? null, cell: (r: PrepRow) => { const x = liveOf(r); return x ? <span className="whitespace-nowrap">{r.pos}{x.today} <span className="text-ink-3">→</span> {x.next.lo}–{x.next.hi}</span> : '–'; } },
      { id: 'ppg', label: 'Pts/g', hidden: true, value: (r: PrepRow) => liveOf(r)?.line.ppg ?? null, cell: (r: PrepRow) => { const x = liveOf(r); return x?.line.ppg == null ? '–' : `${fmt(x.line.ppg)} (${x.line.games}g)`; } },
      { id: 'health', label: 'Season', left: true, hidden: true, className: 'text-ink-2', value: (r: PrepRow) => liveOf(r)?.line.share ?? null, cell: (r: PrepRow) => { const x = liveOf(r); if (!x) return '–'; const b = gamesBand(x.line.share); return b === 'full' ? 'full' : b === 'part' ? 'missed some' : 'mostly lost'; } },
    ] as Col<PrepRow>[] : []),
    { id: 'cost', label: 'Cost', value: (r) => r.cost, cell: (r) => <b className="font-semibold">${fmt(r.cost, 0)}</b> },
    { id: 'band', label: 'Window', hidden: !!live, value: (r) => r.ceiling, cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.floor}–{r.ceiling}</span> },
    { id: 'worth', label: 'Worth', value: (r) => r.worth, cell: (r) => `$${fmt(r.worth, 0)}` },
    { id: 'get', label: 'Chance at your price', value: (r) => (r.keeper ? null : simOf(r)?.get ?? null), cell: (r) => {
      const x = simOf(r);
      if (r.keeper || !x) return '–';
      return <span title={`Your odds of winning ${r.name} at $${plan.bids[rowKey(r)] ?? Math.round(r.cost)}: how often nobody else would pay more, one player at a time before your budget (the Mock draft plays your whole plan). Usually sells for about $${Math.round(x.price)}.`} className={x.get >= 0.6 ? 'text-gain' : x.get < 0.3 ? 'text-loss' : ''}>{Math.round(x.get * 100)}%</span>;
    } },
    { id: 'edge', label: 'Edge', value: (r) => (r.keeper ? null : r.edge), cell: (r) => (r.keeper ? '–' : <span className={tone(r.edge, 2)}>{signed(r.edge, 0)}</span>) },
    { id: 'tier', label: 'Price tier', left: true, hidden: !!live, className: 'text-ink-2', value: (r) => `${r.pos}${r.rank} ${r.tier}`, cell: (r) => `${r.tier} (${r.pos}${r.rank})` },
    { id: 'vtier', label: 'Value tier', hidden: !!live, value: (r) => r.valueTier, cell: (r) => (r.valueTier == null ? '–' : `${r.pos} ${r.valueTier}`) },
    { id: 'proj', label: 'Proj pts', hidden: !!live, value: (r) => r.proj, cell: (r) => fmt(r.proj, 0) },
    { id: 'price', label: live ? 'Slot $' : 'Consensus $', hidden: true, value: (r) => r.price, cell: (r) => `$${r.price}` },
    { id: 'team', label: 'NFL', left: true, hidden: true, value: (r) => r.team },
  ], [candidateKeys, live, mine, plan.bids, me, nextMax, planned, sim]);
  const t = useTable(`draft-prep-${prep.kind}`, cols, rows, { id: 'cost', dir: -1 }, { filters, search, phone: ['cost', 'worth', 'edge'] });

  const mkt = prep.fit.marketYears.map(([y]) => y).join(' and ');
  const si = prep.standIn;
  return (
    <Section title={live ? `${prep.year} draft board, live` : `${prep.year} draft board, test run`} aside={`${keepers.length} keepers, $${board.keeperSpend} kept`}>
      <p className="headline-sm">${board.moneyLeft.toLocaleString()} left for {board.openSlots} open spots</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
        {board.boughtSpend > 0 && <span>Counts your plan's ${board.boughtSpend} in bids as sold.</span>}
        {changed ? <button type="button" className="link" onClick={reset}>Undo my {changed} keeper switch{changed === 1 ? '' : 'es'}</button> : null}
        <span className="flex items-center gap-2 text-ink-3">How this board works <Help label="How this board works"><ul className="grid gap-1.5 text-sm text-ink-2">
        {live && si ? (
          <li><span className="text-ink">Live stand-in</span> until the {prep.year} projections are loaded. Today = his rank this season through Week {weeks}: 70% points per game (4+ games), 30% trade value. {prep.year} range = where players at that rank, with that much of a season played, were priced the next August ({si.sampleYears[0]![0]}-{si.sampleYears.at(-1)![0]} seasons): the middle sets his price and projection ({si.curveYear} board at that rank), the range is the middle half. Injuries count through the games he can still play.</li>
        ) : (
          <li><span className="text-ink">Test run</span>: last August's numbers and the real {prep.year} keepers, priced the way the engine would have. Nothing here knows how the season went.</li>
        )}
        <li><span className="text-ink">Cost</span>: what he should sell for. {live ? 'Slot price' : 'Consensus price'} × what the league paid for his price tier ({mkt} auctions) × the money left after keepers. The window is the least and most his slot (RB1, RB2, ...) sold for in the {prep.fit.slotYears[0]}-{prep.fit.slotYears.at(-1)} drafts; cost never goes over it.</li>
        <li><span className="text-ink">Worth</span>: projected points over the last starter, $1 plus ${fmt(board.perVorp, 2)} a point, after shrinking projections the way past ones fell short.</li>
        <li><span className="text-ink">Edge</span>: worth − cost. Overpaying is what hurts: 2026 buys more than $10 over worth gave back about $26 each by Week 10.</li>
        <li><span className="text-ink">Kept</span>: {live ? "each team's best keeper calls from the Keepers page, locked contracts first" : `the real ${prep.year} keepers`}. Switch anyone on or off; the board reprices.</li>
        {live && <li><span className="text-ink">My plan</span>: your planned bids count as sold, so overbidding makes everyone left cheaper and bargains make them dearer. Auto-fill fills the empty spots; your own picks stay.</li>}
      </ul></Help></span>
      </div>
      {live ? (
        // Wide screens: the plan stays beside the pool while it scrolls.
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="grid min-w-0 gap-3">
            <TableBar t={t} noun="players" file={`fwhl-draft-board-${prep.year}`} />
            <DataTable t={t} rowKey={(r) => String(r.i)} rank={false} minWidth="min-w-[44rem]" empty="No player matches these filters." />
          </div>
          <aside className="order-first xl:order-none xl:sticky xl:top-28 xl:max-h-[calc(100dvh-8rem)] xl:overflow-y-auto">
            <PlanPanel rows={board.rows} me={me} plan={plan} budget={prep.budget} onFill={fill} sim={sim} />
          </aside>
        </div>
      ) : (
        <>
          <TableBar t={t} noun="players" file={`fwhl-draft-board-${prep.year}`} />
          <DataTable t={t} rowKey={(r) => String(r.i)} minWidth="min-w-[56rem]" empty="No player matches these filters." />
        </>
      )}
    </Section>
  );
}
