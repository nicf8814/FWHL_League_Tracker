import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRoute } from '../app/router.ts';
import { useLeague } from '../data/store.tsx';
import { validateHistory, type History as HistoryFile, type OwnerKey } from '../data/history.ts';
import {
  buildHist, careers, crew, headToHead, LIFER_SEASONS, ownerName, records, seasonAwards,
  type Career, type CareerSeason, type Game, type H2H, type Hist, type ScoreRec, type Season,
} from '../engine/history.ts';
import { Empty, fmt, Mono, Section, Seg, signed, tone } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import SeasonWeeks, { type WeekState } from './HistoryWeeks.tsx';
import { DraftSearch, SeasonDraft } from './HistoryDrafts.tsx';
import { OwnerTrades, SeasonTrades, TradeSearch } from './HistoryTrades.tsx';
import { AllTimePlayers, KeeperSkill, RosterBuilders, Traders } from './HistoryManagers.tsx';

// Pick a season (or All seasons) and what to show from two dropdowns; the page below fills in.
// ?season=all|<year>&view=<section>; ?owner= an owner's page; ?wk=<year>-<week>&m=<owner> a week and
// open game. Older links (?tab=, ?year=) still land in the right place.
const URL_ = `${import.meta.env.BASE_URL}seed/history.json`;
type Tab = 'champions' | 'owners' | 'players' | 'builders' | 'trading' | 'keepers' | 'luck' | 'rivals' | 'records' | 'drafts' | 'trades';
const TABS: [Tab, string][] = [['champions', 'Champions'], ['owners', 'Owners'], ['players', 'All-time players'], ['builders', 'Roster building'], ['trading', 'Trading'], ['keepers', 'Keepers'], ['luck', 'Luck'], ['rivals', 'Rivals'], ['records', 'Records'], ['drafts', 'Drafts'], ['trades', 'Trades']];
type SeasonView = 'standings' | 'weeks' | 'draft' | 'trades';
const seasonViews = (s: Season): [SeasonView, string][] => [['standings', 'Standings'], ...(s.live ? [] : [['weeks', 'Week by week'] as [SeasonView, string]]), ['draft', 'Draft'], ['trades', 'Trades']];

function useHistoryFile() {
  const [state, setState] = useState<HistoryFile | string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(URL_, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((raw) => { const v = validateHistory(raw); if (live) setState(v.ok ? v.value : `The history file is invalid: ${v.errors[0]}`); })
      .catch((e) => live && setState(`Could not load the league history (${e instanceof Error ? e.message : e}).`));
    return () => { live = false; };
  }, []);
  return state;
}

export default function HistoryView() {
  const { idx } = useLeague();
  const file = useHistoryFile();
  const H = useMemo(() => (file && typeof file !== 'string' ? buildHist(file, idx) : null), [file, idx]);
  const all = useMemo(() => (H ? careers(H) : []), [H]);
  const { query, replace } = useRoute();
  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(query);
    for (const [k, v] of Object.entries(patch)) if (v === null) q.delete(k); else q.set(k, v);
    replace('history', q.toString());
  };
  if (typeof file === 'string') return <Empty>{file}</Empty>;
  if (!H) return <p className="text-sm text-ink-3" role="status">Loading the league history…</p>;
  const owner = query.get('owner');
  const c = owner ? all.find((x) => x.owner === owner) : undefined;
  if (c) return <div className="grid grid-cols-1 gap-8"><OwnerPage H={H} c={c} go={set} /></div>;
  return <Browser H={H} all={all} query={query} go={set} />;
}

type Go = (patch: Record<string, string | null>) => void;

