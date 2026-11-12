// Trade history on the History page: every trade 2018 to last season, graded the way the Tracker
// grades live trades (src/engine/tradeHistory.ts, worked out at build time). Loads
// public/seed/trades.json once, when a trade view first opens.
import { useEffect, useId, useMemo, useState } from 'react';
import { useLeague } from '../data/store.tsx';
import type { OwnerKey } from '../data/history.ts';
import { tradesUrl, validateTrades, type HistTrade, type TradeSide, type Trades } from '../data/trades.ts';
import { crewName, ownerName, type Hist, type Season } from '../engine/history.ts';
import { ordinal } from '../engine/drafts.ts';
import { Empty, fmt, Sheet, signed } from '../ui/components.tsx';
import { Filters } from '../ui/filters.tsx';
import { Stamp } from '../ui/stamp.tsx';
import { PosTag } from './HistoryDrafts.tsx';

let file: Promise<Trades | string> | null = null;
function loadTrades(): Promise<Trades | string> {
  file ??= fetch(tradesUrl(import.meta.env.BASE_URL), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
    .then((raw) => { const v = validateTrades(raw); return v.ok ? v.value : `The trade history file is invalid: ${v.errors[0]}`; })
    .catch((e) => { file = null; return `Could not load the trade history (${e instanceof Error ? e.message : e}).`; });
  return file;
}
export function useTrades(): Trades | string | null {
  const [t, setT] = useState<Trades | string | null>(null);
  useEffect(() => { let live = true; loadTrades().then((v) => live && setT(v)); return () => { live = false; }; }, []);
  return t;
}

const graded = (t: HistTrade) => t.sides[0].grade !== null;
const lopsided = (t: HistTrade) => Math.abs(t.sides[0].score ?? 0);
const flipped = (t: HistTrade) => t.sides.some((s) => s.record.playoffs !== s.alt.playoffs);
const won = (s: TradeSide) => (s.score ?? 0) > 0.04; // C+ or better
const lost = (s: TradeSide) => (s.score ?? 0) < -0.04; // C- or worse

// The (i) card: how a trade is graded. Tap anywhere to close (native popover).
export function TradeHelp() {
  const id = useId().replace(/:/g, '');
  return (
    <>
      <button type="button" popoverTarget={id} className="inline-grid size-7 shrink-0 place-items-center rounded-full border border-rule-strong font-mono text-xs text-ink-2 hover:bg-sunk" aria-label="How trades are graded" title="How trades are graded">i</button>
      <div id={id} popover="auto" className="popcard" role="dialog" aria-label="How trades are graded">
        <p className="mb-2 font-display text-lg font-bold [font-stretch:85%]">How trades are graded</p>
        <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-ink-2">
          <li><span className="text-ink">At the trade:</span> projected points per week above a replacement starter for the rest of the season, what you got minus what you gave.</li>
          <li><span className="text-ink">As weeks are played</span> the grade moves to real production: points per week above replacement (the 12th QB, 31st RB, 34th WR, 7th TE that week). A week a player doesn't play counts as even, since you'd start someone else. After n weeks, n ÷ (n + 4) of the grade is production.</li>
          <li><span className="text-ink">Keepers:</span> players from the trade kept the next season count too, at their worth minus keeper price (a quarter of the weight), once that season is over.</li>
          <li><span className="text-ink">C is even.</span> A and B: you came out ahead. D and F: you gave up more than you got.</li>
        </ol>
        <p className="mt-3 text-sm text-ink-2">The record and seed lines replay every week with the trade undone: your real score plus your best lineup without the trade minus your best lineup with it.</p>
        <p className="mt-2 text-xs text-ink-3">The same method as the Tracker page, without trade-chart values (none exist for past seasons). "Found from rosters" trades have no ESPN record; players swapped directly between two teams that week. Tap anywhere to close.</p>
      </div>
    </>
  );
}

function SideSummary({ H, t, s, players }: { H: Hist; t: HistTrade; s: TradeSide; players: Trades['players'] }) {
  return (
    <div className="flex min-w-0 items-start gap-3">
      {s.grade ? <Stamp grade={s.grade} size="sm" /> : <span className="inline-grid size-8 shrink-0 place-items-center border border-rule text-xs text-ink-3">–</span>}
      <div className="grid min-w-0 gap-0.5">
        <span className="truncate font-medium">{crewName(H, s.owner, t.year)}</span>
        <span className="text-sm text-ink-2">{s.gets.length ? <>got {s.gets.map((g) => players[g.p]![0]).join(', ')}</> : 'no players'}{s.faab > 0 ? ` + $${s.faab} budget` : ''}</span>
      </div>
    </div>
  );
}

function TradeCard({ H, t, players, onOpen }: { H: Hist; t: HistTrade; players: Trades['players']; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="grid w-full gap-3 border-b border-rule py-3 text-left transition-colors hover:bg-sunk sm:px-2">
        <span className="flex flex-wrap items-center gap-2 text-xs text-ink-3">
          <span className="font-mono text-sm text-ink-2">{t.year} · Week {t.week}</span>
          {t.confidence === 'likely' && <span className="tag text-ink-3" title="No ESPN trade record; players swapped directly between the two teams that week">found from rosters</span>}
          {t.source === 'Sleeper' && <span className="tag text-ink-3">Sleeper</span>}
          {flipped(t) && <span className="tag text-accent-ink">changed a playoff spot</span>}
          {!graded(t) && <span className="tag text-ink-3">budget only</span>}
        </span>
        <span className="grid gap-3 sm:grid-cols-2">{t.sides.map((s) => <SideSummary key={s.owner} H={H} t={t} s={s} players={players} />)}</span>
      </button>
    </li>
  );
}

function TradeList({ H, data, list, empty }: { H: Hist; data: Trades; list: HistTrade[]; empty: string }) {
  const [open, setOpen] = useState<HistTrade | null>(null);
  const [n, setN] = useState(20);
  if (!list.length) return <Empty>{empty}</Empty>;
  return (
    <>
      <ul className="grid border-t border-rule">{list.slice(0, n).map((t) => <TradeCard key={t.id} H={H} t={t} players={data.players} onOpen={() => setOpen(t)} />)}</ul>
      {list.length > n && <button type="button" className="btn justify-self-start" onClick={() => setN(n + 20)}>Show {Math.min(20, list.length - n)} more of {list.length - n}</button>}
      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open ? `${open.year} trade · Week ${open.week}` : ''}>
        {open && <TradeDetail H={H} t={open} players={data.players} />}
      </Sheet>
    </>
  );
}

