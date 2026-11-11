import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRoute } from '../app/router.ts';
import { useLeague } from '../data/store.tsx';
import { validateHistory, type History as HistoryFile, type OwnerKey } from '../data/history.ts';
import {
  buildHist, careers, headToHead, LIFER_SEASONS, ownerName, records, seasonAwards,
  type Career, type Hist, type ScoreRec, type Season, type SeasonRow,
} from '../engine/history.ts';
import { Empty, fmt, Mono, Section, Seg, signed, tone } from '../ui/components.tsx';

const URL_ = `${import.meta.env.BASE_URL}seed/history.json`;
type Tab = 'trophies' | 'owners' | 'luck' | 'rivals' | 'records';
const TABS: [Tab, string][] = [['trophies', 'Trophies'], ['owners', 'Owners'], ['luck', 'Luck'], ['rivals', 'Rivals'], ['records', 'Records']];

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
  const { query, replace } = useRoute();
  const tab = (TABS.find(([t]) => t === query.get('tab'))?.[0] ?? 'trophies') as Tab;
  const set = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams(query);
    for (const [k, v] of Object.entries(patch)) if (v === null) q.delete(k); else q.set(k, v);
    replace('history', q.toString());
  };
  if (typeof file === 'string') return <Empty>{file}</Empty>;
  if (!H) return <p className="text-sm text-ink-3" role="status">Loading the league history…</p>;
  const first = H.seasons[0]!.year, last = H.seasons.at(-1)!;
  const all = careers(H);
  return (
    <div className="grid grid-cols-1 gap-8">
      <section aria-label="Headline" className="grid gap-2">
        <p className="headline-sm">{H.seasons.length} seasons of Favre's Waffle House</p>
        <p className="max-w-[70ch] text-ink-2">
          {first} to {last.year}{last.live ? ' (this season so far)' : ''}. {all.length} owners, {all.filter((c) => c.lifer).length} of them here {LIFER_SEASONS}+ seasons.
          ESPN every year but 2024 and 2025 (Sleeper), where scores ran about a third higher, so points are compared with each season's league average.
        </p>
      </section>
      <Seg label="History section" value={tab} options={TABS} onChange={(t) => set({ tab: t, owner: null, year: null, vs: null })} />
      {tab === 'trophies' && <Trophies H={H} all={all} go={set} />}
      {tab === 'owners' && <Owners H={H} all={all} owner={query.get('owner')} go={set} />}
      {tab === 'luck' && <LuckTab H={H} all={all} year={Number(query.get('year')) || null} go={set} />}
      {tab === 'rivals' && <Rivals H={H} all={all} pair={query.get('vs')} go={set} />}
      {tab === 'records' && <RecordsTab H={H} go={set} />}
    </div>
  );
}

type Go = (patch: Record<string, string | null>) => void;

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

function Who({ H, o, go, sub }: { H: Hist; o: OwnerKey; go?: Go; sub?: ReactNode }) {
  const own = H.owners.get(o);
  const label = <span className="flex items-center gap-2"><OwnerMark H={H} o={o} /><span>{ownerName(H, o)}</span></span>;
  return (
    <span className="grid">
      {go && !own?.filler ? <button type="button" className="link w-max text-left no-underline hover:underline" onClick={() => go({ tab: 'owners', owner: o, year: null, vs: null })}>{label}</button> : label}
      {sub && <span className="pl-7 text-xs text-ink-3">{sub}</span>}
    </span>
  );
}

const rec = (w: number, l: number, t = 0) => `${w}-${l}${t ? `-${t}` : ''}`;
const vsAvg = (index: number) => `${index >= 1 ? '+' : '−'}${Math.abs((index - 1) * 100).toFixed(0)}%`;
const winPct = (w: number, l: number, t = 0) => (w + l + t ? ((w + t / 2) / (w + l + t)).toFixed(3).replace(/^0/, '') : '–');
const Luck = ({ v }: { v: number }) => <span className={tone(v, 0.5)}>{signed(v)}</span>;
const Sleeper = ({ s }: { s: Season }) => (s.platform === 'Sleeper' ? <span className="tag ml-2 text-ink-3">Sleeper</span> : null);
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

