// Draft prep (Nic's pre-draft board): cost, worth and edge for every player left after keepers.
// Loads public/seed/draft-prep.json once. Two editions: next year's live stand-in (filled here from this
// season's production, trade values and injuries) and the 2026 test run (last August's real board).
// Behind a password screen while Nic builds it.
// shortcut: password screen only, the data is public in the repo; revisit if Nic shares the tool or wants real privacy.
import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { playerKey } from '../data/drafts.ts';
import { PREP_POS, draftPrepUrl, validateDraftPrep, type DraftPrep as Prep, type DraftPrepFile, type KeeperRow, type PrepPos } from '../data/draftPrep.ts';
import { useLeague } from '../data/store.tsx';
import { SEASON_GAMES, gamesBand, priceBoard, standInBoard, type PrepRow, type SeasonLine, type StandInRow } from '../engine/draftPrep.ts';
import { keeperCalls, keeperSet } from '../engine/keepers.ts';
import { teamName } from '../engine/league.ts';
import { Empty, fmt, PosMark, Section, Seg, signed, tone } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import { PlanButton, PlanPanel, planPicks, rowKey, usePlan } from './DraftPlan.tsx';
import { maxBidFor, posFull } from '../engine/rosterPlan.ts';
import { autoFill, type Strategy } from '../engine/autoFill.ts';

const PASS_HASH = '55174404f557a8209cd5aacf3c54e1a4e2b7bc5b9eaa8254dd570c67d9733685'; // SHA-256 of the password (docs/draft-prep/design.md, Access)
const UNLOCK_KEY = 'fwhl-draft-prep-unlocked';
const SWITCH_KEY = 'fwhl-draft-prep-keepers'; // per viewer: keeper switches by year { year: { name|pos: kept } }

async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function readUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === PASS_HASH; } catch { return false; }
}

function Lock({ onOpen }: { onOpen: () => void }) {
  const [text, setText] = useState('');
  const [wrong, setWrong] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((await sha256(text)) !== PASS_HASH) { setWrong(true); return; }
    try { localStorage.setItem(UNLOCK_KEY, PASS_HASH); } catch { /* still opens for this visit */ }
    onOpen();
  };
  return (
    <form onSubmit={submit} className="grid max-w-sm gap-3">
      <p className="text-ink-2">This page is private for now.</p>
      <label className="grid gap-1 text-sm">Password
        <input type="password" autoComplete="current-password" value={text} onChange={(e) => { setText(e.target.value); setWrong(false); }} className="h-10 rounded border border-line bg-panel px-3" />
      </label>
      {wrong && <p className="text-sm text-loss">That isn't it.</p>}
      <button type="submit" className="h-10 rounded bg-accent px-4 font-semibold text-white">Open</button>
    </form>
  );
}

let file: Promise<DraftPrepFile> | null = null;
const loadPrep = () => {
  file ??= fetch(draftPrepUrl(import.meta.env.BASE_URL), { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`draft prep file: HTTP ${r.status}`); return r.json(); })
    .then((raw) => { const v = validateDraftPrep(raw); if (!v.ok) throw new Error(v.errors.join('; ')); return v.value; });
  file.catch(() => { file = null; });
  return file;
};

type Switches = Record<string, Record<string, boolean>>;
function readSwitches(): Switches {
  try { return JSON.parse(localStorage.getItem(SWITCH_KEY) ?? '{}') as Switches; } catch { return {}; }
}
function saveSwitches(s: Switches) {
  try { localStorage.setItem(SWITCH_KEY, JSON.stringify(s)); } catch { /* switches last for this visit */ }
}

export default function DraftPrep() {
  const [open, setOpen] = useState(readUnlocked);
  if (!open) return <Section title="Draft prep"><Lock onOpen={() => setOpen(true)} /></Section>;
  return <Editions />;
}