function TradeDetail({ H, t, players }: { H: Hist; t: HistTrade; players: Trades['players'] }) {
  const name = (p: number) => players[p]![0];
  const rec = (r: TradeSide['record']) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''} · ${ordinal(r.seed)} seed · ${r.playoffs ? 'playoffs' : 'out'}`;
  return (
    <div className="grid gap-5">
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
        {t.confidence === 'likely' ? 'Found from the weekly rosters (no ESPN trade record).' : `${t.source} trade record${t.date ? `, ${t.date.slice(0, 10)}` : ''}.`}
        {t.eff !== t.week && ` First used in week ${t.eff}.`}
        <span className="flex items-center gap-2">How is this graded? <TradeHelp /></span>
      </p>
      {t.sides.map((s) => (
        <section key={s.owner} className="grid gap-3">
          <div className="flex items-center gap-3 border-b border-ink pb-2">
            {s.grade ? <Stamp grade={s.grade} /> : null}
            <div className="grid min-w-0">
              <h3 className="truncate text-lg">{crewName(H, s.owner, t.year)}</h3>
              <span className="text-sm text-ink-2">{s.finish ? `finished ${ordinal(s.finish)}` : ''}{s.grade && s.initGrade ? ` · ${s.initGrade} at the trade, ${s.grade} at season's end` : ''}</span>
            </div>
          </div>
          {s.gets.length > 0 ? (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="tbl">
                <thead><tr><th className="l stick">Got</th><th title="Points per week after the trade (0 for weeks off every roster)">Pts/wk</th><th title="Projected points per week after the trade">Proj/wk</th><th title="Weeks this team started him, of the weeks after the trade">Starts</th></tr></thead>
                <tbody>{s.gets.map((g) => (
                  <tr key={g.p}><td className="l stick"><span className="flex items-center gap-2"><PosTag pos={players[g.p]![1]} /><span className="max-w-40 truncate">{name(g.p)}</span></span></td><td className="n">{fmt(g.ptsWk, 1)}</td><td className="n text-ink-3">{fmt(g.projWk, 1)}</td><td className="n">{g.starts}/{g.weeks}</td></tr>
                ))}</tbody>
              </table>
            </div>
          ) : <p className="text-sm text-ink-2">No players{s.faab ? `; ${s.faab > 0 ? 'received' : 'sent'} $${Math.abs(s.faab)} of budget` : ''}.</p>}
          {s.grade && (
            <dl className="m-0 grid gap-x-8 text-sm sm:grid-cols-2">
              <Line label="At the trade" note="projected pts/wk above replacement, got minus gave">{s.projGain === null ? '–' : signed(s.projGain, 1)}</Line>
              <Line label="Production" note="pts/wk above replacement, got minus gave">{s.prod === null ? '–' : signed(s.prod, 1)}</Line>
              <Line label="With the trade" note="real record">{rec(s.record)}</Line>
              <Line label="Undone" note="every week replayed without it">{rec(s.alt)}</Line>
              <Line label="Keepers next season" note={s.kept.length ? `${s.kept.map((k) => `${name(k.p)} at $${k.price}`).join(', ')}${s.keepFinal ? '' : ' (season in progress, not graded yet)'}` : 'none kept from this trade'}>{!s.keepFinal ? 'so far' : s.keep ? signed(s.keep, 0).replace(/^([+−])/, '$1$') : '$0'}</Line>
            </dl>
          )}
          {s.path.length > 1 && (
            <div className="grid gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">Grade after each week</span>
              <ol className="flex flex-wrap gap-1" aria-label="Grade after each week">
                {s.path.map((g, i) => <li key={i} className="grid w-9 justify-items-center gap-0.5"><Stamp grade={g} size="sm" /><span className="font-mono text-[0.7rem] text-ink-3">{i === 0 ? 'trade' : `wk${t.eff + i - 1}`}</span></li>)}
              </ol>
            </div>
          )}
        </section>
      ))}
      {t.dropped.length > 0 && <p className="text-sm text-ink-3">Released as part of the trade: {t.dropped.map(([o, p]) => `${name(p)} (${ownerName(H, o)})`).join(', ')}.</p>}
    </div>
  );
}