// ---------- Trophies ----------
function Trophies({ H, all, go }: { H: Hist; all: Career[]; go: Go }) {
  const most = (f: (c: Career) => number) => { const m = Math.max(...all.map(f)); return { m, who: all.filter((c) => f(c) === m && m > 0) }; };
  const titles = most((c) => c.titles.length);
  const brides = most((c) => c.runnerUps.length);
  const ringless = most((c) => (c.titles.length ? 0 : c.seasons.filter((s) => !s.live).length));
  const drought = most((c) => (c.active && c.drought !== null ? c.drought : 0));
  const lucky = [...all].sort((a, b) => b.luck - a.luck);
  const names = (cs: Career[]) => cs.map((c) => c.name).join(', ');
  const done = H.seasons.filter((s) => !s.live).slice().reverse();
  const live = H.seasons.find((s) => s.live);
  const champLuck = done.filter((s) => (s.rows.find((r) => r.owner === s.podium[0])?.luck ?? 0) > 0).length;
  return (
    <>
      <Section title="Hall of fame">
        <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2 xl:grid-cols-3">
          <Stat label="Most titles" value={`${titles.m} · ${names(titles.who)}`} />
          <Stat label="Bridesmaid (most finals lost)" value={`${brides.m} · ${names(brides.who)}`} sub={brides.who.map((c) => `${c.titles.length} titles in ${c.titles.length + c.runnerUps.length} finals`).join('; ')} />
          <Stat label="Ringless (most seasons, no title)" value={`${ringless.m} · ${names(ringless.who)}`} />
          <Stat label="Longest active drought" value={`${drought.m} seasons · ${names(drought.who)}`} />
          <Stat label="Horseshoe (luckiest career)" value={<>{lucky[0]!.name} <Luck v={lucky[0]!.luck} /></>} sub="more wins than their scores earned" />
          <Stat label="Snakebitten (unluckiest career)" value={<>{lucky.at(-1)!.name} <Luck v={lucky.at(-1)!.luck} /></>} sub="fewer wins than their scores earned" />
        </div>
      </Section>
      <Section title="Champions" aside={`${champLuck} of ${done.length} champions had a lucky regular season`}>
        <Scroll min="min-w-[44rem]">
          <thead><tr><th className="l w-16">Year</th><th className="l stick">Champion</th><th className="l">Runner-up</th><th className="l">Third</th><th>Reg. season</th><th>Luck</th></tr></thead>
          <tbody>
            {live && (
              <tr><td className="l n">{live.year}</td><td className="l stick text-ink-3" colSpan={3}>In progress · <button type="button" className="link" onClick={() => go({ tab: 'luck', year: String(live.year) })}>see this season's luck</button></td><td /><td /></tr>
            )}
            {done.map((s) => {
              const c = s.rows.find((r) => r.owner === s.podium[0]);
              const team = (o?: OwnerKey) => s.rows.find((r) => r.owner === o)?.team;
              return (
                <tr key={s.year}>
                  <td className="l n">{s.year}<Sleeper s={s} /></td>
                  <td className="l stick font-medium">{s.podium[0] && <Who H={H} o={s.podium[0]} go={go} sub={team(s.podium[0])} />}</td>
                  <td className="l">{s.podium[1] && <Who H={H} o={s.podium[1]} go={go} sub={team(s.podium[1])} />}</td>
                  <td className="l">{s.podium[2] && <Who H={H} o={s.podium[2]} go={go} />}</td>
                  <td className="n">{c ? rec(c.w, c.l, c.t) : '–'}</td>
                  <td className="n">{c ? <Luck v={c.luck} /> : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </Scroll>
      </Section>
      <Section title="Season awards">
        <Scroll min="min-w-[48rem]">
          <thead><tr><th className="l w-16">Year</th><th className="l">🍀 Horseshoe (luckiest)</th><th className="l">💀 Snakebitten</th><th className="l">🚀 Points title</th><th className="l">🚽 Last place</th></tr></thead>
          <tbody>
            {H.seasons.slice().reverse().map((s) => {
              const a = seasonAwards(H, s);
              return (
                <tr key={s.year}>
                  <td className="l n">{s.year}{s.live ? '*' : ''}</td>
                  <td className="l"><Who H={H} o={a.horseshoe.owner} go={go} sub={<>{rec(a.horseshoe.w, a.horseshoe.l, a.horseshoe.t)}, {signed(a.horseshoe.luck)} wins</>} /></td>
                  <td className="l"><Who H={H} o={a.snakebitten.owner} go={go} sub={<>{rec(a.snakebitten.w, a.snakebitten.l, a.snakebitten.t)}, {signed(a.snakebitten.luck)} wins</>} /></td>
                  <td className="l"><Who H={H} o={a.points.owner} go={go} sub={`${fmt(a.points.pf)} pts, ${vsAvg(a.points.index)} vs avg`} /></td>
                  <td className="l">{a.last ? <Who H={H} o={a.last.owner} go={go} /> : <span className="text-ink-3">–</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </Scroll>
        <p className="text-xs text-ink-3">* this season so far.</p>
      </Section>
    </>
  );
}

// ---------- Owners ----------
type OKey = 'seasons' | 'win' | 'titles' | 'finals' | 'playoffs' | 'index' | 'luck';
function Owners({ H, all, owner, go }: { H: Hist; all: Career[]; owner: string | null; go: Go }) {
  const [everyone, setEveryone] = useState(false);
  const [sort, setSort] = useState<OKey>('titles');
  const c = owner ? all.find((x) => x.owner === owner) : undefined;
  if (c) return <OwnerPage H={H} c={c} go={go} />;
  const val = (x: Career): number => ({
    seasons: x.seasons.length, win: (x.w + x.t / 2) / Math.max(1, x.w + x.l + x.t), titles: x.titles.length * 100 + x.runnerUps.length * 10 + x.thirds.length,
    finals: x.titles.length + x.runnerUps.length, playoffs: x.playoffs / Math.max(1, x.completed), index: x.index, luck: x.luck,
  })[sort];
  const rows = all.filter((x) => everyone || x.lifer).sort((a, b) => val(b) - val(a) || b.seasons.length - a.seasons.length);
  const th = (k: OKey, label: string) => (
    <th aria-sort={sort === k ? 'descending' : 'none'}><button type="button" className="link -my-3 py-3 no-underline" onClick={() => setSort(k)}>{label}{sort === k ? ' ↓' : ''}</button></th>
  );
  return (
    <Section title="Owners" aside={<Seg label="Owners shown" value={everyone ? 'all' : 'lifers'} options={[['lifers', `Lifers (${LIFER_SEASONS}+ seasons)`], ['all', 'Everyone']]} onChange={(v) => setEveryone(v === 'all')} />}>
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
        <button type="button" className="link w-max text-sm" onClick={() => go({ owner: null })}>← All owners</button>
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
                <td className="l n">{s.year}{s.live ? '*' : ''}<Sleeper s={H.byYear.get(s.year)!} /></td>
                <td className="l stick">{s.team}</td>
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

// ---------- Luck ----------
function LuckTab({ H, all, year, go }: { H: Hist; all: Career[]; year: number | null; go: Go }) {
  const [everyone, setEveryone] = useState(false);
  const s = year ? H.byYear.get(year) : undefined;
  const picker = (
    <label className="flex items-center gap-2 text-sm text-ink-3">
      Season
      <select className="field w-auto" value={s?.year ?? ''} onChange={(e) => go({ year: e.target.value || null })}>
        <option value="">All time</option>
        {H.seasons.slice().reverse().map((x) => <option key={x.year} value={x.year}>{x.year}{x.live ? ' (so far)' : ''}</option>)}
      </select>
    </label>
  );
  const method = (
    <p className="max-w-[70ch] text-sm text-ink-2">
      Luck is actual wins minus expected wins. Each week a score is compared with every other score that week: beating 8 of 11 is worth 8/11 of a win, whoever you actually played.
      Over a season that adds up to expected wins (xW). Records are the official ones, so the 2012 stat correction counts as ESPN has it.
    </p>
  );
  if (s) return <SeasonLuck H={H} s={s} picker={picker} method={method} go={go} />;
  const shown = all.filter((c) => everyone || c.lifer).sort((a, b) => b.luck - a.luck);
  const seasons = H.seasons.flatMap((x) => x.rows.filter((r) => !H.owners.get(r.owner)?.filler).map((r) => ({ ...r, year: x.year, live: x.live })));
  const bySeason = [...seasons].sort((a, b) => b.luck - a.luck);
  const line = (r: (typeof seasons)[number]) => (
    <li key={`${r.year}-${r.owner}`} className="flex items-center justify-between gap-3 border-b border-rule py-1.5">
      <Who H={H} o={r.owner} go={go} sub={`${r.year}${r.live ? ' so far' : ''} · ${r.team}`} />
      <span className="num shrink-0 text-right text-sm">{rec(r.w, r.l, r.t)} <span className="text-ink-3">xW {fmt(r.xw)}</span> <Luck v={r.luck} />{r.finish === 1 ? ' 🏆' : ''}</span>
    </li>
  );
  return (
    <>
      <div className="flex flex-wrap items-end gap-4">{picker}</div>
      <Section title="Career luck" aside={<Seg label="Owners shown" value={everyone ? 'all' : 'lifers'} options={[['lifers', 'Lifers'], ['all', 'Everyone']]} onChange={(v) => setEveryone(v === 'all')} />}>
        <LuckBars rows={shown.map((c) => ({ key: c.owner, label: c.name, v: c.luck, title: `${c.name}: ${rec(c.w, c.l, c.t)}, ${fmt(c.xw)} expected wins over ${c.seasons.length} seasons` }))} />
        {method}
      </Section>
      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Luckiest seasons"><ol className="grid">{bySeason.slice(0, 10).map(line)}</ol></Section>
        <Section title="Unluckiest seasons"><ol className="grid">{bySeason.slice(-10).reverse().map(line)}</ol></Section>
      </div>
    </>
  );
}

function SeasonLuck({ H, s, picker, method, go }: { H: Hist; s: Season; picker: ReactNode; method: ReactNode; go: Go }) {
  const rows = [...s.rows].sort((a, b) => b.luck - a.luck);
  return (
    <>
      <div className="flex flex-wrap items-end gap-4">{picker}<button type="button" className="link text-sm" onClick={() => go({ year: null })}>All time</button></div>
      <Section title={`${s.year}${s.live ? ' so far' : ''}: wins vs expected wins`} aside={s.platform === 'Sleeper' ? 'Sleeper season' : undefined}>
        <Scatter H={H} rows={s.rows} />
        {method}
      </Section>
      <Section title={`${s.year} luck table`}>
        <Scroll min="min-w-[40rem]">
          <thead><tr><th className="l stick">Owner</th><th>W-L</th><th>xW</th><th>Luck</th><th>All-play</th><th>Pts vs avg</th><th>Finish</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.owner}>
                <td className="l stick"><Who H={H} o={r.owner} go={go} sub={r.team} /></td>
                <td className="n">{rec(r.w, r.l, r.t)}</td>
                <td className="n text-ink-2">{fmt(r.xw)}</td>
                <td className="n"><Luck v={r.luck} /></td>
                <td className="n text-ink-2">{rec(r.allPlay.w, r.allPlay.l, r.allPlay.t)}</td>
                <td className="n">{vsAvg(r.index)}</td>
                <td className="n">{s.live ? '–' : place(r.finish)}</td>
              </tr>
            ))}
          </tbody>
        </Scroll>
        {s.notes.map((n) => <p key={n} className="max-w-[70ch] text-sm text-ink-3">{n}</p>)}
      </Section>
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

// Actual wins against expected wins; points above the diagonal won more than they scored.
function Scatter({ H, rows }: { H: Hist; rows: SeasonRow[] }) {
  const W = 560, P = 36, max = Math.ceil(Math.max(...rows.map((r) => Math.max(r.w + r.t / 2, r.xw)), 1)) + 1;
  const x = (v: number) => P + (v / max) * (W - P - 12), y = (v: number) => W - P - (v / max) * (W - P - 12);
  const sorted = [...rows].sort((a, b) => b.luck - a.luck);
  const label = new Set([sorted[0], sorted.at(-1)].map((r) => r?.owner)); // extremes only; hover and the table carry the rest
  const ticks = Array.from({ length: max + 1 }, (_, i) => i).filter((i) => i % 2 === 0);
  return (
    <svg viewBox={`0 0 ${W} ${W}`} className="w-full max-w-xl" role="img" aria-label="Each team's actual wins against expected wins; the table below has the same numbers">
      {ticks.map((t) => (
        <g key={t} className="text-[11px]" fill="var(--ink-3)">
          <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(max)} stroke="var(--rule)" />
          <line x1={x(0)} x2={x(max)} y1={y(t)} y2={y(t)} stroke="var(--rule)" />
          <text x={x(t)} y={y(0) + 16} textAnchor="middle" fontFamily="var(--font-mono)">{t}</text>
          <text x={x(0) - 8} y={y(t) + 4} textAnchor="end" fontFamily="var(--font-mono)">{t}</text>
        </g>
      ))}
      <line x1={x(0)} y1={y(0)} x2={x(max)} y2={y(max)} stroke="var(--ink-3)" strokeDasharray="4 4" />
      <text x={x(max) - 4} y={y(max) + 16} textAnchor="end" className="text-[11px]" fill="var(--ink-3)">wins = expected</text>
      <text x={(W + P) / 2} y={W - 4} textAnchor="middle" className="text-xs" fill="var(--ink-2)">Expected wins</text>
      <text x={12} y={(W - P) / 2} textAnchor="middle" className="text-xs" fill="var(--ink-2)" transform={`rotate(-90 12 ${(W - P) / 2})`}>Actual wins</text>
      {rows.map((r) => {
        const cx = x(r.xw), cy = y(r.w + r.t / 2);
        return (
          <g key={r.owner}>
            <circle cx={cx} cy={cy} r={6} fill={r.luck >= 0.5 ? 'var(--gain)' : r.luck <= -0.5 ? 'var(--loss)' : 'var(--ink-3)'} stroke="var(--paper)" strokeWidth={2}>
              <title>{`${ownerName(H, r.owner)}: ${rec(r.w, r.l, r.t)}, ${fmt(r.xw)} expected, luck ${signed(r.luck)}`}</title>
            </circle>
            {label.has(r.owner) && <text x={cx > W * 0.6 ? cx - 10 : cx + 10} y={cy + 4} textAnchor={cx > W * 0.6 ? 'end' : 'start'} className="text-xs" fill="var(--ink)">{ownerName(H, r.owner)} {signed(r.luck)}</text>}
          </g>
        );
      })}
    </svg>
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
      <Who H={H} o={r.owner} go={go} sub={`${r.year} Wk ${r.week}${r.kind === 'playoff' ? ' (playoffs)' : ''} vs ${ownerName(H, r.opp)}${plat(r.year)}`} />
      <span className="num shrink-0 text-right text-sm">{value}</span>
    </li>
  );
  const score = (r: ScoreRec) => game(r, <>{fmt(r.pts, 2)} <span className="block text-xs text-ink-3">{r.index.toFixed(2)}× avg</span></>);
  const heartCount = new Map<string, number>();
  R.heartbreaks.forEach((r) => heartCount.set(r.owner, (heartCount.get(r.owner) ?? 0) + 1));
  const topHeart = [...heartCount].sort((a, b) => b[1] - a[1])[0];
  const seasonLine = (r: (typeof seasons)[number], v: ReactNode) => (
    <li key={`${r.s.year}-${r.owner}`} className="flex items-center justify-between gap-3 border-b border-rule py-1.5">
      <Who H={H} o={r.owner} go={go} sub={`${r.s.year} · ${r.team}`} />
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