function Browser({ H, all, query, go }: { H: Hist; all: Career[]; query: URLSearchParams; go: Go }) {
  const first = H.seasons[0]!.year, last = H.seasons.at(-1)!;
  const wk = parseWk(query.get('wk'));
  const seasonParam = query.get('season') ?? query.get('year') ?? (wk ? String(wk.year) : query.get('tab') || query.get('vs') ? 'all' : 'all');
  const s = seasonParam === 'all' ? undefined : H.byYear.get(Number(seasonParam));
  const views: [string, string][] = s ? seasonViews(s) : TABS;
  const raw = query.get('view') ?? (s ? (wk ? 'weeks' : 'standings') : query.get('tab') ?? 'champions');
  const view = views.find(([v]) => v === raw)?.[0] ?? views[0]![0];
  const pick = (season: string) => go({ season, view: season === 'all' ? (TABS.some(([t]) => t === view) ? view : 'champions') : (['standings', 'weeks', 'draft', 'trades'].includes(view) ? view : 'standings'), year: null, tab: null, wk: null, m: null, vs: null });
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid gap-1">
        <h1 className="headline-sm">League history</h1>
        <p className="text-sm text-ink-2">{H.seasons.length} seasons, {first} to {last.year} · {all.length} owners</p>
      </div>
      <div className="grid grid-cols-2 gap-3 border-y-2 border-ink py-3 sm:flex sm:flex-wrap sm:items-end">
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-ink-3">Season
          <select className="field text-base font-semibold normal-case tracking-normal text-ink sm:w-56" value={s ? String(s.year) : 'all'} onChange={(e) => pick(e.target.value)}>
            <option value="all">All seasons</option>
            {H.seasons.slice().reverse().map((x) => <option key={x.year} value={x.year}>{x.year}{x.live ? ' (in progress)' : x.platform === 'Sleeper' ? ' (Sleeper)' : ''}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-semibold uppercase tracking-wider text-ink-3">Show
          <select className="field text-base font-semibold normal-case tracking-normal text-ink sm:w-56" value={view} onChange={(e) => go({ view: e.target.value, tab: null, wk: null, m: null, vs: null })}>
            {views.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </label>
        {s && <p className="col-span-2 min-w-0 text-sm text-ink-2 sm:col-span-1 sm:pb-2.5"><SeasonLine H={H} s={s} /></p>}
      </div>
      {s ? <SeasonPanel key={s.year} H={H} s={s} go={go} view={view as SeasonView} weeks={wk?.year === s.year ? { week: wk.week, open: query.get('m') } : null} />
        : <>
          {view === 'champions' && <Champions H={H} all={all} go={go} />}
          {view === 'owners' && <Owners H={H} all={all} go={go} />}
          {view === 'luck' && <LuckTab H={H} all={all} go={go} />}
          {view === 'rivals' && <Rivals H={H} all={all} pair={query.get('vs')} go={go} />}
          {view === 'records' && <RecordsTab H={H} go={go} />}
          {view === 'players' && <AllTimePlayers H={H} />}
          {view === 'builders' && <RosterBuilders H={H} onOwner={(o: OwnerKey) => go({ owner: o })} />}
          {view === 'trading' && <Traders H={H} onOwner={(o: OwnerKey) => go({ owner: o })} />}
          {view === 'keepers' && <KeeperSkill H={H} onOwner={(o: OwnerKey) => go({ owner: o })} />}
          {view === 'drafts' && <DraftSearch H={H} />}
          {view === 'trades' && <TradeSearch H={H} />}
        </>}
    </div>
  );
}

// ---------- Small pieces ----------
function OwnerMark({ H, o }: { H: Hist; o: OwnerKey }) {
  const own = H.owners.get(o);
  if (own?.teamId != null && !own.filler) return <Mono team={own.teamId} size="sm" />;
  const name = own?.name ?? o;
  const initials = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  const hue = [...o].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return (
    <span aria-hidden="true" className="inline-grid size-5 shrink-0 place-items-center rounded-sm font-display text-xs font-bold text-[#f4f1e8] [font-stretch:75%]" style={{ background: own?.filler ? 'var(--ink-3)' : `oklch(0.5 0.03 ${hue})` }}>
      {own?.filler ? '—' : initials}
    </span>
  );
}

// An owner, or with `year` everyone who ran that team that season ("Tommy Teves & Nick Heisterkamp").
function Who({ H, o, go, sub, year }: { H: Hist; o: OwnerKey; go?: Go; sub?: ReactNode; year?: number }) {
  const people = year ? crew(H, o, year) : [o];
  const name = (p: OwnerKey) => (go && !H.owners.get(p)?.filler
    ? <button key={p} type="button" className="link text-left no-underline hover:underline" onClick={() => go({ owner: p })}>{ownerName(H, p)}</button>
    : <span key={p}>{ownerName(H, p)}</span>);
  return (
    <span className="grid">
      <span className="flex items-center gap-2"><OwnerMark H={H} o={o} /><span>{people.map((p, i) => <span key={p}>{i > 0 && ' & '}{name(p)}</span>)}</span></span>
      {sub && <span className="pl-7 text-xs text-ink-3">{sub}</span>}
    </span>
  );
}
const names = (H: Hist, o: OwnerKey | undefined, year: number) => (o ? crew(H, o, year).map((p) => ownerName(H, p)).join(' & ') : '–');

const rec = (w: number, l: number, t = 0) => `${w}-${l}${t ? `-${t}` : ''}`;
const vsAvg = (index: number) => `${index >= 1 ? '+' : '−'}${Math.abs((index - 1) * 100).toFixed(0)}%`;
const winPct = (w: number, l: number, t = 0) => (w + l + t ? ((w + t / 2) / (w + l + t)).toFixed(3).replace(/^0/, '') : '–');
const Luck = ({ v }: { v: number }) => <span className={tone(v, 0.5)}>{signed(v)}</span>;
const place = (n: number | null) => (n === null ? '–' : n === 1 ? '1st 🏆' : n === 2 ? '2nd' : n === 3 ? '3rd' : `${n}th`);

function Scroll({ children, min = '' }: { children: ReactNode; min?: string }) {
  return <div className="-mx-4 overflow-x-auto md:mx-0"><table className={`tbl ${min}`}>{children}</table></div>;
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="grid content-start gap-1 border-t border-ink pt-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      <span className="font-display text-lg font-bold [font-stretch:85%]">{value}</span>
      {sub && <span className="text-sm text-ink-2">{sub}</span>}
    </div>
  );
}

// ---------- One season ----------
function SeasonLine({ H, s }: { H: Hist; s: Season }) {
  if (s.live) {
    const lead = s.rows[0];
    const weeks = Math.max(0, ...s.games.map((g) => g.week));
    return <>In progress · through Week {weeks}{lead ? <> · {names(H, lead.owner, s.year)} leads at {rec(lead.w, lead.l, lead.t)}</> : null}</>;
  }
  const team = s.rows.find((r) => r.owner === s.podium[0])?.team;
  return <><span className="font-medium text-ink">🏆 {names(H, s.podium[0], s.year)}</span>{team && <span className="hidden text-ink-3 sm:inline"> · {team}</span>}<span className="block text-xs text-ink-3">over {names(H, s.podium[1], s.year)}</span></>;
}

const parseWk = (v: string | null) => { const m = v?.match(/^(\d{4})-(\d+)$/); return m ? { year: Number(m[1]), week: Number(m[2]) } : null; };

function SeasonPanel({ H, s, go, view, weeks }: { H: Hist; s: Season; go: Go; view: SeasonView; weeks: WeekState | null }) {
  const [ws, setWs] = useState<WeekState>(weeks ?? { week: null, open: null });
  const toWeeks = (w: WeekState) => { setWs(w); go({ wk: `${s.year}-${w.week ?? 1}`, m: w.open }); };
  if (view === 'weeks' && !s.live) return <SeasonWeeks H={H} s={s} state={ws} onState={toWeeks} onOwner={(o) => go({ owner: o })} />;
  if (view === 'draft') return <SeasonDraft H={H} s={s} />;
  if (view === 'trades') return <SeasonTrades H={H} s={s} />;
  return <SeasonStandings H={H} s={s} go={go} />;
}

function SeasonStandings({ H, s, go }: { H: Hist; s: Season; go: Go }) {
  const a = seasonAwards(H, s);
  const tags = new Map<OwnerKey, string[]>();
  const tag = (o: OwnerKey | undefined, t: string) => o && tags.set(o, [...(tags.get(o) ?? []), t]);
  tag(a.mostPoints.owner, 'Most points');
  tag(a.luckiest.owner, 'Luckiest record');
  tag(a.unluckiest.owner, 'Unluckiest record');
  const weeks = Math.max(0, ...s.games.filter((g) => g.kind === 'regular').map((g) => g.week));
  return (
    <>
      {!s.live && (
        <div className="grid gap-x-8 gap-y-4 sm:grid-cols-3">
          {s.podium.map((o, i) => {
            const r = s.rows.find((x) => x.owner === o);
            return <Stat key={o} label={['Champion', 'Runner-up', 'Third'][i]!} value={<Who H={H} o={o} go={go} year={s.year} />} sub={r ? `${r.team} · ${rec(r.w, r.l, r.t)}` : undefined} />;
          })}
        </div>
      )}
      <div className="grid gap-2">
        <Scroll min="min-w-[44rem]">
          <thead><tr><th className="l w-10">{s.live ? 'Now' : 'Final'}</th><th className="l stick">Team</th><th>W-L</th><th>PF</th><th title="Points per game against the league average">Pts vs avg</th><th title="Wins the weekly scores earned against the whole league">xW</th><th title="Wins minus expected wins">Luck</th><th className="l">Note</th></tr></thead>
          <tbody>
            {s.rows.map((r, i) => (
              <tr key={r.owner}>
                <td className="l n">{s.live ? i + 1 : r.finish === 1 ? '🏆' : r.finish ?? '–'}</td>
                <td className="l stick"><Who H={H} o={r.owner} go={go} year={s.year} sub={r.team} /></td>
                <td className="n">{rec(r.w, r.l, r.t)}</td>
                <td className="n">{fmt(r.pf)}</td>
                <td className="n">{vsAvg(r.index)}</td>
                <td className="n text-ink-2">{fmt(r.xw)}</td>
                <td className="n"><Luck v={r.luck} /></td>
                <td className="l text-xs text-ink-3">{tags.get(r.owner)?.join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </Scroll>
        <p className="max-w-[70ch] text-xs text-ink-3">
          {s.live ? `This season so far, ${weeks} weeks. ` : `${s.regularWeeks}-week regular season, ${s.playoffTeams} playoff teams. `}
          {s.platform === 'Sleeper' ? 'Played on Sleeper, where scores ran about a third higher. ' : ''}
          Luck is actual wins minus expected wins (xW).
        </p>
        {s.notes.map((n) => <p key={n} className="max-w-[70ch] text-xs text-ink-3">{n}</p>)}
      </div>
    </>
  );
}

// ---------- All seasons: champions ----------
function Champions({ H, all, go }: { H: Hist; all: Career[]; go: Go }) {
  const most = (f: (c: Career) => number) => { const m = Math.max(...all.map(f)); return { m, who: all.filter((c) => f(c) === m && m > 0) }; };
  const titles = most((c) => c.titles.length);
  const finalsLost = most((c) => c.runnerUps.length);
  const ringless = most((c) => (c.titles.length ? 0 : c.seasons.filter((s) => !s.live).length));
  const drought = most((c) => (c.active && c.drought !== null ? c.drought : 0));
  const lucky = [...all].filter((c) => c.lifer).sort((a, b) => b.luck - a.luck);
  const list = (cs: Career[]) => cs.map((c) => c.name).join(', ');
  const done = H.seasons.filter((s) => !s.live).slice().reverse();
  const champLuck = done.filter((s) => (s.rows.find((r) => r.owner === s.podium[0])?.luck ?? 0) > 0).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-3">
        <Stat label="Most titles" value={`${titles.m} · ${list(titles.who)}`} />
        <Stat label="Most finals lost" value={`${finalsLost.m} · ${list(finalsLost.who)}`} sub={finalsLost.who.map((c) => `${c.titles.length} titles in ${c.titles.length + c.runnerUps.length} finals`).join('; ')} />
        <Stat label="Most seasons without a title" value={`${ringless.m} · ${list(ringless.who)}`} />
        <Stat label="Longest active title drought" value={`${drought.m} seasons · ${list(drought.who)}`} />
        <Stat label="Luckiest career" value={<>{lucky[0]!.name} <Luck v={lucky[0]!.luck} /></>} sub={`wins above what their scores earned (${LIFER_SEASONS}+ seasons)`} />
        <Stat label="Unluckiest career" value={<>{lucky.at(-1)!.name} <Luck v={lucky.at(-1)!.luck} /></>} sub={`wins below what their scores earned (${LIFER_SEASONS}+ seasons)`} />
      </div>
      <ChampionTable H={H} done={done} go={go} champLuck={champLuck} />
    </>
  );
}

function ChampionTable({ H, done, go, champLuck }: { H: Hist; done: Season[]; go: Go; champLuck: number }) {
  const champ = (s: Season) => s.rows.find((r) => r.owner === s.podium[0]);
  const filters = useMemo<FilterDef<Season>[]>(() => [
    { id: 'owner', label: 'Champion', options: [['all', 'Everyone'], ...[...H.owners.values()].filter((o) => !o.filler).map((o) => [o.key, o.name] as [string, string])], test: (s, v) => s.podium[0] === v },
    { id: 'platform', label: 'Platform', options: [['all', 'Both'], ['ESPN', 'ESPN'], ['Sleeper', 'Sleeper']], test: (s, v) => s.platform === v },
    { id: 'luck', label: 'Regular season', options: [['all', 'Any'], ['lucky', 'Lucky'], ['unlucky', 'Unlucky']], test: (s, v) => ((champ(s)?.luck ?? 0) > 0) === (v === 'lucky') },
  ], [H]);
  const cols = useMemo<Col<Season>[]>(() => [
    { id: 'year', label: 'Year', left: true, fixed: true, value: (s) => s.year, cell: (s) => <button type="button" className="link num" onClick={() => go({ season: String(s.year), view: 'standings' })}>{s.year}</button> },
    { id: 'champion', label: 'Champion', left: true, className: 'min-w-[10rem] font-medium', value: (s) => (s.podium[0] ? ownerName(H, s.podium[0]) : ''), cell: (s) => (s.podium[0] ? <Who H={H} o={s.podium[0]} go={go} year={s.year} sub={champ(s)?.team} /> : '–') },
    { id: 'runner', label: 'Runner-up', left: true, className: 'min-w-[9rem]', value: (s) => (s.podium[1] ? ownerName(H, s.podium[1]) : ''), cell: (s) => (s.podium[1] ? <Who H={H} o={s.podium[1]} go={go} year={s.year} /> : '–') },
    { id: 'record', label: 'Reg. season', value: (s) => { const c = champ(s); return c ? c.w + c.t / 2 : null; }, cell: (s) => { const c = champ(s); return c ? rec(c.w, c.l, c.t) : '–'; } },
    { id: 'pf', label: 'PF', hidden: true, value: (s) => champ(s)?.pf ?? null, cell: (s) => fmt(champ(s)?.pf) },
    { id: 'luck', label: 'Luck', value: (s) => champ(s)?.luck ?? null, cell: (s) => { const c = champ(s); return c ? <Luck v={c.luck} /> : '–'; } },
    { id: 'platform', label: 'Platform', left: true, hidden: true, className: 'text-ink-2', value: (s) => s.platform },
  ], [H, go]);
  const t = useTable('champions', cols, done, { id: 'year', dir: -1 }, { filters });
  return (
    <Section title="Champions" aside={`${champLuck} of ${done.length} champions had a lucky regular season`}>
      <TableBar t={t} noun="titles" file="fwhl-champions" />
      <DataTable t={t} rowKey={(s) => String(s.year)} stickyId="champion" minWidth="min-w-[40rem]" empty="No season matches these filters." />
    </Section>
  );
}

// ---------- Owners ----------
function Owners({ H, all, go }: { H: Hist; all: Career[]; go: Go }) {
  const filters = useMemo<FilterDef<Career>[]>(() => [
    { id: 'who', label: 'Owners shown', options: [['lifers', `Lifers (${LIFER_SEASONS}+ seasons)`], ['all', 'Everyone'], ['active', 'In the league now']], test: (c, v) => (v === 'all' ? true : c.active) },
    { id: 'titles', label: 'Titles', options: [['all', 'Any'], ['won', 'Has won one'], ['none', 'Never won']], test: (c, v) => (v === 'won' ? c.titles.length > 0 : c.titles.length === 0) },
  ], []);
  const search = useMemo(() => ({ label: 'Find an owner', placeholder: 'Name', of: (c: Career) => c.name }), []);
  const cols = useMemo<Col<Career>[]>(() => [
    { id: 'owner', label: 'Owner', left: true, fixed: true, className: 'min-w-[9rem] font-medium', value: (c) => c.name, cell: (c) => <Who H={H} o={c.owner} go={go} /> },
    { id: 'seasons', label: 'Seasons', value: (c) => c.seasons.length },
    { id: 'rec', label: 'W-L', value: (c) => c.w + c.t / 2, cell: (c) => rec(c.w, c.l, c.t) },
    { id: 'win', label: 'Win %', value: (c) => (c.w + c.l + c.t ? (c.w + c.t / 2) / (c.w + c.l + c.t) : null), cell: (c) => winPct(c.w, c.l, c.t) },
    { id: 'playoffs', label: 'Playoffs', value: (c) => c.playoffs / Math.max(1, c.completed), cell: (c) => `${c.playoffs}/${c.completed}` },
    { id: 'titles', label: 'Titles', value: (c) => c.titles.length * 100 + c.runnerUps.length * 10 + c.thirds.length, cell: (c) => <b className="font-semibold">{c.titles.length || <span className="font-normal text-ink-3">0</span>}</b> },
    { id: 'finals', label: 'Finals', value: (c) => c.titles.length + c.runnerUps.length },
    { id: 'index', label: 'Pts vs avg', value: (c) => c.index, cell: (c) => vsAvg(c.index) },
    { id: 'luck', label: 'Luck', value: (c) => c.luck, cell: (c) => <Luck v={c.luck} /> },
    { id: 'drought', label: 'Drought', hidden: true, value: (c) => c.drought, cell: (c) => (c.drought === null ? 'never won' : String(c.drought)) },
  ], [H, go]);
  // Lifers first, like the old Seg did; the filter flips it to everyone.
  const lifers = useMemo(() => all.filter((c) => c.lifer), [all]);
  const [everyone, setEveryone] = useState(false);
  const rows = everyone ? all : lifers;
  const t = useTable('owner-careers', cols, rows, { id: 'titles', dir: -1 }, { filters: useMemo(() => filters.slice(1), [filters]), search });
  return (
    <Section title="Career records" aside={<Seg label="Owners shown" value={everyone ? 'all' : 'lifers'} options={[['lifers', `Lifers (${LIFER_SEASONS}+ seasons)`], ['all', 'Everyone']]} onChange={(v) => setEveryone(v === 'all')} />}>
      <TableBar t={t} noun="owners" file="fwhl-owner-careers" />
      <DataTable t={t} rowKey={(c) => c.owner} stickyId="owner" minWidth="min-w-[52rem]" empty="No owner matches these filters." />
      <p className="max-w-[70ch] text-sm text-ink-2">
        Records are regular season. Playoffs counts finished seasons inside the playoff field. Pts vs avg is points per game against that season's league average.
        Luck is wins minus the wins their weekly scores earned against the whole league. Pick an owner to open their page.
      </p>
    </Section>
  );
}

function OwnerPage({ H, c, go }: { H: Hist; c: Career; go: Go }) {
  const own = H.owners.get(c.owner)!;
  const rivals = careers(H).filter((x) => x.owner !== c.owner).map((x) => ({ x, h: headToHead(H, c.owner, x.owner) })).filter((r) => r.h.games.length >= 4).sort((a, b) => b.h.games.length - a.h.games.length);
  const best = [...c.seasons].sort((a, b) => b.w + b.t / 2 - (a.w + a.t / 2) || b.pf - a.pf)[0]!;
  const worst = [...c.seasons].filter((s) => !s.live).sort((a, b) => a.w + a.t / 2 - (b.w + b.t / 2) || a.pf - b.pf)[0];
  return (
    <>
      <div className="grid gap-3">
        <button type="button" className="link w-max text-sm" onClick={() => go({ owner: null })}>← History</button>
        <p className="headline-sm flex items-center gap-3">{c.name}</p>
        <p className="text-ink-2">
          {c.seasons[0]!.year} to {c.seasons.at(-1)!.year} · {c.seasons.length} seasons{c.lifer ? ' · lifer' : ''}{c.active ? '' : ' · no longer in the league'}
          {own.note ? ` · ${own.note}` : ''}
        </p>
      </div>
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-4">
        <Stat label="Titles" value={c.titles.length ? c.titles.join(', ') : 'None yet'} sub={`${c.runnerUps.length} runner-up, ${c.thirds.length} third`} />
        <Stat label="Regular season" value={`${rec(c.w, c.l, c.t)} (${winPct(c.w, c.l, c.t)})`} sub={`Playoffs ${c.playoffs} of ${c.completed} finished seasons`} />
        <Stat label="Career luck" value={<Luck v={c.luck} />} sub={`${fmt(c.xw)} expected wins`} />
        <Stat label="Title drought" value={c.drought === null ? 'Never won' : c.drought === 0 ? 'Reigning or just won' : `${c.drought} season${c.drought === 1 ? '' : 's'}`} sub={`Best year ${best.year} (${rec(best.w, best.l, best.t)})${worst ? `, worst ${worst.year} (${rec(worst.w, worst.l, worst.t)})` : ''}`} />
      </div>
      <Section title="Luck by season" aside="Right of center: more wins than the scores earned">
        <LuckBars rows={c.seasons.map((s) => ({ key: String(s.year), label: `${s.year}${s.live ? '*' : ''}`, v: s.luck, title: `${s.year}: ${rec(s.w, s.l, s.t)}, ${fmt(s.xw)} expected wins` }))} />
      </Section>
      <OwnerSeasons H={H} c={c} go={go} />
      <OwnerTrades H={H} owner={c.owner} />
      <OwnerH2H H={H} rivals={rivals} go={go} />
    </>
  );
}

function OwnerSeasons({ H, c, go }: { H: Hist; c: Career; go: Go }) {
  const filters = useMemo<FilterDef<CareerSeason>[]>(() => [
    { id: 'platform', label: 'Platform', options: [['all', 'Both'], ['ESPN', 'ESPN'], ['Sleeper', 'Sleeper']], test: (s, v) => H.byYear.get(s.year)?.platform === v },
    { id: 'result', label: 'Finish', options: [['all', 'Any'], ['title', 'Won it'], ['podium', 'Top 3'], ['winning', 'Winning record']], test: (s, v) => (v === 'title' ? s.finish === 1 : v === 'podium' ? (s.finish ?? 99) <= 3 : s.w > s.l) },
  ], [H]);
  const cols = useMemo<Col<CareerSeason>[]>(() => [
    { id: 'year', label: 'Year', left: true, fixed: true, value: (s) => s.year, cell: (s) => <><button type="button" className="link num" title={`Open ${s.year}`} onClick={() => go({ owner: null, season: String(s.year), view: 'standings' })}>{s.year}</button>{s.live ? '*' : ''}{H.byYear.get(s.year)!.platform === 'Sleeper' ? <span className="tag ml-2 text-ink-3">Sleeper</span> : null}</> },
    { id: 'team', label: 'Team', left: true, className: 'min-w-[10rem]', value: (s) => s.team, cell: (s) => <>{s.team}{s.with.length > 0 && <span className="block text-xs text-ink-3">with {s.with.map((o) => ownerName(H, o)).join(' & ')}</span>}</> },
    { id: 'rec', label: 'W-L', value: (s) => s.w + s.t / 2, cell: (s) => rec(s.w, s.l, s.t) },
    { id: 'finish', label: 'Finish', value: (s) => (s.live ? null : s.finish), cell: (s) => (s.live ? 'live' : place(s.finish)) },
    { id: 'pf', label: 'PF', value: (s) => s.pf, cell: (s) => fmt(s.pf) },
    { id: 'index', label: 'Pts vs avg', value: (s) => s.index, cell: (s) => vsAvg(s.index) },
    { id: 'xw', label: 'xW', className: 'text-ink-2', value: (s) => s.xw, cell: (s) => fmt(s.xw) },
    { id: 'luck', label: 'Luck', value: (s) => s.luck, cell: (s) => <Luck v={s.luck} /> },
  ], [H, go]);
  const t = useTable('owner-seasons', cols, c.seasons, { id: 'year', dir: -1 }, { filters });
  return (
    <Section title="Season by season">
      <TableBar t={t} noun="seasons" file={`fwhl-${c.owner}-seasons`} />
      <DataTable t={t} rowKey={(s) => String(s.year)} stickyId="team" minWidth="min-w-[46rem]" empty="No season matches these filters." />
    </Section>
  );
}

type Rival = { x: Career; h: H2H };
function OwnerH2H({ H, rivals, go }: { H: Hist; rivals: Rival[]; go: Go }) {
  const filters = useMemo<FilterDef<Rival>[]>(() => [
    { id: 'side', label: 'Record', options: [['all', 'Everyone'], ['up', 'Winning against'], ['down', 'Losing against']], test: (r, v) => (v === 'up' ? r.h.w > r.h.l : r.h.l > r.h.w) },
    { id: 'playoff', label: 'Playoffs', options: [['all', 'All games'], ['met', 'Met in the playoffs']], test: (r) => r.h.playoffW + r.h.playoffL > 0 },
  ], []);
  const search = useMemo(() => ({ label: 'Find an opponent', placeholder: 'Name', of: (r: Rival) => r.x.name }), []);
  const cols = useMemo<Col<Rival>[]>(() => [
    { id: 'opp', label: 'Opponent', left: true, fixed: true, className: 'min-w-[9rem]', value: (r) => r.x.name, cell: (r) => <Who H={H} o={r.x.owner} go={go} /> },
    { id: 'games', label: 'Games', value: (r) => r.h.games.length },
    { id: 'rec', label: 'W-L', value: (r) => r.h.w - r.h.l, cell: (r) => <span className={r.h.w > r.h.l ? 'text-gain' : r.h.w < r.h.l ? 'text-loss' : ''}>{rec(r.h.w, r.h.l, r.h.t)}</span> },
    { id: 'win', label: 'Win %', value: (r) => (r.h.games.length ? (r.h.w + r.h.t / 2) / r.h.games.length : null), cell: (r) => winPct(r.h.w, r.h.l, r.h.t) },
    { id: 'playoffs', label: 'Playoffs', value: (r) => r.h.playoffW - r.h.playoffL, cell: (r) => (r.h.playoffW + r.h.playoffL ? rec(r.h.playoffW, r.h.playoffL) : '–') },
    { id: 'avg', label: 'Avg score', className: 'text-ink-2', value: (r) => r.h.pf / Math.max(1, r.h.games.length), cell: (r) => `${fmt(r.h.pf / r.h.games.length)} – ${fmt(r.h.pa / r.h.games.length)}` },
  ], [H, go]);
  const t = useTable('owner-h2h', cols, rivals, { id: 'games', dir: -1 }, { filters, search });
  return (
    <Section title="Head to head" aside="Regular season and playoffs, 4+ games">
      <TableBar t={t} noun="opponents" file="fwhl-head-to-head" />
      <DataTable t={t} rowKey={(r) => r.x.owner} stickyId="opp" minWidth="min-w-[34rem]" empty="No opponent matches these filters." />
    </Section>
  );
}

// ---------- All seasons: luck ----------
function LuckTab({ H, all, go }: { H: Hist; all: Career[]; go: Go }) {
  const [everyone, setEveryone] = useState(false);
  const shown = all.filter((c) => everyone || c.lifer).sort((a, b) => b.luck - a.luck);
  const seasons = H.seasons.flatMap((x) => x.rows.filter((r) => !H.owners.get(r.owner)?.filler).map((r) => ({ ...r, year: x.year, live: x.live })));
  return (
    <>
      <Section title="Career luck" aside={<Seg label="Owners shown" value={everyone ? 'all' : 'lifers'} options={[['lifers', 'Lifers'], ['all', 'Everyone']]} onChange={(v) => setEveryone(v === 'all')} />}>
        <LuckBars rows={shown.map((c) => ({ key: c.owner, label: c.name, v: c.luck, title: `${c.name}: ${rec(c.w, c.l, c.t)}, ${fmt(c.xw)} expected wins over ${c.seasons.length} seasons` }))} />
        <p className="max-w-[70ch] text-sm text-ink-2">
          Luck is actual wins minus expected wins. Each week a score is compared with every other score that week: beating 8 of 11 is worth 8/11 of a win, whoever you actually played.
          Over a season that adds up to expected wins (xW). Each season's drawer has its own luck column.
        </p>
      </Section>
      <SeasonLuckTable H={H} rows={seasons} go={go} />
    </>
  );
}

// Every owner-season in the league, rankable by any column.
type LuckRow = ReturnType<typeof seasonRows>[number];
const seasonRows = (H: Hist) => H.seasons.flatMap((x) => x.rows.filter((r) => !H.owners.get(r.owner)?.filler).map((r) => ({ ...r, year: x.year, live: x.live })));

function SeasonLuckTable({ H, rows, go }: { H: Hist; rows: LuckRow[]; go: Go }) {
  const years = useMemo(() => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a), [rows]);
  const filters = useMemo<FilterDef<LuckRow>[]>(() => [
    { id: 'year', label: 'Season', options: [['all', 'All seasons'], ...years.map((y) => [String(y), String(y)] as [string, string])], test: (r, v) => r.year === Number(v) },
    { id: 'owner', label: 'Owner', options: [['all', 'Everyone'], ...[...H.owners.values()].filter((o) => !o.filler).map((o) => [o.key, o.name] as [string, string])], test: (r, v) => r.owner === v },
    { id: 'luck', label: 'Luck', options: [['all', 'Any'], ['lucky', 'Lucky'], ['unlucky', 'Unlucky']], test: (r, v) => (r.luck > 0) === (v === 'lucky') },
  ], [H, years]);
  const search = useMemo(() => ({ label: 'Find a team', placeholder: 'Team name', of: (r: LuckRow) => `${r.team} ${ownerName(H, r.owner)}` }), [H]);
  const cols = useMemo<Col<LuckRow>[]>(() => [
    { id: 'owner', label: 'Owner', left: true, fixed: true, className: 'min-w-[10rem]', value: (r) => ownerName(H, r.owner), cell: (r) => <Who H={H} o={r.owner} go={go} year={r.year} sub={`${r.year}${r.live ? ' so far' : ''} · ${r.team}`} /> },
    { id: 'year', label: 'Season', value: (r) => r.year },
    { id: 'rec', label: 'W-L', value: (r) => r.w + r.t / 2, cell: (r) => rec(r.w, r.l, r.t) },
    { id: 'xw', label: 'xW', className: 'text-ink-2', value: (r) => r.xw, cell: (r) => fmt(r.xw) },
    { id: 'luck', label: 'Luck', value: (r) => r.luck, cell: (r) => <Luck v={r.luck} /> },
    { id: 'pf', label: 'PF', value: (r) => r.pf, cell: (r) => fmt(r.pf) },
    { id: 'index', label: 'Pts vs avg', value: (r) => r.index, cell: (r) => vsAvg(r.index) },
    { id: 'finish', label: 'Finish', value: (r) => r.finish, cell: (r) => (r.live ? 'live' : place(r.finish)) },
  ], [H, go]);
  const t = useTable('season-luck', cols, rows, { id: 'luck', dir: -1 }, { filters, search });
  return (
    <Section title="Every season by luck" aside={`${rows.length} owner-seasons`}>
      <TableBar t={t} noun="seasons" file="fwhl-season-luck" />
      <DataTable t={t} rowKey={(r) => `${r.year}-${r.owner}`} stickyId="owner" limit={100} minWidth="min-w-[46rem]" empty="No season matches these filters." />
    </Section>
  );
}

// Diverging bars around zero: green right (lucky), red left (unlucky); the value is always written.
function LuckBars({ rows }: { rows: { key: string; label: string; v: number; title: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.v)));
  return (
    <ul className="grid max-w-3xl gap-1" aria-label="Luck in wins">
      {rows.map((r) => {
        const w = (Math.abs(r.v) / max) * 50;
        return (
          <li key={r.key} className="grid grid-cols-[minmax(6rem,10rem)_1fr_3.5rem] items-center gap-3 text-sm" title={r.title}>
            <span className="truncate">{r.label}</span>
            <span className="relative h-5">
              <span className="absolute inset-y-0 left-1/2 w-px bg-rule-strong" aria-hidden="true" />
              <span className={`absolute inset-y-1 rounded-sm ${r.v >= 0 ? 'bg-gain' : 'bg-loss'}`} style={r.v >= 0 ? { left: '50%', width: `${w}%` } : { right: '50%', width: `${w}%` }} aria-hidden="true" />
            </span>
            <span className="num text-right"><Luck v={r.v} /></span>
          </li>
        );
      })}
    </ul>
  );
}

// ---------- Rivals ----------
function Rivals({ H, all, pair, go }: { H: Hist; all: Career[]; pair: string | null; go: Go }) {
  const lifers = all.filter((c) => c.lifer).sort((a, b) => a.name.localeCompare(b.name));
  const [a, b] = (pair ?? '').split('~');
  const pairs = all.flatMap((x, i) => all.slice(i + 1).map((y) => ({ x, y, h: headToHead(H, x.owner, y.owner) })));
  const lopsided = pairs.filter((p) => p.h.games.length >= 10).map((p) => ({ ...p, edge: Math.abs(p.h.w - p.h.l) / p.h.games.length })).sort((p, q) => q.edge - p.edge).slice(0, 8);
  const busiest = [...pairs].sort((p, q) => q.h.games.length - p.h.games.length).slice(0, 8);
  const line = ({ x, y, h }: (typeof pairs)[number]) => {
    const [lead, trail, lw, ll] = h.w >= h.l ? [x, y, h.w, h.l] : [y, x, h.l, h.w];
    return (
      <li key={`${x.owner}~${y.owner}`} className="flex items-center justify-between gap-3 border-b border-rule py-1.5">
        <button type="button" className="link text-left no-underline hover:underline" onClick={() => go({ vs: `${lead.owner}~${trail.owner}` })}>{lead.name} over {trail.name}</button>
        <span className="num text-sm">{rec(lw, ll, h.t)} <span className="text-ink-3">({h.games.length})</span></span>
      </li>
    );
  };
  return (
    <>
      <Section title="Lifers head to head" aside="Row owner's record against the column owner; regular season and playoffs">
        <Scroll min="min-w-[50rem]">
          <thead><tr><th className="l stick">vs →</th>{lifers.map((c) => <th key={c.owner} className="!text-center" title={c.name}>{c.name.split(' ').map((w) => w[0]).join('')}</th>)}<th title="Record against the other lifers">vs lifers</th></tr></thead>
          <tbody>
            {lifers.map((r) => {
              let tw = 0, tl = 0;
              return (
                <tr key={r.owner}>
                  <td className="l stick font-medium">{r.name}</td>
                  {lifers.map((c) => {
                    if (c.owner === r.owner) return <td key={c.owner} className="bg-sunk" />;
                    const h = headToHead(H, r.owner, c.owner);
                    tw += h.w; tl += h.l;
                    const p = h.games.length ? (h.w + h.t / 2) / h.games.length : 0.5;
                    const mix = Math.round(Math.abs(p - 0.5) * 60);
                    return (
                      <td key={c.owner} className="n !p-0 !text-center" style={{ background: h.games.length && mix ? `color-mix(in oklab, var(--${p > 0.5 ? 'gain' : 'loss'}) ${mix}%, transparent)` : undefined }}>
                        <button type="button" className="h-10 w-full px-2" title={`${r.name} vs ${c.name}: ${rec(h.w, h.l, h.t)}`} onClick={() => go({ vs: `${r.owner}~${c.owner}` })}>{h.games.length ? rec(h.w, h.l, h.t) : '–'}</button>
                      </td>
                    );
                  })}
                  <td className="n font-semibold">{rec(tw, tl)}</td>
                </tr>
              );
            })}
          </tbody>
        </Scroll>
      </Section>
      {a && b && H.owners.has(a) && H.owners.has(b) && <Series H={H} a={a} b={b} go={go} />}
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Most one-sided (10+ games)"><ol className="grid">{lopsided.map(line)}</ol></Section>
        <Section title="Most played"><ol className="grid">{busiest.map(line)}</ol></Section>
      </div>
    </>
  );
}

function Series({ H, a, b, go }: { H: Hist; a: OwnerKey; b: OwnerKey; go: Go }) {
  const h = headToHead(H, a, b);
  return (
    <Section title={`${ownerName(H, a)} vs ${ownerName(H, b)}: ${rec(h.w, h.l, h.t)}`} aside={<button type="button" className="link" onClick={() => go({ vs: null })}>Close</button>}>
      <Scroll min="min-w-[30rem]">
        <thead><tr><th className="l">Game</th><th>{ownerName(H, a)}</th><th>{ownerName(H, b)}</th><th className="l">Winner</th></tr></thead>
        <tbody>
          {h.games.slice().reverse().map((g) => {
            const [pa, pb] = g.home === a ? [g.hs, g.as] : [g.as, g.hs];
            return (
              <tr key={`${g.year}-${g.week}`}>
                <td className="l n">{g.year} Wk {g.week}{g.kind === 'playoff' ? <span className="tag ml-2 text-accent-ink">Playoffs</span> : ''}</td>
                <td className={`n ${g.winner === a ? 'font-semibold' : 'text-ink-3'}`}>{fmt(pa, 2)}</td>
                <td className={`n ${g.winner === b ? 'font-semibold' : 'text-ink-3'}`}>{fmt(pb, 2)}</td>
                <td className="l">{g.winner ? ownerName(H, g.winner) : 'Tie'}{(g.winner === a) !== (pa > pb) && g.winner ? ' (stat correction)' : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </Scroll>
    </Section>
  );
}

// ---------- Records ----------
function RecordsTab({ H, go }: { H: Hist; go: Go }) {
  const R = useMemo(() => records(H, 10), [H]);
  const seasons = H.seasons.flatMap((s) => s.rows.filter((r) => !H.owners.get(r.owner)?.filler && !s.live).map((r) => ({ ...r, s })));
  const plat = (y: number) => (H.byYear.get(y)?.platform === 'Sleeper' ? ' · Sleeper' : '');
  const game = (r: ScoreRec, value: ReactNode) => (
    <li key={`${r.year}-${r.week}-${r.owner}`} className="flex items-center justify-between gap-3 border-b border-rule py-1.5">
      <Who H={H} o={r.owner} go={go} year={r.year} sub={`${r.year} Wk ${r.week}${r.kind === 'playoff' ? ' (playoffs)' : ''} vs ${ownerName(H, r.opp)}${plat(r.year)}`} />
      <span className="num shrink-0 text-right text-sm">{value}</span>
    </li>
  );
  const score = (r: ScoreRec) => game(r, <>{fmt(r.pts, 2)} <span className="block text-xs text-ink-3">{r.index.toFixed(2)}× avg</span></>);
  const heartCount = new Map<string, number>();
  R.heartbreaks.forEach((r) => heartCount.set(r.owner, (heartCount.get(r.owner) ?? 0) + 1));
  const topHeart = [...heartCount].sort((a, b) => b[1] - a[1])[0];
  const seasonLine = (r: (typeof seasons)[number], v: ReactNode) => (
    <li key={`${r.s.year}-${r.owner}`} className="flex items-center justify-between gap-3 border-b border-rule py-1.5">
      <Who H={H} o={r.owner} go={go} year={r.s.year} sub={`${r.s.year} · ${r.team}`} />
      <span className="num shrink-0 text-sm">{v}</span>
    </li>
  );
  return (
    <>
      <p className="max-w-[70ch] text-sm text-ink-2">Scores are ranked against that season's league average (1.00×), so ESPN and Sleeper years compare fairly. Consolation games are left out.</p>
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Biggest games"><ol className="grid">{R.high.map(score)}</ol></Section>
        <Section title="Worst games"><ol className="grid">{R.low.map(score)}</ol></Section>
        <Section title="Biggest blowouts"><ol className="grid">{R.blowouts.map((r) => game(r, <>{fmt(r.pts, 2)}–{fmt(r.oppPts, 2)} <span className="block text-xs text-ink-3">by {fmt(r.pts - r.oppPts)}</span></>))}</ol></Section>
        <Section title="Closest games"><ol className="grid">{R.closest.map((r) => game(r, <>{fmt(r.pts, 2)}–{fmt(r.oppPts, 2)} <span className="block text-xs text-ink-3">by {fmt(r.pts - r.oppPts, 2)}</span></>))}</ol></Section>
        <Section title="Longest winning streaks" aside="Regular season, across seasons">
          <ol className="grid">{R.winStreaks.map((s) => <li key={`${s.owner}-${s.from}`} className="flex items-center justify-between gap-3 border-b border-rule py-1.5"><Who H={H} o={s.owner} go={go} sub={`${s.from} to ${s.to}${s.live ? ' (active)' : ''}`} /><span className="num text-sm">{s.len} W</span></li>)}</ol>
        </Section>
        <Section title="Longest losing streaks" aside="Regular season, across seasons">
          <ol className="grid">{R.lossStreaks.map((s) => <li key={`${s.owner}-${s.from}`} className="flex items-center justify-between gap-3 border-b border-rule py-1.5"><Who H={H} o={s.owner} go={go} sub={`${s.from} to ${s.to}${s.live ? ' (active)' : ''}`} /><span className="num text-sm">{s.len} L</span></li>)}</ol>
        </Section>
        <Section title="Heartbreaks" aside={`${R.heartbreaks.length} losses with a top-2 score${topHeart ? `; ${ownerName(H, topHeart[0])} has ${topHeart[1]}` : ''}`}>
          <ol className="grid">{R.heartbreaks.slice(0, 10).map((r) => game(r, <>{fmt(r.pts, 2)}–{fmt(r.oppPts, 2)} <span className="block text-xs text-ink-3">#{r.rank} that week</span></>))}</ol>
        </Section>
        <Section title="Robberies" aside={`${R.robberies.length} wins with a bottom-2 score`}>
          <ol className="grid">{R.robberies.slice(0, 10).map((r) => game(r, <>{fmt(r.pts, 2)}–{fmt(r.oppPts, 2)} <span className="block text-xs text-ink-3">#{r.rank} that week</span></>))}</ol>
        </Section>
        <Section title="Best scoring seasons"><ol className="grid">{[...seasons].sort((a, b) => b.index - a.index).slice(0, 10).map((r) => seasonLine(r, <>{fmt(r.pf)} <span className="block text-xs text-ink-3">{vsAvg(r.index)} vs avg</span></>))}</ol></Section>
        <Section title="Best records"><ol className="grid">{[...seasons].sort((a, b) => b.w - a.w || a.l - b.l || b.pf - a.pf).slice(0, 10).map((r) => seasonLine(r, <>{rec(r.w, r.l, r.t)} <span className="block text-xs text-ink-3">{place(r.finish)}</span></>))}</ol></Section>
      </div>
      <EveryGame H={H} go={go} />
    </>
  );
}

// The lists above are the highlights; this is the whole record book, rankable and filterable.
interface GameRow { year: number; week: number; kind: Game['kind']; owner: OwnerKey; opp: OwnerKey; pts: number; oppPts: number; won: boolean | null; index: number }
function EveryGame({ H, go }: { H: Hist; go: Go }) {
  const rows = useMemo<GameRow[]>(() => H.seasons.flatMap((s) => s.games.flatMap((g) => ([
    { year: s.year, week: g.week, kind: g.kind, owner: g.home, opp: g.away, pts: g.hs, oppPts: g.as, won: g.winner === null ? null : g.winner === g.home, index: s.avg ? g.hs / s.avg : 0 },
    { year: s.year, week: g.week, kind: g.kind, owner: g.away, opp: g.home, pts: g.as, oppPts: g.hs, won: g.winner === null ? null : g.winner === g.away, index: s.avg ? g.as / s.avg : 0 },
  ] as GameRow[])).filter((r) => !H.owners.get(r.owner)?.filler)), [H]);
  const years = useMemo(() => [...new Set(rows.map((r) => r.year))].sort((a, b) => b - a), [rows]);
  const filters = useMemo<FilterDef<GameRow>[]>(() => [
    { id: 'year', label: 'Season', options: [['all', 'All seasons'], ...years.map((y) => [String(y), String(y)] as [string, string])], test: (r, v) => r.year === Number(v) },
    { id: 'owner', label: 'Owner', options: [['all', 'Everyone'], ...[...H.owners.values()].filter((o) => !o.filler).map((o) => [o.key, o.name] as [string, string])], test: (r, v) => r.owner === v },
    { id: 'kind', label: 'Game', options: [['all', 'All games'], ['regular', 'Regular season'], ['playoff', 'Playoffs'], ['consolation', 'Consolation']], test: (r, v) => r.kind === v },
    { id: 'result', label: 'Result', options: [['all', 'Win or loss'], ['w', 'Wins'], ['l', 'Losses']], test: (r, v) => (v === 'w' ? r.won === true : r.won === false) },
  ], [H, years]);
  const search = useMemo(() => ({ label: 'Find an owner', placeholder: 'Name', of: (r: GameRow) => `${ownerName(H, r.owner)} ${ownerName(H, r.opp)}` }), [H]);
  const cols = useMemo<Col<GameRow>[]>(() => [
    { id: 'owner', label: 'Owner', left: true, fixed: true, className: 'min-w-[10rem]', value: (r) => ownerName(H, r.owner), cell: (r) => <Who H={H} o={r.owner} go={go} year={r.year} sub={`${r.year} Wk ${r.week}${r.kind === 'playoff' ? ' · playoffs' : ''}`} /> },
    { id: 'pts', label: 'Points', value: (r) => r.pts, cell: (r) => <b className="font-semibold">{fmt(r.pts, 2)}</b> },
    { id: 'index', label: 'vs avg', value: (r) => r.index, cell: (r) => `${r.index.toFixed(2)}×` },
    { id: 'opp', label: 'Opponent', left: true, className: 'min-w-[9rem]', value: (r) => ownerName(H, r.opp), cell: (r) => <Who H={H} o={r.opp} go={go} year={r.year} /> },
    { id: 'oppPts', label: 'Opp pts', className: 'text-ink-2', value: (r) => r.oppPts, cell: (r) => fmt(r.oppPts, 2) },
    { id: 'margin', label: 'Margin', value: (r) => r.pts - r.oppPts, cell: (r) => <span className={tone(r.pts - r.oppPts, 0.01)}>{signed(r.pts - r.oppPts, 2)}</span> },
    { id: 'result', label: 'Result', left: true, value: (r) => (r.won === null ? 'T' : r.won ? 'W' : 'L') },
    { id: 'year', label: 'Season', hidden: true, value: (r) => r.year },
    { id: 'week', label: 'Week', hidden: true, value: (r) => r.week },
  ], [H, go]);
  const t = useTable('every-game', cols, rows, { id: 'pts', dir: -1 }, { filters, search });
  return (
    <Section title="Every game" aside={`${rows.length.toLocaleString()} team-games since ${H.seasons[0]!.year}`}>
      <p className="max-w-[70ch] text-sm text-ink-2">One row per team per game. Sort any column, narrow it with the filters, and the ranking follows what is left.</p>
      <TableBar t={t} noun="team-games" file="fwhl-every-game" />
      <DataTable t={t} rowKey={(r, i) => `${r.year}-${r.week}-${r.owner}-${i}`} stickyId="owner" limit={100} minWidth="min-w-[52rem]" empty="No game matches these filters." />
    </Section>
  );
}