function Line({ label, note, children }: { label: string; note: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4 border-b border-rule py-1.5">
      <dt className="text-ink-3">{label}<span className="block text-xs">{note}</span></dt>
      <dd className="m-0 shrink-0 text-right font-mono text-sm">{children}</dd>
    </div>
  );
}

// ---------- All seasons: every trade ----------
type Order = 'newest' | 'lopsided' | 'playoffs';
export function TradeSearch({ H, onOwner }: { H: Hist; onOwner: (o: OwnerKey) => void }) {
  const data = useTrades();
  const { settings } = useLeague();
  const START = { owner: '', season: 'all', source: 'all', order: 'newest' as Order };
  const [f, setF] = useState(START);
  const list = useMemo(() => {
    if (!data || typeof data === 'string') return [];
    const out = data.trades.filter((t) => (!f.owner || t.sides.some((s) => s.owner === f.owner)) && (f.season === 'all' || t.year === Number(f.season))
      && (f.source === 'all' || (f.source === 'confirmed' ? t.confidence === 'confirmed' : t.confidence === 'likely')) && (f.order !== 'playoffs' || flipped(t)));
    return out.sort(f.order === 'lopsided' ? (a, b) => lopsided(b) - lopsided(a) : (a, b) => b.year - a.year || b.week - a.week);
  }, [data, f]);
  if (data === null) return <p className="text-sm text-ink-3" role="status">Loading the trade history…</p>;
  if (typeof data === 'string') return <Empty>{data}</Empty>;
  const years = [...new Set(data.trades.map((t) => t.year))].sort((a, b) => b - a);
  const owners = [...new Set(data.trades.flatMap((t) => t.sides.map((s) => s.owner)))].filter((o) => !H.owners.get(o)?.filler).sort((a, b) => ownerName(H, a).localeCompare(ownerName(H, b)));
  const mine = [...H.owners.values()].find((o) => settings.myTeamId != null && o.teamId === settings.myTeamId && !o.filler)?.key;
  const set = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">{data.trades.length} trades from 2018 to {years[0]}, each side graded A to F. This season's trades are on the <a className="link" href="#/tracker">Tracker</a>. <TradeHelp /></p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={`btn ${f.order === 'lopsided' && !f.owner && f.season === 'all' ? 'btn-primary' : ''}`} onClick={() => setF({ ...START, order: 'lopsided' })}>Most lopsided</button>
        <button type="button" className={`btn ${f.order === 'playoffs' && !f.owner ? 'btn-primary' : ''}`} onClick={() => setF({ ...START, order: 'playoffs' })}>Changed a playoff spot</button>
        {mine && <button type="button" className={`btn ${f.owner === mine ? 'btn-primary' : ''}`} onClick={() => setF({ ...START, owner: mine })}>My trades</button>}
      </div>
      <Filters
        changed={JSON.stringify(f) !== JSON.stringify(START)}
        onReset={() => setF(START)}
        summary={<><span className="num font-semibold text-ink">{list.length}</span> of {data.trades.length} trades</>}
        fields={[
          { id: 'owner', label: 'Owner', value: f.owner, onChange: (v) => set({ owner: v }), options: [['', 'Anyone'], ...owners.map((o) => [o, ownerName(H, o)] as [string, string])] },
          { id: 'season', label: 'Season', value: f.season, onChange: (v) => set({ season: v }), options: [['all', 'All seasons'], ...years.map((y) => [String(y), String(y)] as [string, string])] },
          { id: 'source', label: 'Record', value: f.source, onChange: (v) => set({ source: v }), options: [['all', 'All trades'], ['confirmed', 'Confirmed records'], ['likely', 'Found from rosters']] },
          { id: 'order', label: 'Order', value: f.order, onChange: (v) => set({ order: v as Order }), options: [['newest', 'Newest'], ['lopsided', 'Most lopsided'], ['playoffs', 'Changed a playoff spot']] },
        ]}
      />
      <TradeList H={H} data={data} list={list} empty="No trades match these filters." />
      <OwnerBoard H={H} data={data} onOwner={onOwner} />
    </div>
  );
}

