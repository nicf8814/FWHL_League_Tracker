// All-time players, trading careers and keeper calls on the History page (Nov 12, items 1-3).
//   All-time players  every career since 2010, ranked by points scored in an FWHL starting lineup,
//                     plus who turns up on the most championship rosters.
//   Trading           every manager's trades: grade, chart value, points gained raw and above replacement.
//   Keepers           every kept player as a bet: what he cost against what he turned out to be worth.
// Loads public/seed/careers.json once, when an all-time view first opens; trades and drafts reuse
// the files the Trades and Drafts views already load.
import { useEffect, useMemo, useState } from 'react';
import { careersUrl, validateCareers, type Careers } from '../data/careers.ts';
import type { OwnerKey } from '../data/history.ts';
import { useLeague } from '../data/store.tsx';
import { buildCareerBook, ringRosters, type CareerBook, type PlayerCareer } from '../engine/careers.ts';
import { careers, LIFER_SEASONS, ownerName, type Hist } from '../engine/history.ts';
import { bestAndWorst, historyLines, liveLines, traderCareers, type TradeLine, type TraderCareer, type TraderMetric } from '../engine/traders.ts';
import { bestAndWorstKeepers, keeperBets, keeperCareers, type KeeperCareer, type KeeperMetric } from '../engine/keeperSkill.ts';
import { bestAndWorstBuilders, builderCareers, BUILDER_METRICS, MIN_CAPTURE_YEARS, MIN_DRAFTS, ranked, type BuilderCareer, type BuilderMetric } from '../engine/builders.ts';
import { Empty, fmt, pct, Section, Seg, signed, tone } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import { Stamp } from '../ui/stamp.tsx';
import { PosTag, useDraftBook, ValueHelp } from './HistoryDrafts.tsx';
import { useTrades } from './HistoryTrades.tsx';