function Editions() {
  const [prepFile, setPrepFile] = useState<DraftPrepFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [year, setYear] = useState<number | null>(null);
  useEffect(() => { loadPrep().then(setPrepFile, (e: Error) => setErr(e.message)); }, []);
  if (err) return <Empty>Couldn't load the draft prep file: {err}</Empty>;
  if (!prepFile) return <Empty>Loading the board…</Empty>;
  const eds = [...prepFile.editions].reverse(); // newest first
  const ed = eds.find((e) => e.year === year) ?? eds[0]!;
  const label = (e: Prep) => (e.kind === 'standin' ? `${e.year} (live)` : `${e.year} test run`);
  return (
    <div className="grid gap-4">
      {eds.length > 1 && <Seg label="Board" value={String(ed.year)} options={eds.map((e) => [String(e.year), label(e)] as const)} onChange={(v) => setYear(Number(v))} />}
      {ed.kind === 'standin' ? <LiveBoard prep={ed} /> : <Board prep={ed} defaultKeepers={ed.keepers} />}
    </div>
  );
}

// Next year's board, filled from this season: points per game and games played (every week with
// points), the latest trade values, and injuries (games he can still play this season).
function LiveBoard({ prep }: { prep: Prep }) {
  const { idx, base, settings } = useLeague();
  const me = settings.myTeamId !== null && idx.teams.has(settings.myTeamId) ? teamName(idx, settings.myTeamId) : null;
  const filled = useMemo(() => {
    const si = prep.standIn!;
    const played = new Map<string, { pts: number; games: number }>();
    for (const [w, week] of idx.weeks) {
      if (w > idx.scoresThrough) continue;
      for (const [pid, pw] of week) {
        if (!pw.points || pw.points <= 0) continue;
        const g = played.get(pid) ?? { pts: 0, games: 0 };
        g.pts += pw.points; g.games++;
        played.set(pid, g);
      }
    }
    const lines: SeasonLine[] = [];
    for (const [pid, p] of idx.players) {
      if (!(PREP_POS as readonly string[]).includes(p.pos)) continue;
      const g = played.get(pid);
      const vals = [idx.chart.peaked.get(pid), idx.chart.menton.get(pid)].filter((v): v is number => v != null);
      if (!g && !vals.length) continue;
      const back = base.returnWeek(pid);
      let left = 0;
      for (let w = idx.scoresThrough + 1; w <= SEASON_GAMES; w++) if (back < SEASON_GAMES + 1 && w >= back) left++;
      lines.push({ name: p.name, pos: p.pos as PrepPos, team: p.nflTeam ?? '', ppg: g ? g.pts / g.games : null, games: g?.games ?? 0, share: Math.min(1, ((g?.games ?? 0) + left) / SEASON_GAMES), value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null });
    }
    const { board, rows } = standInBoard(si, lines);
    // Keeper guesses: each roster's best calls from the Keepers page (locked contracts first).
    const calls = keeperCalls(base);
    const keepers: KeeperRow[] = [];
    for (const [team, roster] of idx.roster) {
      for (const pid of keeperSet(calls, roster, idx.ds.season.keeper.slots)) {
        const p = idx.players.get(pid), c = calls.get(pid);
        if (p && c?.cost != null && (PREP_POS as readonly string[]).includes(p.pos)) keepers.push([p.name, p.pos as PrepPos, c.cost, teamName(idx, team)]);
      }
    }
    // Everyone with a keeper cost can be switched on.
    const candidates: KeeperRow[] = idx.ds.keepers.flatMap((k) => {
      const p = idx.players.get(k.playerId), team = idx.owner.get(k.playerId);
      return p && k.cost != null && team !== undefined && (PREP_POS as readonly string[]).includes(p.pos) ? [[p.name, p.pos as PrepPos, k.cost, teamName(idx, team)] as KeeperRow] : [];
    });
    return { prep: { ...prep, board }, rows, keepers, candidates };
  }, [prep, idx, base]);
  return <Board prep={filled.prep} defaultKeepers={filled.keepers} candidates={filled.candidates} live={filled.rows} weeks={idx.scoresThrough} me={me} />;
}