// Trade records by owner: won = C+ or better, lost = C- or worse.
function OwnerBoard({ H, data, onOwner }: { H: Hist; data: Trades; onOwner: (o: OwnerKey) => void }) {
  const rows = useMemo(() => {
    const m = new Map<OwnerKey, { n: number; w: number; l: number; sum: number }>();
    for (const t of data.trades) if (graded(t)) for (const s of t.sides) {
      if (H.owners.get(s.owner)?.filler) continue;
      const r = m.get(s.owner) ?? { n: 0, w: 0, l: 0, sum: 0 };
      r.n++; if (won(s)) r.w++; if (lost(s)) r.l++; r.sum += s.score ?? 0; m.set(s.owner, r);
    }
    return [...m].sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n);
  }, [data, H]);
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-ink pb-1.5"><h2 className="text-lg">Trade records</h2><span className="text-sm text-ink-3">won = C+ or better</span></div>
      <div className="-mx-4 overflow-x-auto md:mx-0">
        <table className="tbl">
          <thead><tr><th className="l stick">Owner</th><th>Trades</th><th>Won</th><th>Lost</th><th title="Average grade score, 0 = even">Avg</th></tr></thead>
          <tbody>{rows.map(([o, r]) => (
            <tr key={o}><td className="l stick"><button type="button" className="link" onClick={() => onOwner(o)}>{ownerName(H, o)}</button></td><td className="n">{r.n}</td><td className="n text-gain">{r.w}</td><td className="n text-loss">{r.l}</td><td className="n">{signed(r.sum / r.n, 2)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- one season ----------
export function SeasonTrades({ H, s }: { H: Hist; s: Season; onOwner?: (o: OwnerKey) => void }) {
  const data = useTrades();
  if (s.live) return <Empty>This season's trades are graded live on the <a className="link" href="#/tracker">Tracker</a> page.</Empty>;
  if (s.year < 2018) return <Empty>ESPN kept no trade records before 2018.</Empty>;
  if (data === null) return <p className="text-sm text-ink-3" role="status">Loading the {s.year} trades…</p>;
  if (typeof data === 'string') return <Empty>{data}</Empty>;
  const list = data.trades.filter((t) => t.year === s.year).sort((a, b) => b.week - a.week);
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">{list.length} trade{list.length === 1 ? '' : 's'} in {s.year}{list.some((t) => t.confidence === 'likely') ? `, ${list.filter((t) => t.confidence === 'likely').length} found from the weekly rosters` : ''}. <TradeHelp /></p>
      <TradeList H={H} data={data} list={list} empty={`No trades recorded in ${s.year}.`} />
    </div>
  );
}

// ---------- an owner's trades (owner page) ----------
export function OwnerTrades({ H, owner }: { H: Hist; owner: OwnerKey }) {
  const data = useTrades();
  if (data === null || typeof data === 'string') return null;
  const list = data.trades.filter((t) => t.sides.some((s) => s.owner === owner || (H.owners.get(owner)?.coOwns?.some((c) => c.team === s.owner && t.year >= c.from) ?? false))).sort((a, b) => b.year - a.year || b.week - a.week);
  if (!list.length) return null;
  const mine = list.map((t) => t.sides.find((s) => s.owner === owner) ?? t.sides.find((s) => H.owners.get(owner)?.coOwns?.some((c) => c.team === s.owner))!).filter((s) => s.grade);
  return (
    <section className="grid gap-3">
      <div className="flex items-baseline justify-between gap-3 border-b border-ink pb-1.5"><h2 className="text-lg">Trades</h2><span className="text-sm text-ink-3">{mine.filter(won).length} won, {mine.filter(lost).length} lost of {mine.length} graded</span></div>
      <TradeList H={H} data={data} list={list} empty="" />
    </section>
  );
}