// ---------- loading ----------
let file: Promise<Careers | string> | null = null;
function loadCareers(): Promise<Careers | string> {
  file ??= fetch(careersUrl(import.meta.env.BASE_URL), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
    .then((raw) => { const v = validateCareers(raw); return v.ok ? v.value : `The careers file is invalid: ${v.errors[0]}`; })
    .catch((e) => { file = null; return `Could not load the all-time players (${e instanceof Error ? e.message : e}).`; });
  return file;
}

export function useCareerBook(H: Hist): CareerBook | string | null {
  const { idx } = useLeague();
  const [c, setC] = useState<Careers | string | null>(null);
  useEffect(() => { let live = true; loadCareers().then((v) => live && setC(v)); return () => { live = false; }; }, []);
  return useMemo(() => {
    if (c === null || typeof c === 'string') return c;
    const byTeam = new Map([...H.owners.values()].filter((o) => o.teamId !== null && !o.filler).map((o) => [o.teamId!, o.key]));
    const live = H.seasons.find((s) => s.live);
    return buildCareerBook(c, live ? { idx, owner: (t) => byTeam.get(t) } : undefined);
  }, [c, H, idx]);
}

const POS_FILTER: [string, string][] = [['ANY', 'Any position'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE'], ['K', 'K'], ['D/ST', 'D/ST']];
const who = (H: Hist, o: OwnerKey) => ownerName(H, o);

// ---------- 1. All-time players ----------
export function AllTimePlayers({ H }: { H: Hist }) {
  const book = useCareerBook(H);
  const [sheet, setSheet] = useState<PlayerCareer | null>(null);
  if (book === null) return <p className="text-sm text-ink-3" role="status">Loading the all-time players…</p>;
  if (typeof book === 'string') return <Empty>{book}</Empty>;
  return (
    <div className="grid grid-cols-1 gap-10">
      <CareerTable H={H} book={book} onPick={setSheet} />
      <RingLeaders H={H} book={book} onPick={setSheet} />
      <ChampionRosters H={H} book={book} />
      <CareerSheet H={H} player={sheet} onClose={() => setSheet(null)} />
    </div>
  );
}

function CareerTable({ H, book, onPick }: { H: Hist; book: CareerBook; onPick: (p: PlayerCareer) => void }) {
  const rows = useMemo(() => book.players.filter((p) => p.weeks > 0 || p.startPts !== 0), [book]);
  const filters = useMemo<FilterDef<PlayerCareer>[]>(() => [
    { id: 'pos', label: 'Position', options: POS_FILTER, test: (p, v) => p.pos === v },
    { id: 'era', label: 'Era', options: [['all', 'All seasons'], ['full', `${book.full[0]} on (full detail)`], ['early', `Before ${book.full[0]}`], ['now', 'Still in the league']], test: (p, v) => (v === 'full' ? p.last >= book.full[0]! : v === 'early' ? p.first < book.full[0]! : p.last >= book.through) },
    { id: 'rings', label: 'Titles', options: [['all', 'Everyone'], ['ring', 'Won at least one'], ['multi', 'Won two or more']], test: (p, v) => (v === 'ring' ? p.rings >= 1 : p.rings >= 2) },
    { id: 'owner', label: 'Started for', options: [['all', 'Any manager'], ...[...H.owners.values()].filter((o) => !o.filler).map((o) => [o.key, o.name] as [string, string])], test: (p, v) => p.owners.includes(v) },
  ], [H, book]);
  const search = useMemo(() => ({ placeholder: 'Player name', of: (p: PlayerCareer) => p.name }), []);
  const cols = useMemo<Col<PlayerCareer>[]>(() => [
    { id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[11rem]', value: (p) => p.name, cell: (p) => <button type="button" className="link text-left" onClick={() => onPick(p)}>{p.name}</button> },
    { id: 'pos', label: 'Pos', left: true, value: (p) => p.pos, cell: (p) => <PosTag pos={p.pos} /> },
    { id: 'startPts', label: 'Starter pts', value: (p) => p.startPts, cell: (p) => <b className="font-semibold">{fmt(p.startPts, 0)}</b> },
    { id: 'weeks', label: 'Starts', value: (p) => p.weeks },
    { id: 'ppw', label: 'Pts/start', value: (p) => p.ppw, cell: (p) => fmt(p.ppw) },
    { id: 'seasons', label: 'Seasons', value: (p) => p.years.length },
    { id: 'span', label: 'Span', left: true, className: 'text-ink-2', value: (p) => (p.first === p.last ? String(p.first) : `${p.first}–${p.last}`) },
    { id: 'rings', label: 'Titles', value: (p) => p.rings, cell: (p) => (p.rings ? <span className="text-accent-ink">{p.rings}</span> : '–') },
    { id: 'best', label: 'Best season', value: (p) => p.best?.pts ?? null, cell: (p) => (p.best ? <span>{fmt(p.best.pts, 0)} <span className="text-ink-3">{p.best.year}</span></span> : '–') },
    { id: 'bench', label: 'Bench pts', hidden: true, value: (p) => p.benchPts, cell: (p) => fmt(p.benchPts, 0) },
    { id: 'rosterWeeks', label: 'Weeks rostered', hidden: true, value: (p) => p.rosterWeeks },
    { id: 'owners', label: 'Managers', left: true, hidden: true, className: 'min-w-[14rem] whitespace-normal text-xs text-ink-2', value: (p) => p.owners.map((o) => who(H, o)).join(', ') },
  ], [H, onPick]);
  const t = useTable('alltime-players', cols, rows, { id: 'startPts', dir: -1 }, { filters, search });
  const top = t.sorted[0];
  return (
    <Section title="All-time players" aside={`${book.through}${book.live ? ` + ${book.live} so far` : ''} · ${rows.length} players`}>
      <p className="max-w-[75ch] text-sm text-ink-2">
        Ranked by the points a player scored <b className="font-medium text-ink">while in an FWHL starting lineup</b>. It is the one number every season has:
        ESPN kept only weekly starters for 2010–{(book.full[0] ?? 2018) - 1}, so bench points and weeks rostered (both optional columns) cover {book.full[0]}
        {' '}on. Points are not adjusted for era, and the Sleeper seasons (2024–25) scored about a third more.
      </p>
      {top && <p className="headline-sm">{top.name}: {fmt(top.startPts, 0)} points in {top.weeks} starts{top.rings ? `, ${top.rings} title${top.rings === 1 ? '' : 's'}` : ''}</p>}
      <TableBar t={t} noun="players" file="fwhl-all-time-players" />
      <DataTable t={t} rowKey={(p) => `${p.name}|${p.pos}`} stickyId="name" limit={150} minWidth="min-w-[52rem]" empty="No player matches these filters." />
      {t.sorted.length > 150 && <p className="text-xs text-ink-3">Showing the first 150. Narrow it with the filters, or export the CSV for all {t.sorted.length}.</p>}
    </Section>
  );
}

function RingLeaders({ H, book, onPick }: { H: Hist; book: CareerBook; onPick: (p: PlayerCareer) => void }) {
  const rows = useMemo(() => book.players.filter((p) => p.rings > 0), [book]);
  const filters = useMemo<FilterDef<PlayerCareer>[]>(() => [
    { id: 'pos', label: 'Position', options: POS_FILTER, test: (p, v) => p.pos === v },
    { id: 'owner', label: 'Won with', options: [['all', 'Any manager'], ...[...H.owners.values()].filter((o) => !o.filler).map((o) => [o.key, o.name] as [string, string])], test: (p, v) => p.seasons.some((s) => s.ring && s.owner === v) },
  ], [H]);
  const search = useMemo(() => ({ placeholder: 'Player name', of: (p: PlayerCareer) => p.name }), []);
  const cols = useMemo<Col<PlayerCareer>[]>(() => [
    { id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[11rem]', value: (p) => p.name, cell: (p) => <button type="button" className="link text-left" onClick={() => onPick(p)}>{p.name}</button> },
    { id: 'pos', label: 'Pos', left: true, value: (p) => p.pos, cell: (p) => <PosTag pos={p.pos} /> },
    { id: 'rings', label: 'Titles', value: (p) => p.rings, cell: (p) => <b className="font-semibold text-accent-ink">{p.rings}</b> },
    { id: 'years', label: 'Seasons won', left: true, className: 'min-w-[10rem]', value: (p) => p.ringYears.join(' '), cell: (p) => <span className="num text-sm">{p.ringYears.join(', ')}</span> },
    { id: 'with', label: 'For', left: true, className: 'min-w-[12rem] whitespace-normal text-sm text-ink-2', value: (p) => [...new Set(p.seasons.filter((s) => s.ring).map((s) => who(H, s.owner)))].join(', ') },
    { id: 'startPts', label: 'Starter pts', value: (p) => p.startPts, cell: (p) => fmt(p.startPts, 0) },
  ], [H, onPick]);
  const t = useTable('ring-leaders', cols, rows, { id: 'rings', dir: -1 }, { filters, search });
  return (
    <Section title="On the most championship rosters" aside="Counted once per title">
      <p className="max-w-[75ch] text-sm text-ink-2">A player counts for a title if he was on the champion's roster at the end of that season — the last week of lineups, or the end-of-season roster for the seasons that kept starters only.</p>
      <TableBar t={t} noun="players" file="fwhl-championship-rosters" />
      <DataTable t={t} rowKey={(p) => `${p.name}|${p.pos}`} stickyId="name" minWidth="min-w-[48rem]" empty="No player matches these filters." />
    </Section>
  );
}

function ChampionRosters({ H, book }: { H: Hist; book: CareerBook }) {
  const rosters = useMemo(() => ringRosters(book), [book]);
  const [year, setYear] = useState<number | null>(null);
  const open = year === null ? rosters[0] : rosters.find((r) => r.year === year) ?? rosters[0];
  if (!open) return null;
  return (
    <Section title="Every championship roster" aside={`${rosters.length} titles`}>
      <div className="seg w-max max-w-full overflow-x-auto" role="group" aria-label="Season">
        {rosters.map((r) => <button key={r.year} type="button" aria-pressed={r.year === open.year} onClick={() => setYear(r.year)}>{r.year}</button>)}
      </div>
      <p className="headline-sm">{open.year}: {who(H, open.owner)}</p>
      <ul className="grid gap-x-8 sm:grid-cols-2 lg:grid-cols-3">
        {open.players.map((p) => {
          const s = p.seasons.find((x) => x.year === open.year && x.ring);
          return (
            <li key={`${p.name}|${p.pos}`} className="flex items-baseline justify-between gap-3 border-b border-rule py-1.5">
              <span className="flex min-w-0 items-center gap-2"><PosTag pos={p.pos} /><span className="truncate">{p.name}</span></span>
              <span className="num shrink-0 text-sm text-ink-2">{s && s.weeks > 0 ? `${fmt(s.startPts, 0)} in ${s.weeks}` : 'bench'}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-3">Points are what he scored as a starter for that team that season.</p>
    </Section>
  );
}

function CareerSheet({ H, player, onClose }: { H: Hist; player: PlayerCareer | null; onClose: () => void }) {
  if (!player) return null;
  return (
    <div role="dialog" aria-label={`${player.name} career`} className="fixed inset-0 z-40 grid place-items-end bg-ink/50 sm:place-items-center" onClick={onClose}>
      <div className="max-h-[88dvh] w-full max-w-xl overflow-y-auto border border-rule-strong bg-surface" onClick={(e) => e.stopPropagation()}>
        <header className="sticky top-0 flex items-center justify-between gap-4 border-b border-rule bg-surface px-5 py-3">
          <h2 className="text-lg">{player.name} · {player.pos}</h2>
          <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
        </header>
        <div className="grid gap-4 p-5">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {[['Starter pts', fmt(player.startPts, 0)], ['Starts', String(player.weeks)], ['Pts/start', fmt(player.ppw)], ['Titles', String(player.rings)]].map(([l, v]) => (
              <div key={l} className="border-t border-rule pt-1"><dt className="text-xs text-ink-3">{l}</dt><dd className="num text-lg">{v}</dd></div>
            ))}
          </dl>
          <table className="tbl">
            <thead><tr><th className="l">Season</th><th className="l">Manager</th><th>Starter pts</th><th>Starts</th><th className="l">Title</th></tr></thead>
            <tbody>
              {player.seasons.map((s, i) => (
                <tr key={`${s.year}-${s.owner}-${i}`}>
                  <td className="l n">{s.year}{s.live ? ' *' : ''}</td>
                  <td className="l">{who(H, s.owner)}</td>
                  <td className="n">{fmt(s.startPts, 0)}</td>
                  <td className="n">{s.weeks}</td>
                  <td className="l">{s.ring ? <span className="tag text-accent-ink">Champion</span> : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {player.seasons.some((s) => s.live) && <p className="text-xs text-ink-3">* this season so far.</p>}
        </div>
      </div>
    </div>
  );
}

// ---------- 2. Trading ----------
const METRICS: [TraderMetric, string][] = [['score', 'Grade'], ['value', 'Chart value'], ['rawGain', 'Points gained'], ['parGain', 'Points above replacement'], ['keep', 'Keeper value']];

export function Traders({ H, onOwner }: { H: Hist; onOwner: (o: OwnerKey) => void }) {
  const T = useTrades();
  const { values: V } = useLeague();
  const [metric, setMetric] = useState<TraderMetric>('score');
  const lines = useMemo<TradeLine[] | null>(() => {
    if (T === null || typeof T === 'string') return null;
    const byTeam = new Map([...H.owners.values()].filter((o) => o.teamId !== null && !o.filler).map((o) => [o.teamId!, o.key]));
    const live = H.seasons.find((s) => s.live) ? liveLines(V, (t) => byTeam.get(t)) : [];
    return [...historyLines(T), ...live];
  }, [T, H, V]);
  const careers = useMemo(() => (lines ? traderCareers(lines) : []), [lines]);
  if (T === null) return <p className="text-sm text-ink-3" role="status">Loading the trade history…</p>;
  if (typeof T === 'string') return <Empty>{T}</Empty>;
  const { best, worst } = bestAndWorst(careers, metric);
  const num = (c: TraderCareer, m: TraderMetric) => (m === 'score' ? c.grade ?? '–' : c[m] === null ? '–' : m === 'value' || m === 'keep' ? `${signed(c[m]!, 0)}` : signed(c[m]!, 0));
  return (
    <div className="grid grid-cols-1 gap-10">
      <Section title="Trading careers" aside={`${lines!.length / 2} trades, 2018 to now`}>
        <p className="max-w-[75ch] text-sm text-ink-2">
          Every side of every trade since 2018, graded the way the Tracker grades a live one. <b className="font-medium text-ink">Points gained</b> is what the players a manager
          received actually scored after the trade, minus what the players he sent away scored. <b className="font-medium text-ink">Above replacement</b> measures the same thing
          against a startable player at the position, so a bench piece counts for nothing. Chart values only exist for this season, so earlier trades leave that column blank.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-ink-3">Best and worst by
            <select className="field w-auto text-sm font-medium normal-case tracking-normal text-ink" value={metric} onChange={(e) => setMetric(e.target.value as TraderMetric)}>
              {METRICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        {best && worst && (
          <div className="grid gap-3 sm:grid-cols-2">
            <p className="border-l-2 border-gain pl-3"><span className="text-xs uppercase tracking-wider text-ink-3">Best</span><br /><b className="headline-sm">{who(H, best.owner)}</b> <span className="num">{num(best, metric)}</span> <span className="text-sm text-ink-2">over {best.trades} trades</span></p>
            <p className="border-l-2 border-loss pl-3"><span className="text-xs uppercase tracking-wider text-ink-3">Worst</span><br /><b className="headline-sm">{who(H, worst.owner)}</b> <span className="num">{num(worst, metric)}</span> <span className="text-sm text-ink-2">over {worst.trades} trades</span></p>
          </div>
        )}
        {(metric === 'rawGain' || metric === 'parGain' || metric === 'keep') && (
          <p className="text-sm text-ink-3">That is a running total, so it rewards whoever trades most. Sort the table by grade for a rate instead.</p>
        )}
        <TraderTable H={H} rows={careers} onOwner={onOwner} />
        <p className="text-xs text-ink-3">Best and worst need at least 3 trades. A trade counts as won at C+ or better, lost at C− or worse.</p>
      </Section>
      <TradeLines H={H} lines={lines!} />
    </div>
  );
}

function TraderTable({ H, rows, onOwner }: { H: Hist; rows: TraderCareer[]; onOwner: (o: OwnerKey) => void }) {
  const filters = useMemo<FilterDef<TraderCareer>[]>(() => [
    { id: 'vol', label: 'Trades', options: [['all', 'Any number'], ['3', '3 or more'], ['10', '10 or more']], test: (c, v) => c.trades >= Number(v) },
    { id: 'now', label: 'Manager', options: [['all', 'Everyone'], ['in', 'Still in the league']], test: (c) => H.owners.get(c.owner)?.teamId != null },
  ], [H]);
  const search = useMemo(() => ({ label: 'Find a manager', placeholder: 'Name', of: (c: TraderCareer) => who(H, c.owner) }), [H]);
  const cols = useMemo<Col<TraderCareer>[]>(() => [
    { id: 'owner', label: 'Manager', left: true, fixed: true, className: 'min-w-[9rem]', value: (c) => who(H, c.owner), cell: (c) => <button type="button" className="link text-left" onClick={() => onOwner(c.owner)}>{who(H, c.owner)}</button> },
    { id: 'trades', label: 'Trades', value: (c) => c.trades },
    { id: 'grade', label: 'Grade', value: (c) => c.score, cell: (c) => (c.grade ? <span className="inline-flex items-center gap-2"><Stamp grade={c.grade} size="sm" /><span className="num text-xs text-ink-3">{c.score?.toFixed(2)}</span></span> : '–') },
    { id: 'record', label: 'Won–lost', left: true, className: 'text-ink-2', value: (c) => c.wins - c.losses, cell: (c) => `${c.wins}–${c.losses}` },
    { id: 'rawGain', label: 'Points gained', value: (c) => c.rawGain, cell: (c) => <span className={tone(c.rawGain ?? 0, 10)}>{c.rawGain === null ? '–' : signed(c.rawGain, 0)}</span> },
    { id: 'parGain', label: 'Above repl.', value: (c) => c.parGain, cell: (c) => <span className={tone(c.parGain ?? 0, 10)}>{c.parGain === null ? '–' : signed(c.parGain, 0)}</span> },
    { id: 'parWk', label: 'Above repl./wk', hidden: true, value: (c) => c.parWk, cell: (c) => (c.parWk === null ? '–' : signed(c.parWk, 2)) },
    { id: 'value', label: 'Chart value', value: (c) => c.value, cell: (c) => (c.value === null ? '–' : <span className={tone(c.value, 2)}>{signed(c.value, 0)}</span>) },
    { id: 'keep', label: 'Keeper value', value: (c) => c.keep, cell: (c) => <span className={tone(c.keep, 5)}>{c.keep === 0 ? '$0' : `${signed(c.keep, 0).replace(/^([+−])/, '$1$')}`}</span> },
    { id: 'best', label: 'Best trade', left: true, hidden: true, className: 'min-w-[14rem] whitespace-normal text-xs text-ink-2', value: (c) => (c.best ? `${c.best.year} got ${c.best.got.join(', ')}` : '') },
    { id: 'years', label: 'Seasons', left: true, hidden: true, className: 'text-xs text-ink-2', value: (c) => c.years.join(' ') },
  ], [H, onOwner]);
  const t = useTable('traders', cols, rows, { id: 'grade', dir: -1 }, { filters, search });
  return (
    <>
      <TableBar t={t} noun="managers" file="fwhl-trading-careers" />
      <DataTable t={t} rowKey={(c) => c.owner} stickyId="owner" minWidth="min-w-[52rem]" empty="No manager matches these filters." />
    </>
  );
}

function TradeLines({ H, lines }: { H: Hist; lines: TradeLine[] }) {
  const years = useMemo(() => [...new Set(lines.map((l) => l.year))].sort((a, b) => b - a), [lines]);
  const filters = useMemo<FilterDef<TradeLine>[]>(() => [
    { id: 'year', label: 'Season', options: [['all', 'All seasons'], ...years.map((y) => [String(y), String(y)] as [string, string])], test: (l, v) => l.year === Number(v) },
    { id: 'owner', label: 'Manager', options: [['all', 'Everyone'], ...[...H.owners.values()].filter((o) => !o.filler).map((o) => [o.key, o.name] as [string, string])], test: (l, v) => l.owner === v },
    { id: 'out', label: 'Outcome', options: [['all', 'Every trade'], ['won', 'Won it'], ['lost', 'Lost it']], test: (l, v) => (v === 'won' ? (l.score ?? 0) > 0.04 : (l.score ?? 0) < -0.04) },
  ], [H, years]);
  const search = useMemo(() => ({ label: 'Find a player', placeholder: 'Player name', of: (l: TradeLine) => `${l.got.join(' ')} ${l.gave.join(' ')}` }), []);
  const cols = useMemo<Col<TradeLine>[]>(() => [
    { id: 'year', label: 'Season', left: true, fixed: true, value: (l) => l.year * 100 + l.week, cell: (l) => <span className="num">{l.year}<span className="text-ink-3"> Wk {l.week}</span></span> },
    { id: 'owner', label: 'Manager', left: true, className: 'min-w-[8rem]', value: (l) => who(H, l.owner) },
    { id: 'grade', label: 'Grade', value: (l) => l.score, cell: (l) => (l.grade ? <Stamp grade={l.grade} size="sm" /> : '–') },
    { id: 'got', label: 'Got', left: true, className: 'min-w-[12rem] whitespace-normal', value: (l) => l.got.join(', ') },
    { id: 'gave', label: 'Gave', left: true, className: 'min-w-[12rem] whitespace-normal text-ink-2', value: (l) => l.gave.join(', ') },
    { id: 'raw', label: 'Points gained', value: (l) => (l.rawGot === null || l.rawGave === null ? null : l.rawGot - l.rawGave), cell: (l) => (l.rawGot === null || l.rawGave === null ? '–' : <span className={tone(l.rawGot - l.rawGave, 10)}>{signed(l.rawGot - l.rawGave, 0)}</span>) },
    { id: 'parWk', label: 'Above repl./wk', value: (l) => l.parWk, cell: (l) => (l.parWk === null ? '–' : <span className={tone(l.parWk, 1)}>{signed(l.parWk)}</span>) },
    { id: 'value', label: 'Chart value', hidden: true, value: (l) => l.value, cell: (l) => (l.value === null ? '–' : signed(l.value, 0)) },
    { id: 'partner', label: 'With', left: true, hidden: true, className: 'text-ink-2', value: (l) => who(H, l.partner) },
  ], [H]);
  const t = useTable('trade-lines', cols, lines, { id: 'year', dir: -1 }, { filters, search });
  return (
    <Section title="Every trade, both sides" aside={`${lines.length} sides`}>
      <TableBar t={t} noun="sides" file="fwhl-trade-sides" />
      <DataTable t={t} rowKey={(l, i) => `${l.id}-${l.owner}-${i}`} limit={100} minWidth="min-w-[60rem]" empty="No trade matches these filters." />
    </Section>
  );
}

// ---------- 3. Keeper calls ----------
const KEEPER_METRICS: [KeeperMetric, string][] = [['par', 'Points gained'], ['parPer', 'Points per keeper'], ['value', 'Value gained'], ['valuePer', 'Value per keeper'], ['hitRate', 'Hit rate']];

export function KeeperSkill({ H, onOwner }: { H: Hist; onOwner: (o: OwnerKey) => void }) {
  const book = useDraftBook(H);
  const [metric, setMetric] = useState<KeeperMetric>('par');
  const careers = useMemo(() => (book && typeof book !== 'string' ? keeperCareers(keeperBets(book)) : []), [book]);
  if (book === null) return <p className="text-sm text-ink-3" role="status">Loading the draft history…</p>;
  if (typeof book === 'string') return <Empty>{book}</Empty>;
  const { best, worst } = bestAndWorstKeepers(careers, metric);
  const num = (c: KeeperCareer) => {
    const v = c[metric];
    return v === null ? '–' : metric === 'hitRate' ? `${Math.round(v * 100)}%` : metric.startsWith('value') ? signed(v, 0).replace(/^([+−])/, '$1$') : signed(v, 0);
  };
  const bets = careers.reduce((a, c) => a + c.keepers, 0);
  return (
    <div className="grid grid-cols-1 gap-10">
      <Section title="Who picks the right keepers" aside={`${bets} keepers kept since 2011`}>
        <p className="max-w-[75ch] text-sm text-ink-2">
          Every player a manager kept is a bet: his keeper price against what he turned out to be worth that season.
          <b className="font-medium text-ink"> Points gained</b> is the points a keeper scored above a startable player at his position.
          <b className="font-medium text-ink"> Value</b> is that season's hindsight worth minus the price paid, in auction dollars. <ValueHelp />
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-ink-3">Best and worst by
            <select className="field w-auto text-sm font-medium normal-case tracking-normal text-ink" value={metric} onChange={(e) => setMetric(e.target.value as KeeperMetric)}>
              {KEEPER_METRICS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        {best && worst && (
          <div className="grid gap-3 sm:grid-cols-2">
            <p className="border-l-2 border-gain pl-3"><span className="text-xs uppercase tracking-wider text-ink-3">Best</span><br /><b className="headline-sm">{who(H, best.owner)}</b> <span className="num">{num(best)}</span> <span className="text-sm text-ink-2">from {best.keepers} keepers</span></p>
            <p className="border-l-2 border-loss pl-3"><span className="text-xs uppercase tracking-wider text-ink-3">Worst</span><br /><b className="headline-sm">{who(H, worst.owner)}</b> <span className="num">{num(worst)}</span> <span className="text-sm text-ink-2">from {worst.keepers} keepers</span></p>
          </div>
        )}
        {(metric === 'par' || metric === 'value') && (
          <p className="text-sm text-ink-3">That is a running total, so it rewards whoever kept the most players. Points per keeper, value per keeper and hit rate are the rates.</p>
        )}
        <KeeperCareerTable H={H} rows={careers} onOwner={onOwner} />
        <p className="text-xs text-ink-3">Best and worst need at least 3 keepers with a season to judge.</p>
      </Section>
      <KeeperBetTable H={H} rows={careers.flatMap((c) => c.bets)} />
    </div>
  );
}

function KeeperCareerTable({ H, rows, onOwner }: { H: Hist; rows: KeeperCareer[]; onOwner: (o: OwnerKey) => void }) {
  const filters = useMemo<FilterDef<KeeperCareer>[]>(() => [
    { id: 'vol', label: 'Keepers', options: [['all', 'Any number'], ['3', '3 or more'], ['10', '10 or more']], test: (c, v) => c.keepers >= Number(v) },
    { id: 'now', label: 'Manager', options: [['all', 'Everyone'], ['in', 'Still in the league']], test: (c) => H.owners.get(c.owner)?.teamId != null },
  ], [H]);
  const search = useMemo(() => ({ label: 'Find a manager', placeholder: 'Name', of: (c: KeeperCareer) => who(H, c.owner) }), [H]);
  const cols = useMemo<Col<KeeperCareer>[]>(() => [
    { id: 'owner', label: 'Manager', left: true, fixed: true, className: 'min-w-[9rem]', value: (c) => who(H, c.owner), cell: (c) => <button type="button" className="link text-left" onClick={() => onOwner(c.owner)}>{who(H, c.owner)}</button> },
    { id: 'keepers', label: 'Keepers', value: (c) => c.keepers },
    { id: 'spend', label: 'Spent', value: (c) => c.spend, cell: (c) => `$${c.spend}` },
    { id: 'par', label: 'Points gained', value: (c) => c.par, cell: (c) => (c.par === null ? '–' : <b className="font-semibold">{fmt(c.par, 0)}</b>) },
    { id: 'parPer', label: 'Points/keeper', value: (c) => c.parPer, cell: (c) => fmt(c.parPer, 0) },
    { id: 'value', label: 'Value gained', value: (c) => c.value, cell: (c) => (c.value === null ? '–' : <span className={tone(c.value, 5)}>{signed(c.value, 0).replace(/^([+−])/, '$1$')}</span>) },
    { id: 'valuePer', label: 'Value/keeper', value: (c) => c.valuePer, cell: (c) => (c.valuePer === null ? '–' : <span className={tone(c.valuePer, 2)}>{signed(c.valuePer, 1).replace(/^([+−])/, '$1$')}</span>) },
    { id: 'hits', label: 'Hit rate', value: (c) => c.hitRate, cell: (c) => (c.hitRate === null ? '–' : <span>{Math.round(c.hitRate * 100)}% <span className="text-ink-3">{c.hits}/{c.scored}</span></span>) },
    { id: 'best', label: 'Best keeper', left: true, hidden: true, className: 'min-w-[12rem] text-xs text-ink-2', value: (c) => (c.best ? `${c.best.name} ${c.best.year}` : '') },
    { id: 'worst', label: 'Worst keeper', left: true, hidden: true, className: 'min-w-[12rem] text-xs text-ink-2', value: (c) => (c.worst ? `${c.worst.name} ${c.worst.year}` : '') },
  ], [H, onOwner]);
  const t = useTable('keeper-careers', cols, rows, { id: 'par', dir: -1 }, { filters, search });
  return (
    <>
      <TableBar t={t} noun="managers" file="fwhl-keeper-careers" />
      <DataTable t={t} rowKey={(c) => c.owner} stickyId="owner" minWidth="min-w-[52rem]" empty="No manager matches these filters." />
    </>
  );
}

function KeeperBetTable({ H, rows }: { H: Hist; rows: ReturnType<typeof keeperBets> }) {
  const years = useMemo(() => [...new Set(rows.map((b) => b.year))].sort((a, b) => b - a), [rows]);
  const filters = useMemo<FilterDef<(typeof rows)[number]>[]>(() => [
    { id: 'year', label: 'Season', options: [['all', 'All seasons'], ...years.map((y) => [String(y), String(y)] as [string, string])], test: (b, v) => b.year === Number(v) },
    { id: 'pos', label: 'Position', options: POS_FILTER, test: (b, v) => b.pos === v },
    { id: 'owner', label: 'Manager', options: [['all', 'Everyone'], ...[...H.owners.values()].filter((o) => !o.filler).map((o) => [o.key, o.name] as [string, string])], test: (b, v) => b.owner === v },
    { id: 'hit', label: 'Outcome', options: [['all', 'Every keeper'], ['hit', 'Worth the price'], ['miss', 'Not worth it']], test: (b, v) => (v === 'hit' ? b.hit : !b.hit) },
  ], [H, years]);
  const search = useMemo(() => ({ label: 'Find a player', placeholder: 'Player name', of: (b: (typeof rows)[number]) => b.name }), []);
  const cols = useMemo<Col<(typeof rows)[number]>[]>(() => [
    { id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[11rem]', value: (b) => b.name },
    { id: 'pos', label: 'Pos', left: true, value: (b) => b.pos, cell: (b) => <PosTag pos={b.pos} /> },
    { id: 'year', label: 'Season', value: (b) => b.year },
    { id: 'owner', label: 'Kept by', left: true, className: 'min-w-[8rem]', value: (b) => who(H, b.owner) },
    { id: 'price', label: 'Price', value: (b) => b.price, cell: (b) => `$${b.price}` },
    { id: 'worth', label: 'Worth', value: (b) => b.worth, cell: (b) => (b.worth === null ? '–' : `$${b.worth}`) },
    { id: 'value', label: 'Value', value: (b) => b.value, cell: (b) => (b.value === null ? '–' : <b className={`font-semibold ${tone(b.value, 1.5)}`}>{signed(b.value, 0).replace(/^([+−])/, '$1$')}</b>) },
    { id: 'par', label: 'Points over repl.', value: (b) => b.par, cell: (b) => fmt(b.par, 0) },
    { id: 'pts', label: 'Season pts', hidden: true, value: (b) => b.pick.pts, cell: (b) => fmt(b.pick.pts, 0) },
  ], [H]);
  const t = useTable('keeper-bets', cols, rows, { id: 'value', dir: -1 }, { filters, search });
  return (
    <Section title="Every keeper kept" aside={`${rows.length} since 2011`}>
      <TableBar t={t} noun="keepers" file="fwhl-keepers-kept" />
      <DataTable t={t} rowKey={(b, i) => `${b.year}-${b.name}-${i}`} stickyId="name" limit={100} minWidth="min-w-[52rem]" empty="No keeper matches these filters." />
    </Section>
  );
}

// ---------- roster building (Nic, Nov 13) ----------
// Four measures, each ranked on its own. No blended score: the whole finding is that the best
// drafter in the league is also its worst keeper picker, and a single number hides that.
function Bar({ v, lo, hi, good }: { v: number | null; lo: number; hi: number; good: boolean }) {
  if (v === null) return null;
  const span = hi - lo || 1;
  const zero = ((0 - lo) / span) * 100, at = ((v - lo) / span) * 100;
  const [from, w] = v >= 0 ? [Math.max(0, Math.min(zero, at)), Math.abs(at - zero)] : [Math.max(0, at), Math.abs(zero - at)];
  return (
    <span className="relative mt-1 block h-1 w-full rounded-full bg-sunk" aria-hidden="true">
      {lo < 0 && hi > 0 && <span className="absolute inset-y-[-1px] w-px bg-rule-strong" style={{ left: `${zero}%` }} />}
      <span className={`absolute inset-y-0 rounded-full ${good ? 'bg-gain' : 'bg-loss'}`} style={{ left: `${from}%`, width: `${Math.max(w, 1.5)}%` }} />
    </span>
  );
}

// Rounded auction dollars; a value that rounds to zero is plain "$0", never "−$0".
const dollars = (v: number | null) => (v === null ? '–' : Math.abs(v) < 0.5 ? '$0' : signed(v, 0).replace(/^([+−])/, '$1$'));

function Crown({ H, label, note, b, num }: { H: Hist; label: string; note: string; b: BuilderCareer | null; num: (b: BuilderCareer) => string }) {
  return (
    <div className="border-l-2 border-accent-ink pl-3">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      <br />
      {b ? <><b className="headline-sm">{who(H, b.owner)}</b> <span className="num">{num(b)}</span></> : <span className="text-sm text-ink-3">Not enough to judge</span>}
      <span className="block text-xs text-ink-3">{note}</span>
    </div>
  );
}

export function RosterBuilders({ H, onOwner }: { H: Hist; onOwner: (o: OwnerKey) => void }) {
  const book = useDraftBook(H);
  const cb = useCareerBook(H);
  const [everyone, setEveryone] = useState(false);
  const all = useMemo(
    () => (book && typeof book !== 'string' && cb && typeof cb !== 'string' ? builderCareers(H, book, careers(H), cb) : []),
    [H, book, cb],
  );
  if (book === null || cb === null) return <p className="text-sm text-ink-3" role="status">Loading the draft and roster history…</p>;
  if (typeof book === 'string') return <Empty>{book}</Empty>;
  if (typeof cb === 'string') return <Empty>{cb}</Empty>;
  const rows = everyone ? all : all.filter((b) => b.lifer);
  const num: Record<BuilderMetric, (b: BuilderCareer) => string> = {
    draft: (b) => dollars(b.draft), keeper: (b) => dollars(b.keeper),
    index: (b) => fmt(b.index, 3), capture: (b) => pct(b.capture),
  };
  return (
    <Section
      title="Who builds the best roster"
      aside={<Seg label="Managers shown" value={everyone ? 'all' : 'lifers'} options={[['lifers', `Lifers (${LIFER_SEASONS}+ seasons)`], ['all', 'Everyone']]} onChange={(v) => setEveryone(v === 'all')} />}
    >
      <div className="max-w-[75ch] text-sm text-ink-2">
        Four measures of roster building, each ranked on its own and each a <b className="font-medium text-ink">rate</b>, so a 17-season
        manager and a 6-season one compare honestly. There is deliberately no combined score: the league's best drafter is also its worst
        keeper picker, and one number would hide that. <ValueHelp />
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {BUILDER_METRICS.map((m) => <Crown key={m.id} H={H} label={m.label} note={m.note} b={bestAndWorstBuilders(rows, m.id).best} num={num[m.id]} />)}
      </div>
      <BuilderTable H={H} rows={rows} onOwner={onOwner} />
      <p className="text-xs text-ink-3">
        A crown needs {MIN_DRAFTS} drafts, or {MIN_CAPTURE_YEARS} seasons of bench detail for capture. Co-owned seasons count in full for both
        managers, so the dollar columns are not a league total. Scoring and capture come from finished seasons and the live one; 2026 moves
        with each weekly push.
      </p>
    </Section>
  );
}

function BuilderTable({ H, rows, onOwner }: { H: Hist; rows: BuilderCareer[]; onOwner: (o: OwnerKey) => void }) {
  const range = (f: (b: BuilderCareer) => number | null) => {
    const vs = rows.map(f).filter((v): v is number => v !== null);
    return [Math.min(0, ...vs), Math.max(0, ...vs)] as const;
  };
  const [dLo, dHi] = range((b) => b.draft), [kLo, kHi] = range((b) => b.keeper);
  const filters = useMemo<FilterDef<BuilderCareer>[]>(() => [
    { id: 'now', label: 'Manager', options: [['all', 'Everyone'], ['in', 'Still in the league']], test: (b) => b.active },
  ], []);
  const search = useMemo(() => ({ label: 'Find a manager', placeholder: 'Name', of: (b: BuilderCareer) => who(H, b.owner) }), [H]);
  const cols = useMemo<Col<BuilderCareer>[]>(() => [
    { id: 'owner', label: 'Manager', left: true, fixed: true, className: 'min-w-[9rem]', value: (b) => who(H, b.owner), cell: (b) => <button type="button" className="link text-left" onClick={() => onOwner(b.owner)}>{who(H, b.owner)}</button> },
    { id: 'seasons', label: 'Seasons', value: (b) => b.seasons },
    { id: 'drafts', label: 'Drafts', className: 'hidden md:table-cell', value: (b) => b.drafts },
    { id: 'draft', label: 'Draft $/draft', className: '!h-auto py-1.5', value: (b) => b.draft, cell: (b) => (
      <span className="block"><b className={`font-semibold ${b.draft === null ? '' : tone(b.draft, 2)}`}>{dollars(b.draft)}</b><Bar v={b.draft} lo={dLo} hi={dHi} good={(b.draft ?? 0) >= 0} /></span>
    ) },
    { id: 'picks', label: 'Picks', hidden: true, value: (b) => b.picks },
    { id: 'keeper', label: 'Keeper $/draft', className: '!h-auto py-1.5', value: (b) => b.keeper, cell: (b) => (
      <span className="block"><b className={`font-semibold ${b.keeper === null ? '' : tone(b.keeper, 2)}`}>{dollars(b.keeper)}</b><Bar v={b.keeper} lo={kLo} hi={kHi} good={(b.keeper ?? 0) >= 0} /></span>
    ) },
    { id: 'keepers', label: 'Keepers', className: 'hidden md:table-cell', value: (b) => b.keepers },
    { id: 'index', label: 'Scoring', value: (b) => b.index, cell: (b) => <span className={tone(b.index - 1, 0.015)}>{fmt(b.index, 3)}</span> },
    { id: 'capture', label: 'Capture', value: (b) => b.capture, cell: (b) => (b.capture === null ? '–' : <span className={ranked(b, 'capture') ? '' : 'text-ink-3'}>{pct(b.capture)}{ranked(b, 'capture') ? '' : <span className="text-ink-3"> ({b.captureYears}y)</span>}</span>) },
  ], [H, onOwner, dLo, dHi, kLo, kHi]);
  const t = useTable('roster-builders', cols, rows, { id: 'draft', dir: -1 }, { filters, search });
  return (
    <>
      <TableBar t={t} noun="managers" file="fwhl-roster-builders" />
      <DataTable t={t} rowKey={(b) => b.owner} stickyId="owner" minWidth="min-w-[48rem]" empty="No manager matches these filters." />
    </>
  );
}