interface BoardProps { prep: Prep; defaultKeepers: KeeperRow[]; candidates?: KeeperRow[]; live?: Map<string, StandInRow>; weeks?: number; me?: string | null }

function Board({ prep, defaultKeepers, candidates = defaultKeepers, live, weeks, me = null }: BoardProps) {
  const plan = usePlan(prep.year);
  const [switches, setSwitches] = useState<Switches>(readSwitches);
  const mine = switches[prep.year] ?? {};
  const keyOf = (name: string, pos: string) => playerKey(name, pos);
  const keepers = useMemo(() => {
    const on = new Set(defaultKeepers.map((k) => keyOf(k[0], k[1])));
    for (const [k, v] of Object.entries(mine)) if (v) on.add(k); else on.delete(k);
    return candidates.filter((k) => on.has(keyOf(k[0], k[1])));
  }, [defaultKeepers, candidates, mine]);
  const candidateKeys = useMemo(() => new Map(candidates.map((k) => [keyOf(k[0], k[1]), k])), [candidates]);
  const toggle = (key: string, on: boolean) => {
    const next = { ...switches, [prep.year]: { ...mine, [key]: on } };
    setSwitches(next); saveSwitches(next);
  };
  const reset = () => { const next = { ...switches }; delete next[prep.year]; setSwitches(next); saveSwitches(next); };
  const changed = Object.keys(mine).length;

  // Planned buys count as sold at my bid, so an overbid reprices everyone left (live board only).
  const bought = useMemo(() => (live ? plan.bids : {}), [live, plan.bids]);
  const board = useMemo(() => priceBoard(prep, keepers, bought), [prep, keepers, bought]);
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
    const out = autoFill(rowsNow, start, strategy, plan.avoid, rowKey, prep.budget);
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
    { id: 'band', label: 'Window', value: (r) => r.ceiling, cell: (r) => <span className="whitespace-nowrap text-ink-2">{r.floor}–{r.ceiling}</span> },
    { id: 'worth', label: 'Worth', value: (r) => r.worth, cell: (r) => `$${fmt(r.worth, 0)}` },
    { id: 'edge', label: 'Edge', value: (r) => (r.keeper ? null : r.edge), cell: (r) => (r.keeper ? '–' : <span className={tone(r.edge, 2)}>{signed(r.edge, 0)}</span>) },
    { id: 'tier', label: 'Price tier', left: true, hidden: !!live, className: 'text-ink-2', value: (r) => `${r.pos}${r.rank} ${r.tier}`, cell: (r) => `${r.tier} (${r.pos}${r.rank})` },
    { id: 'vtier', label: 'Value tier', hidden: !!live, value: (r) => r.valueTier, cell: (r) => (r.valueTier == null ? '–' : `${r.pos} ${r.valueTier}`) },
    { id: 'proj', label: 'Proj pts', hidden: !!live, value: (r) => r.proj, cell: (r) => fmt(r.proj, 0) },
    { id: 'price', label: live ? 'Slot $' : 'Consensus $', hidden: true, value: (r) => r.price, cell: (r) => `$${r.price}` },
    { id: 'team', label: 'NFL', left: true, hidden: true, value: (r) => r.team },
  ], [candidateKeys, live, mine, plan.bids, me, nextMax, planned]);
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
            <PlanPanel rows={board.rows} me={me} plan={plan} budget={prep.budget} onFill={fill} />
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

// An (i) button with the explanation in a card (same pattern as the History page's value help).
function Help({ label, children }: { label: string; children: ReactNode }) {
  const id = useId().replace(/:/g, '');
  return (
    <>
      <button type="button" popoverTarget={id} className="inline-grid size-7 shrink-0 place-items-center rounded-full border border-rule-strong align-middle font-mono text-xs text-ink-2 hover:bg-sunk" aria-label={label} title={label}>i</button>
      <div id={id} popover="auto" className="popcard" role="dialog" aria-label={label}>
        <p className="mb-2 font-display text-lg font-bold [font-stretch:85%]">{label}</p>
        {children}
      </div>
    </>
  );
}
