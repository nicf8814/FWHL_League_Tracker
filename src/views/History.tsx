import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRoute } from '../app/router.ts';
import { useLeague } from '../data/store.tsx';
import { validateHistory, type History as HistoryFile, type OwnerKey } from '../data/history.ts';
import {
  buildHist, careers, crew, headToHead, LIFER_SEASONS, ownerName, records, seasonAwards,
  type Career, type Hist, type ScoreRec, type Season,
} from '../engine/history.ts';
import { Empty, fmt, Mono, Section, Seg, signed, tone } from '../ui/components.tsx';

// The page is a stack of drawers: one per season (newest first, the latest open) and an
// "All seasons" drawer holding the all-time views. ?year=Y opens a season, ?tab= an all-time view,
// ?owner= an owner's page.
const URL_ = `${import.meta.env.BASE_URL}seed/history.json`;
type Tab = 'champions' | 'owners' | 'luck' | 'rivals' | 'records';
const TABS: [Tab, string][] = [['champions', 'Champions'], ['owners', 'Owners'], ['luck', 'Luck'], ['rivals', 'Rivals'], ['records', 'Records']];

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
  return <Drawers H={H} all={all} query={query} go={set} />;
}

type Go = (patch: Record<string, string | null>) => void;

function Drawers({ H, all, query, go }: { H: Hist; all: Career[]; query: URLSearchParams; go: Go }) {
  const first = H.seasons[0]!.year, last = H.seasons.at(-1)!;
  const tabParam = TABS.find(([t]) => t === query.get('tab'))?.[0];
  const yearParam = Number(query.get('year')) || null;
  const [openYears, setOpenYears] = useState<Set<number>>(() => new Set([yearParam ?? last.year]));
  const [allOpen, setAllOpen] = useState(!!tabParam || !!query.get('vs'));
  useEffect(() => {
    if (!yearParam) return;
    setOpenYears((o) => new Set(o).add(yearParam));
    requestAnimationFrame(() => document.getElementById(`season-${yearParam}`)?.scrollIntoView({ block: 'start' }));
  }, [yearParam]);
  useEffect(() => { if (tabParam) setAllOpen(true); }, [tabParam]);
  const toggle = (y: number, open: boolean) => setOpenYears((o) => { const n = new Set(o); if (open) n.add(y); else n.delete(y); return n; });
  const tab = tabParam ?? 'champions';
  return (
    <div className="grid grid-cols-1 gap-6">
      <section aria-label="Headline" className="grid gap-2">
        <p className="headline-sm">{H.seasons.length} seasons of Favre's Waffle House</p>
        <p className="max-w-[70ch] text-ink-2">
          {first} to {last.year}, {all.length} owners. Open a season below, or All seasons for titles, owners, luck, rivals and records.
        </p>
      </section>
      <div className="grid border-t-2 border-ink">
        <Drawer id="all-seasons" open={allOpen} onToggle={setAllOpen} title="All seasons" meta={`${first}–${last.year}`} line="Champions, owners, luck, rivals and records">
          <Seg label="All seasons section" value={tab} options={TABS} onChange={(t) => go({ tab: t, vs: null })} />
          {tab === 'champions' && <Champions H={H} all={all} go={go} />}
          {tab === 'owners' && <Owners H={H} all={all} go={go} />}
          {tab === 'luck' && <LuckTab H={H} all={all} go={go} />}
          {tab === 'rivals' && <Rivals H={H} all={all} pair={query.get('vs')} go={go} />}
          {tab === 'records' && <RecordsTab H={H} go={go} />}
        </Drawer>
        {H.seasons.slice().reverse().map((s) => (
          <Drawer key={s.year} id={`season-${s.year}`} open={openYears.has(s.year)} onToggle={(o) => toggle(s.year, o)} title={String(s.year)} meta={s.platform === 'Sleeper' ? 'Sleeper' : undefined} line={<SeasonLine H={H} s={s} />}>
            <SeasonPanel H={H} s={s} go={go} />
          </Drawer>
        ))}
      </div>
    </div>
  );
}

function Drawer({ id, open, onToggle, title, meta, line, children }: { id: string; open: boolean; onToggle: (open: boolean) => void; title: string; meta?: string; line: ReactNode; children: ReactNode }) {
  return (
    <details id={id} className="group scroll-mt-4 border-b border-rule" open={open} onToggle={(e) => { const o = e.currentTarget.open; if (o !== open) onToggle(o); }}>
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-x-4 py-2 hover:bg-sunk [&::-webkit-details-marker]:hidden">
        <span className="w-24 shrink-0 font-display text-lg font-bold [font-stretch:85%]">{title}{meta && <span className="block text-xs font-normal text-ink-3 [font-stretch:100%]">{meta}</span>}</span>
        <span className="min-w-0 flex-1 text-sm text-ink-2">{line}</span>
        <span aria-hidden="true" className="shrink-0 pr-2 text-ink-3 transition-transform group-open:rotate-90">›</span>
      </summary>
      {open && <div className="grid grid-cols-1 gap-6 pt-2 pb-8">{children}</div>}
    </details>
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

function SeasonPanel({ H, s, go }: { H: Hist; s: Season; go: Go }) {
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
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Most titles" value={`${titles.m} · ${list(titles.who)}`} />
        <Stat label="Most finals lost" value={`${finalsLost.m} · ${list(finalsLost.who)}`} sub={finalsLost.who.map((c) => `${c.titles.length} titles in ${c.titles.length + c.runnerUps.length} finals`).join('; ')} />
        <Stat label="Most seasons without a title" value={`${ringless.m} · ${list(ringless.who)}`} />
        <Stat label="Longest active title drought" value={`${drought.m} seasons · ${list(drought.who)}`} />
        <Stat label="Luckiest career" value={<>{lucky[0]!.name} <Luck v={lucky[0]!.luck} /></>} sub={`wins above what their scores earned (${LIFER_SEASONS}+ seasons)`} />
        <Stat label="Unluckiest career" value={<>{lucky.at(-1)!.name} <Luck v={lucky.at(-1)!.luck} /></>} sub={`wins below what their scores earned (${LIFER_SEASONS}+ seasons)`} />
      </div>
      <Section title="Champions" aside={`${champLuck} of ${done.length} champions had a lucky regular season`}>
        <Scroll min="min-w-[40rem]">
          <thead><tr><th className="l w-16">Year</th><th className="l stick">Champion</th><th className="l">Runner-up</th><th>Reg. season</th><th>Luck</th></tr></thead>
          <tbody>
            {done.map((s) => {
              const c = s.rows.find((r) => r.owner === s.podium[0]);
              return (
                <tr key={s.year}>
                  <td className="l n"><button type="button" className="link" onClick={() => go({ year: String(s.year) })}>{s.year}</button></td>
                  <td className="l stick font-medium">{s.podium[0] && <Who H={H} o={s.podium[0]} go={go} year={s.year} sub={c?.team} />}</td>
                  <td className="l">{s.podium[1] && <Who H={H} o={s.podium[1]} go={go} year={s.year} />}</td>
                  <td className="n">{c ? rec(c.w, c.l, c.t) : '–'}</td>
                  <td className="n">{c ? <Luck v={c.luck} /> : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </Scroll>
      </Section>
    </>
  );
}

// ---------- Owners ----------
type OKey = 'seasons' | 'win' | 'titles' | 'finals' | 'playoffs' | 'index' | 'luck';
function Owners({ H, all, go }: { H: Hist; all: Career[]; go: Go }) {
  const [everyone, setEveryone] = useState(false);
  const [sort, setSort] = useState<OKey>('titles');
  const val = (x: Career): number => ({
    seasons: x.seasons.length, win: (x.w + x.t / 2) / Math.max(1, x.w + x.l + x.t), titles: x.titles.length * 100 + x.runnerUps.length * 10 + x.thirds.length,
    finals: x.titles.length + x.runnerUps.length, playoffs: x.playoffs / Math.max(1, x.completed), index: x.index, luck: x.luck,
  })[sort];
  const rows = all.filter((x) => everyone || x.lifer).sort((a, b) => val(b) - val(a) || b.seasons.length - a.seasons.length);
  const th = (k: OKey, label: string) => (
    <th aria-sort={sort === k ? 'descending' : 'none'}><button type="button" className="link -my-3 py-3 no-underline" onClick={() => setSort(k)}>{label}{sort === k ? ' ↓' : ''}</button></th>
  );
  return (
    <Section title="Career records" aside={<Seg label="Owners shown" value={everyone ? 'all' : 'lifers'} options={[['lifers', `Lifers (${LIFER_SEASONS}+ seasons)`], ['all', 'Everyone']]} onChange={(v) => setEveryone(v === 'all')} />}>
      <Scroll min="min-w-[52rem]">
        <thead><tr><th className="l stick">Owner</th>{th('seasons', 'Seasons')}<th>W-L</th>{th('win', 'Win %')}{th('playoffs', 'Playoffs')}{th('titles', 'Titles')}{th('finals', 'Finals')}{th('index', 'Pts vs avg')}{th('luck', 'Luck')}</tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.owner}>
              <td className="l stick font-medium"><Who H={H} o={x.owner} go={go} /></td>
              <td className="n">{x.seasons.length}</td>
              <td className="n">{rec(x.w, x.l, x.t)}</td>
              <td className="n">{winPct(x.w, x.l, x.t)}</td>
              <td className="n">{x.playoffs}/{x.completed}</td>
              <td className="n font-semibold">{x.titles.length || <span className="font-normal text-ink-3">0</span>}</td>
              <td className="n">{x.titles.length + x.runnerUps.length}</td>
              <td className="n">{vsAvg(x.index)}</td>
              <td className="n"><Luck v={x.luck} /></td>
            </tr>
          ))}
        </tbody>
      </Scroll>
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
      <Section title="Season by season">
        <Scroll min="min-w-[46rem]">
          <thead><tr><th className="l w-16">Year</th><th className="l stick">Team</th><th>W-L</th><th>Finish</th><th>PF</th><th>Pts vs avg</th><th>xW</th><th>Luck</th></tr></thead>
          <tbody>
            {c.seasons.slice().reverse().map((s) => (
              <tr key={s.year}>
                <td className="l n"><button type="button" className="link" title={`Open ${s.year}`} onClick={() => go({ owner: null, year: String(s.year) })}>{s.year}</button>{s.live ? '*' : ''}{H.byYear.get(s.year)!.platform === 'Sleeper' ? <span className="tag ml-2 text-ink-3">Sleeper</span> : null}</td>
                <td className="l stick">{s.team}{s.with.length > 0 && <span className="block text-xs text-ink-3">with {s.with.map((o) => ownerName(H, o)).join(' & ')}</span>}</td>
                <td className="n">{rec(s.w, s.l, s.t)}</td>
                <td className="n">{s.live ? 'live' : place(s.finish)}</td>
                <td className="n">{fmt(s.pf)}</td>
                <td className="n">{vsAvg(s.index)}</td>
                <td className="n text-ink-2">{fmt(s.xw)}</td>
                <td className="n"><Luck v={s.luck} /></td>
              </tr>
            ))}
          </tbody>
        </Scroll>
      </Section>
      <Section title="Head to head" aside="Regular season and playoffs, 4+ games">
        <Scroll min="min-w-[34rem]">
          <thead><tr><th className="l stick">Opponent</th><th>Games</th><th>W-L</th><th>Win %</th><th>Playoffs</th><th>Avg score</th></tr></thead>
          <tbody>
            {rivals.map(({ x, h }) => (
              <tr key={x.owner}>
                <td className="l stick"><Who H={H} o={x.owner} go={go} /></td>
                <td className="n">{h.games.length}</td>
                <td className={`n ${h.w > h.l ? 'text-gain' : h.w < h.l ? 'text-loss' : ''}`}>{rec(h.w, h.l, h.t)}</td>
                <td className="n">{winPct(h.w, h.l, h.t)}</td>
                <td className="n">{h.playoffW + h.playoffL ? rec(h.playoffW, h.playoffL) : '–'}</td>
                <td className="n text-ink-2">{fmt(h.pf / h.games.length)} – {fmt(h.pa / h.games.length)}</td>
              </tr>
            ))}
          </tbody>
        </Scroll>
      </Section>
    </>
  );
}

// ---------- All seasons: luck ----------
function LuckTab({ H, all, go }: { H: Hist; all: Career[]; go: Go }) {
  const [everyone, setEveryone] = useState(false);
  const shown = all.filter((c) => everyone || c.lifer).sort((a, b) => b.luck - a.luck);
  const seasons = H.seasons.flatMap((x) => x.rows.filter((r) => !H.owners.get(r.owner)?.filler).map((r) => ({ ...r, year: x.year, live: x.live })));
  const bySeason = [...seasons].sort((a, b) => b.luck - a.luck);
  const line = (r: (typeof seasons)[number]) => (
    <li key={`${r.year}-${r.owner}`} className="flex items-center justify-between gap-3 border-b border-rule py-1.5">
      <Who H={H} o={r.owner} go={go} year={r.year} sub={`${r.year}${r.live ? ' so far' : ''} · ${r.team}`} />
      <span className="num shrink-0 text-right text-sm">{rec(r.w, r.l, r.t)} <span className="text-ink-3">xW {fmt(r.xw)}</span> <Luck v={r.luck} />{r.finish === 1 ? ' 🏆' : ''}</span>
    </li>
  );
  return (
    <>
      <Section title="Career luck" aside={<Seg label="Owners shown" value={everyone ? 'all' : 'lifers'} options={[['lifers', 'Lifers'], ['all', 'Everyone']]} onChange={(v) => setEveryone(v === 'all')} />}>
        <LuckBars rows={shown.map((c) => ({ key: c.owner, label: c.name, v: c.luck, title: `${c.name}: ${rec(c.w, c.l, c.t)}, ${fmt(c.xw)} expected wins over ${c.seasons.length} seasons` }))} />
        <p className="max-w-[70ch] text-sm text-ink-2">
          Luck is actual wins minus expected wins. Each week a score is compared with every other score that week: beating 8 of 11 is worth 8/11 of a win, whoever you actually played.
          Over a season that adds up to expected wins (xW). Each season's drawer has its own luck column.
        </p>
      </Section>
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Luckiest seasons"><ol className="grid">{bySeason.slice(0, 10).map(line)}</ol></Section>
        <Section title="Unluckiest seasons"><ol className="grid">{bySeason.slice(-10).reverse().map(line)}</ol></Section>
      </div>
    </>
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
    </>
  );
}
