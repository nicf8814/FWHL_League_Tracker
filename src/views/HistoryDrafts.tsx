// Draft history on the History page: the Drafts search (All seasons), each season's team drafts,
// and the player history sheet both open. Loads public/seed/drafts.json once, only when a draft
// view first opens.
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLeague } from '../data/store.tsx';
import { draftsUrl, validateDrafts, type DraftSeason, type Drafts } from '../data/drafts.ts';
import type { OwnerKey } from '../data/history.ts';
import { buildDraftBook, ordinal, posRank, REPLACEMENT, type DraftBook, type DraftPick } from '../engine/drafts.ts';
import { crewName, ownerName, type Hist, type Season } from '../engine/history.ts';
import { Empty, fmt, Seg, Sheet, signed, tone } from '../ui/components.tsx';
import { Filters } from '../ui/filters.tsx';
import { DataTable, TableBar, useTable, type Col } from '../ui/table.tsx';

// ---------- loading ----------
let file: Promise<Drafts | string> | null = null;
function loadDrafts(): Promise<Drafts | string> {
  file ??= fetch(draftsUrl(import.meta.env.BASE_URL), { cache: 'no-cache' })
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
    .then((raw) => { const v = validateDrafts(raw); return v.ok ? v.value : `The draft history file is invalid: ${v.errors[0]}`; })
    .catch((e) => { file = null; return `Could not load the draft history (${e instanceof Error ? e.message : e}).`; });
  return file;
}

export function useDraftBook(H: Hist): DraftBook | string | null {
  const { idx } = useLeague();
  const [d, setD] = useState<Drafts | string | null>(null);
  useEffect(() => { let live = true; loadDrafts().then((v) => live && setD(v)); return () => { live = false; }; }, []);
  return useMemo(() => {
    if (d === null || typeof d === 'string') return d;
    const byTeam = new Map([...H.owners.values()].filter((o) => o.teamId !== null && !o.filler).map((o) => [o.teamId!, o.key]));
    const year = H.seasons.find((s) => s.live)?.year;
    return buildDraftBook(d, year ? { year, idx, teamOwner: (t) => byTeam.get(t) } : undefined);
  }, [d, H, idx]);
}

// ---------- small pieces ----------
const money = (v: number | null) => (v === null ? '–' : `$${v}`);
const pct = (v: number) => `${Math.round(v * 100)}%`;
const Value = ({ v }: { v: number | null }) => <span className={`font-semibold ${tone(v ?? 0, 1.5)}`}>{v === null ? '–' : v === 0 ? '$0' : signed(v, 0).replace(/^([+−])/, '$1$')}</span>;
const refLabel = (s?: DraftSeason) => (s?.ref === 'est' ? 'Est. $' : 'ESPN avg $');
const refTitle = (s?: DraftSeason) => (s?.ref === 'est' ? "The Sleeper export's estimate (budget split by value over replacement), not a Sleeper number" : "ESPN's average auction value that year");
const projSource = (s?: DraftSeason) => (s?.proj === 'sleeper' ? 'Sleeper, pulled after the season' : 'ESPN preseason');
const ptsMark = (s?: DraftSeason) => (s?.pts === 'rostered' ? '*' : s?.pts === 'to-date' ? '†' : '');
const POS_BG: Record<string, string> = { QB: 'bg-pos-qb', RB: 'bg-pos-rb', WR: 'bg-pos-wr', TE: 'bg-pos-te' };
export const PosTag = ({ pos }: { pos: string }) => <span className={`inline-block min-w-[2.1rem] shrink-0 rounded-sm text-center font-mono text-xs leading-[1.1rem] font-semibold text-on-pos ${POS_BG[pos] ?? 'bg-ink-3'}`}>{pos}</span>;
const KeeperTag = () => <span className="tag text-accent-ink" title="Keeper: the price is the keeper cost, not a market price">K</span>;
const shortCrew = (H: Hist, o: OwnerKey, y: number) => { const n = crewName(H, o, y); return n.includes(' & ') ? n.split(' & ').map((x) => x.split(' ')[0]).join(' & ') : n; };

// The "how is value worked out" popup: tap the (i), tap anywhere else to close (native popover).
export function ValueHelp({ label = 'How value is worked out' }: { label?: string }) {
  const id = useId().replace(/:/g, '');
  return (
    <>
      <button type="button" popoverTarget={id} className="inline-grid size-7 shrink-0 place-items-center rounded-full border border-rule-strong align-middle font-mono text-xs text-ink-2 hover:bg-sunk" aria-label={label} title={label}>i</button>
      <div id={id} popover="auto" className="popcard" role="dialog" aria-label={label}>
        <p className="mb-2 font-display text-lg font-bold [font-stretch:85%]">How value is worked out</p>
        <ol className="grid list-decimal gap-1.5 pl-5 text-sm text-ink-2">
          <li><span className="text-ink">Replacement level.</span> What the 12th-best drafted QB or TE, the 30th RB or the 36th WR scored that season: about what $1 buys.</li>
          <li><span className="text-ink">Points over replacement.</span> His season points minus that level (none if below it).</li>
          <li><span className="text-ink">The draft's going rate.</span> Every non-keeper's dollars above $1, divided by their points over replacement. About $0.30 to $0.60 a point.</li>
          <li><span className="text-ink">Worth</span> = $1 + points over replacement × going rate. <span className="text-ink">Value</span> = worth − price paid.</li>
        </ol>
        <p className="mt-3 text-sm text-ink-2">Example: in 2020 the 12th TE scored 84. Kelce scored 208, 124 over. That draft paid $0.45 a point, so he was worth $1 + 124 × $0.45 = $56. He cost $49: value +$7.</p>
        <p className="mt-2 text-xs text-ink-3">Hindsight: it shows how a pick turned out, not whether it was a good bet at the time. Keepers are judged against their keeper price. Tap anywhere to close.</p>
      </div>
    </>
  );
}

// The search results: the filters above set the rows, this ranks and sorts them and exports the view.
function PickTable({ H, book, rows, onPlayer }: { H: Hist; book: DraftBook; rows: DraftPick[]; onPlayer: (p: number) => void }) {
  const [limit, setLimit] = useState(PAGE);
  const cols = useMemo<Col<DraftPick>[]>(() => [
    {
      id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[11rem] !h-auto py-1.5', value: (x) => x.name,
      cell: (x) => (
        <>
          <span className="flex items-center gap-2"><PosTag pos={x.pos} /><button type="button" className="link max-w-36 truncate sm:max-w-48" onClick={() => onPlayer(x.player)}>{x.name}</button>{x.keeper && <KeeperTag />}</span>
          <span className="block max-w-48 truncate pl-[2.6rem] text-xs text-ink-3 md:hidden">{x.year} · {crewName(H, x.owner, x.year)}</span>
        </>
      ),
    },
    { id: 'year', label: 'Year', left: true, className: 'hidden md:table-cell', value: (x) => x.year },
    { id: 'owner', label: 'Drafted by', left: true, className: 'hidden md:table-cell', value: (x) => crewName(H, x.owner, x.year) },
    { id: 'price', label: 'Paid', value: (x) => x.price, cell: (x) => <b className="font-semibold">${x.price}</b> },
    { id: 'proj', label: 'Proj', className: 'hidden text-ink-3 md:table-cell', value: (x) => x.proj, cell: (x) => (x.proj === null ? '–' : `${fmt(x.proj, 0)}${book.seasons.get(x.year)?.proj === 'sleeper' ? '‡' : ''}`) },
    { id: 'pts', label: 'Pts', value: (x) => x.pts, cell: (x) => (x.pts === null ? <span className="text-ink-3">–</span> : <>{fmt(x.pts, 0)}<span className="text-ink-3">{ptsMark(book.seasons.get(x.year))}</span></>) },
    { id: 'value', label: 'Value', value: (x) => x.value, cell: (x) => <Value v={x.value} /> },
    { id: 'round', label: 'Round', hidden: true, value: (x) => x.round },
    { id: 'overall', label: 'Pick', hidden: true, value: (x) => x.overall },
  ], [H, book, onPlayer]);
  const t = useTable('draft-search', cols, rows, { id: 'value', dir: -1 });
  return (
    <>
      <TableBar t={t} noun="picks" file="fwhl-draft-picks" />
      <DataTable t={t} rowKey={(x) => String(x.i)} stickyId="name" limit={limit} minWidth="md:min-w-[40rem]" empty="No pick matches these filters." />
      {t.sorted.length > limit && <button type="button" className="btn justify-self-start" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, t.sorted.length - limit)} more</button>}
    </>
  );
}

// ---------- player history ----------
type Metric = 'value' | 'paid' | 'points';

export function PlayerSheet({ H, book, player, year, onClose }: { H: Hist; book: DraftBook; player: number | null; year?: number; onClose: () => void }) {
  const p = player === null ? undefined : book.players[player];
  return (
    <Sheet open={player !== null} onClose={onClose} title={p ? `${p[0]} · draft history` : ''}>
      {player !== null && <PlayerHistory H={H} book={book} player={player} year={year} />}
    </Sheet>
  );
}

export function PlayerHistory({ H, book, player, year }: { H: Hist; book: DraftBook; player: number; year?: number }) {
  const ps = useMemo(() => [...(book.byPlayer.get(player) ?? [])].sort((a, b) => a.year - b.year), [book, player]);
  const [metric, setMetric] = useState<Metric>('value');
  const fallback = ps.find((x) => x.year === year) ?? ps.filter((x) => !book.seasons.get(x.year) || book.seasons.get(x.year)!.pts !== 'to-date').at(-1) ?? ps.at(-1);
  const [selYear, setSelYear] = useState<number | undefined>(fallback?.year);
  const sel = ps.find((x) => x.year === selYear) ?? fallback;
  const chart = useRef<HTMLDivElement>(null);
  // Keep the chosen season in view when the chart scrolls sideways (phones, long careers).
  useEffect(() => { chart.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [sel?.year]);
  if (!ps.length || !sel) return <Empty>This player was never drafted in the league.</Empty>;
  const pos = book.players[player]![1];
  const years = book.years.filter((y) => y >= ps[0]!.year && y <= ps.at(-1)!.year);
  const byYear = new Map(ps.map((x) => [x.year, x]));
  const owners = new Set(ps.map((x) => x.owner));
  const paid = ps.reduce((a, x) => a + x.price, 0), value = ps.reduce((a, x) => a + (x.value ?? 0), 0);
  const val = (x: DraftPick) => (metric === 'value' ? x.value : metric === 'paid' ? x.price : x.pts);
  const max = Math.max(1, ...ps.map((x) => Math.abs(val(x) ?? 0)), ...(metric === 'points' ? ps.map((x) => x.proj ?? 0) : []));
  const H_ = 8; // rem of bar area
  const runs: { o: OwnerKey | null; y: number; start: number; n: number }[] = [];
  years.forEach((y, i) => { const o = byYear.get(y)?.owner ?? null; const r = runs.at(-1); if (r && r.o === o) r.n++; else runs.push({ o, y, start: i, n: 1 }); });
  const legend = metric === 'value' ? 'Value: what his season was worth minus what was paid. Above the line is a bargain.' : metric === 'paid' ? 'Auction price paid. Keepers (K) show their keeper price.' : 'Season points. The gold tick is the projection where one exists: solid for ESPN preseason, dashed for Sleeper (pulled after the season).';
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        <Fact label="Drafted" value={`${ps.length}×`} sub={`${ps[0]!.year} to ${ps.at(-1)!.year}, by ${owners.size} owner${owners.size > 1 ? 's' : ''}`} pre={<PosTag pos={pos} />} />
        <Fact label="Kept" value={`${ps.filter((x) => x.keeper).length}×`} sub="as a keeper" />
        <Fact label="Total paid" value={`$${paid}`} sub={`avg ${pct(paid / ps.length / 200)} of a budget`} />
        <Fact label={<span className="inline-flex items-center gap-1.5">Total value <ValueHelp /></span>} value={<Value v={value} />} sub="hindsight, every season" />
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Seg label="Chart shows" value={metric} options={[['value', 'Value'], ['paid', 'Paid'], ['points', 'Points']]} onChange={setMetric} />
        <span className="text-xs text-ink-3">Tap a season for the details</span>
      </div>
      <div ref={chart} className="-mx-5 overflow-x-auto px-5">
        <div style={{ minWidth: `${Math.max(16, years.length * 5)}rem` }}>
          <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${years.length}, minmax(0, 1fr))` }}>
            {years.map((y) => {
              const x = byYear.get(y);
              if (!x) return <div key={y} className="grid opacity-60"><div className="relative" style={{ height: `${H_}rem` }}><span className="absolute inset-x-0 bottom-1 text-center text-xs text-ink-3">not drafted</span></div><span className="py-1 text-center font-mono text-xs text-ink-3">'{String(y).slice(2)}</span></div>;
              const v = val(x), on = x === sel;
              let bars: ReactNode;
              if (v === null) bars = <span className="absolute inset-x-0 bottom-1 text-center text-xs text-ink-3">–</span>;
              else if (metric === 'value') {
                const h = (Math.abs(v) / max) * (H_ / 2 - 1.1);
                bars = <><span className="absolute inset-x-0 top-1/2 border-t border-rule-strong" /><span className={`absolute inset-x-[22%] ${v >= 0 ? 'bg-gain' : 'bg-loss'}`} style={{ height: `${h}rem`, ...(v >= 0 ? { bottom: `${H_ / 2}rem` } : { top: `${H_ / 2}rem` }) }} /><span className={`absolute inset-x-0 text-center font-mono text-xs ${tone(v, 1.5)}`} style={v >= 0 ? { bottom: `${H_ / 2 + h}rem` } : { top: `${H_ / 2 + h}rem` }}>{signed(v, 0).replace(/^([+−])/, '$1$')}</span></>;
              } else {
                const h = (v / max) * (H_ - 1.25);
                const s = book.seasons.get(x.year);
                bars = <><span className={`absolute inset-x-[22%] bottom-0 ${on ? 'bg-ink' : 'bg-ink-3'}`} style={{ height: `${h}rem` }} />
                  {metric === 'points' && x.proj !== null && <span className={`absolute inset-x-[8%] border-t-2 border-accent-ink ${s?.proj === 'sleeper' ? 'border-dashed' : ''}`} style={{ bottom: `${(x.proj / max) * (H_ - 1.25)}rem` }} title={`Projected ${fmt(x.proj, 0)} (${projSource(s)})`} />}
                  <span className="absolute inset-x-0 text-center font-mono text-xs" style={{ bottom: `${h}rem` }}>{metric === 'paid' ? `$${v}` : fmt(v, 0)}</span></>;
              }
              return (
                <button key={y} type="button" aria-pressed={on} onClick={() => setSelYear(y)} className={`grid rounded-sm pt-1 transition-colors hover:bg-sunk ${on ? 'bg-sunk shadow-[inset_0_-2px_0_var(--ink)]' : ''}`}
                  aria-label={`${y}: drafted by ${crewName(H, x.owner, y)}, paid $${x.price}, ${x.pts === null ? 'points not recorded' : `${fmt(x.pts, 0)} points`}, value ${x.value === null ? 'not known' : signed(x.value, 0)}`}>
                  <span className="relative block" style={{ height: `${H_}rem` }}>{bars}</span>
                  <span className="py-1 text-center font-mono text-xs text-ink-2">'{String(y).slice(2)}{x.keeper && <span className="text-accent-ink"> K</span>}</span>
                </button>
              );
            })}
          </div>
          <div className="mt-0.5 grid gap-0.5" style={{ gridTemplateColumns: `repeat(${years.length}, minmax(0, 1fr))` }} aria-label="Drafted by">
            {runs.map((r) => <span key={r.start} className={`truncate border-t-2 px-1 py-1 text-center text-xs ${r.o ? 'border-ink' : 'border-rule'}`} style={{ gridColumn: `${r.start + 1} / span ${r.n}` }} title={r.o ? crewName(H, r.o, r.y) : ''}>{r.o ? shortCrew(H, r.o, r.y) : ''}</span>)}
          </div>
        </div>
      </div>
      <p className="max-w-[70ch] text-xs text-ink-3">{legend} The row under the years names who drafted him; a new name means he changed hands.</p>
      <SeasonDetail H={H} book={book} x={sel} ps={ps} onYear={setSelYear} />
    </div>
  );
}

function Fact({ label, value, sub, pre }: { label: ReactNode; value: ReactNode; sub?: ReactNode; pre?: ReactNode }) {
  return (
    <div className="grid content-start gap-1 border-t border-ink pt-2">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      <span className="flex items-center gap-2 font-display text-lg font-bold [font-stretch:85%]">{pre}{value}</span>
      {sub && <span className="text-sm text-ink-2">{sub}</span>}
    </div>
  );
}

function Row({ label, note, children }: { label: string; note?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-h-13 items-center justify-between gap-4 border-b border-rule py-1.5 text-sm">
      <dt className="text-ink-3">{label}{note && <span className="block text-xs">{note}</span>}</dt>
      <dd className="m-0 text-right font-mono text-base">{children}</dd>
    </div>
  );
}

function SeasonDetail({ H, book, x, ps, onYear }: { H: Hist; book: DraftBook; x: DraftPick; ps: DraftPick[]; onYear: (y: number) => void }) {
  const s = book.seasons.get(x.year);
  const season = H.byYear.get(x.year);
  const row = season?.rows.find((r) => r.owner === x.owner);
  const b = book.basis.get(x.year);
  const repl = b?.repl[x.pos];
  const over = x.pts === null || repl === undefined ? null : Math.max(0, Math.round(x.pts - repl));
  const rank = posRank(book, x);
  const i = ps.indexOf(x);
  const usage = x.held === null ? (s?.pts === 'to-date' ? 'Weekly use shows once the season has scores.' : 'Weekly lineups not recorded.')
    : !x.held.length ? 'Never in a league lineup that season (dropped or hurt early).'
    : x.held.map((h, k) => `${k ? 'then ' : ''}${crewName(H, h.owner, x.year)} from week ${h.from}: started ${h.started}${x.year >= 2018 ? `, benched ${h.benched}` : ''}${h.startPts ? ` (${fmt(h.startPts, 0)} pts as a starter)` : ''}`).join('; ') + '.';
  return (
    <section className="grid gap-3" aria-live="polite">
      <div className="flex items-baseline justify-between gap-3 border-b border-ink pb-1.5">
        <h3 className="flex items-center gap-2 text-lg">{x.year}{x.keeper && <KeeperTag />}</h3>
        <span className="flex gap-3 text-sm">
          {i > 0 && <button type="button" className="link" onClick={() => onYear(ps[i - 1]!.year)}>‹ {ps[i - 1]!.year}</button>}
          {i < ps.length - 1 && <button type="button" className="link" onClick={() => onYear(ps[i + 1]!.year)}>{ps[i + 1]!.year} ›</button>}
        </span>
      </div>
      <p className="max-w-[70ch] text-sm text-ink-2">
        Drafted by <span className="font-semibold text-ink">{crewName(H, x.owner, x.year)}</span>{row ? ` (${row.team})` : ''}{row?.finish ? `, who finished ${ordinal(row.finish)}` : season?.live ? ', season in progress' : ''}. {usage}
      </p>
      <dl className="m-0 grid gap-x-10 sm:grid-cols-2">
        <Row label="Paid" note={`${pct(x.share)} of the $${s?.budget ?? 200} budget${x.keeper ? ', keeper price' : ''}`}>${x.price}</Row>
        <Row label="Price reference" note={x.ref === null ? 'Not recorded this year' : s?.ref === 'est' ? "Export estimate, not a Sleeper number" : 'ESPN average auction value'}>{x.ref === null ? '–' : `$${Math.round(x.ref)}`}</Row>
        <Row label="Projected points" note={x.proj === null ? (x.year < 2018 ? 'ESPN projections start in 2018' : 'Not recorded for this player') : projSource(s)}>{x.proj === null ? '–' : fmt(x.proj, 0)}</Row>
        <Row label="Season points" note={[rank && `${x.pos}${rank} among drafted ${x.pos}s`, s?.pts === 'rostered' && 'weeks on a league roster only', s?.pts === 'to-date' && 'season to date'].filter(Boolean).join(', ')}>{x.pts === null ? '–' : fmt(x.pts, 0)}</Row>
        <Row label="Worth" note="what his season was worth at that draft's prices">{money(x.worth)}</Row>
        <Row label="Value" note="worth minus paid"><Value v={x.value} /></Row>
      </dl>
      {x.worth !== null && b && repl !== undefined && (
        <details className="border-t border-rule">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between text-sm">How this value was worked out <span className="text-xs text-ink-3">{x.year} draft</span></summary>
          <ol className="mb-3 grid max-w-[70ch] list-decimal gap-1 pl-5 text-sm text-ink-2">
            <li>Replacement level: the {ordinal(REPLACEMENT[x.pos] ?? 12)}-best drafted {x.pos} in {x.year} scored <span className="num">{fmt(repl, 0)}</span>.</li>
            <li>{x.name} scored <span className="num">{fmt(x.pts, 0)}</span>, so <span className="num">{over}</span> points over replacement{over === 0 ? ' (none, so he was worth the $1 minimum)' : ''}.</li>
            <li>That draft paid <span className="num">${b.dollarsPerPoint.toFixed(2)}</span> per point over replacement.</li>
            <li>Worth = $1 + {over} × ${b.dollarsPerPoint.toFixed(2)} = <span className="num font-semibold">${x.worth}</span>. Value = worth − paid = <Value v={x.value} />.</li>
          </ol>
        </details>
      )}
    </section>
  );
}

// ---------- Drafts search (All seasons tab) ----------
type Sort = 'best' | 'worst' | 'price' | 'points' | 'newest';
interface Filter { q: string; pos: string; owner: string; seasons: string; keepers: 'out' | 'in' | 'only'; sort: Sort }
const START: Filter = { q: '', pos: 'any', owner: '', seasons: 'all', keepers: 'out', sort: 'best' };
const QUICK: [string, string, Partial<Filter>][] = [
  ['best', 'Best bargains ever', { pos: 'any', owner: '', seasons: 'all', keepers: 'out', sort: 'best' }],
  ['worst', 'Biggest busts ever', { pos: 'any', owner: '', seasons: 'all', keepers: 'out', sort: 'worst' }],
  ['keepers', 'Keepers that paid off', { pos: 'any', owner: '', seasons: 'all', keepers: 'only', sort: 'best' }],
  ['priciest', 'Priciest picks', { pos: 'any', owner: '', seasons: 'all', keepers: 'out', sort: 'price' }],
];
const PAGE = 25;

export function DraftSearch({ H }: { H: Hist }) {
  const book = useDraftBook(H);
  const { settings } = useLeague();
  const [f, setF] = useState<Filter>(START);
  const [q, setQ] = useState('');
  const [player, setPlayer] = useState<number | null>(null);
  useEffect(() => { const t = setTimeout(() => setF((x) => ({ ...x, q })), 200); return () => clearTimeout(t); }, [q]);
  const rows = useMemo(() => {
    if (!book || typeof book === 'string') return [];
    const last = book.years.at(-1)!;
    const inSeasons = (y: number) => f.seasons === 'all' || (f.seasons === 'last5' ? y > last - 5 : f.seasons === '2018on' ? y >= 2018 : y === Number(f.seasons));
    const needle = f.q.trim().toLowerCase();
    // shortcut: filtering runs on the main thread; all 3,000 picks take well under a millisecond.
    // Revisit with a worker only if search grows to the weekly lineups (about 37,000 player-weeks).
    const out = book.picks.filter((x) => inSeasons(x.year) && (f.pos === 'any' || x.pos === f.pos) && (!f.owner || x.owner === f.owner)
      && (f.keepers === 'in' || (f.keepers === 'only' ? x.keeper : !x.keeper)) && (!needle || x.name.toLowerCase().includes(needle)));
    const by: Record<Sort, (a: DraftPick, b: DraftPick) => number> = {
      best: (a, b) => (b.value ?? -1e9) - (a.value ?? -1e9), worst: (a, b) => (a.value ?? 1e9) - (b.value ?? 1e9),
      price: (a, b) => b.share - a.share || b.year - a.year, points: (a, b) => (b.pts ?? -1) - (a.pts ?? -1), newest: (a, b) => b.year - a.year || b.price - a.price,
    };
    return out.sort(by[f.sort]);
  }, [book, f]);
  if (book === null) return <p className="text-sm text-ink-3" role="status">Loading the draft history…</p>;
  if (typeof book === 'string') return <Empty>{book}</Empty>;
  const mine = [...H.owners.values()].find((o) => o.teamId !== null && o.teamId === settings.myTeamId && !o.filler)?.key;
  const quick = [...QUICK, ...(mine ? [['mine', 'My drafts', { pos: 'any', owner: mine, seasons: 'all', keepers: 'in', sort: 'newest' }] as [string, string, Partial<Filter>]] : [])];
  const active = quick.find(([, , p]) => Object.entries(p).every(([k, v]) => f[k as keyof Filter] === v))?.[0];
  const owners = [...new Set(book.picks.map((x) => x.owner))].filter((o) => !H.owners.get(o)?.filler).sort((a, b) => ownerName(H, a).localeCompare(ownerName(H, b)));
  const players = new Set(rows.map((x) => x.player));
  const one = f.q && players.size === 1 ? rows[0] : undefined;
  const set = (p: Partial<Filter>) => setF((x) => ({ ...x, ...p }));
  const last = book.years.at(-1)!;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <label className="grid gap-1"><span className="text-sm font-semibold">Find a player</span>
        <input className="field" type="search" autoComplete="off" placeholder="Player name, e.g. Kelce" value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <div className="grid gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">Quick questions</span>
        <div className="flex flex-wrap gap-2">{quick.map(([k, l, p]) => <button key={k} type="button" className={`btn ${active === k ? 'btn-primary' : ''}`} aria-pressed={active === k} onClick={() => set(p)}>{l}</button>)}</div>
      </div>
      <Filters
        changed={JSON.stringify({ ...f, q: '' }) !== JSON.stringify({ ...START, q: '' })}
        onReset={() => setF((x) => ({ ...START, q: x.q }))}
        summary={<><span className="num font-semibold text-ink">{rows.length.toLocaleString()}</span> of {book.picks.length.toLocaleString()} picks · {players.size.toLocaleString()} player{players.size === 1 ? '' : 's'}</>}
        fields={[
          { id: 'pos', label: 'Position', value: f.pos, onChange: (v) => set({ pos: v }), options: [['any', 'All positions'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE'], ['K', 'K'], ['D/ST', 'D/ST']] },
          { id: 'owner', label: 'Drafted by', value: f.owner, onChange: (v) => set({ owner: v }), options: [['', 'Anyone'], ...owners.map((o) => [o, ownerName(H, o)] as [string, string])] },
          { id: 'seasons', label: 'Seasons', value: f.seasons, onChange: (v) => set({ seasons: v }), options: [['all', 'All seasons'], ['last5', 'Last 5 seasons'], ['2018on', '2018 on (full data)'], ...book.years.slice().reverse().map((y) => [String(y), y === last && book.seasons.get(y)?.pts === 'to-date' ? `${y} (so far)` : String(y)] as [string, string])] },
          { id: 'keepers', label: 'Keepers', value: f.keepers, onChange: (v) => set({ keepers: v as Filter['keepers'] }), options: [['out', 'Leave out'], ['in', 'Include'], ['only', 'Keepers only']] },
          { id: 'sort', label: 'Order', value: f.sort, onChange: (v) => set({ sort: v as Sort }), options: [['best', 'Best value'], ['worst', 'Worst value'], ['price', 'Priciest'], ['points', 'Most points'], ['newest', 'Newest']] },
        ]}
      />
      {!rows.length ? <Empty>No picks match{f.q ? ` “${f.q}”` : ''} with these settings.</Empty> : (
        <>
          <span className="flex items-center gap-2 justify-self-end text-sm text-ink-3">How is value worked out? <ValueHelp /></span>
          {one && <button type="button" className="btn btn-primary justify-self-start" onClick={() => setPlayer(one.player)}>Open {one.name}'s draft history ›</button>}
          <PickTable H={H} book={book} rows={rows} onPlayer={setPlayer} />
          <p className="max-w-[70ch] text-xs text-ink-3">Proj: ESPN preseason points (2018 on, few in 2023); ‡ Sleeper, pulled after the season. * Sleeper years: points while on a league roster. † This season: to date. – means not recorded. Tap a player for every season he was drafted.</p>
        </>
      )}
      <PlayerSheet H={H} book={book} player={player} onClose={() => setPlayer(null)} />
    </div>
  );
}

// ---------- one season: each team's draft ----------
export function SeasonDraft({ H, s }: { H: Hist; s: Season }) {
  const book = useDraftBook(H);
  const { settings } = useLeague();
  const mine = settings.myTeamId == null ? undefined : s.rows.find((r) => H.owners.get(r.owner)?.teamId === settings.myTeamId)?.owner;
  const [owner, setOwner] = useState<OwnerKey>(mine ?? (s.live ? s.rows[0]!.owner : s.podium[0] ?? s.rows[0]!.owner));
  const [player, setPlayer] = useState<number | null>(null);
  if (book === null) return <p className="text-sm text-ink-3" role="status">Loading the {s.year} draft…</p>;
  if (typeof book === 'string') return <Empty>{book}</Empty>;
  const ds = book.seasons.get(s.year);
  const all = book.byYear.get(s.year) ?? [];
  if (!ds || !all.length) return <Empty>No draft recorded for {s.year}.</Empty>;
  const row = s.rows.find((r) => r.owner === owner)!;
  const ps = all.filter((x) => x.owner === owner).sort((a, b) => b.price - a.price);
  const open = ps.filter((x) => x.value !== null && !x.keeper);
  const best = [...open].sort((a, b) => b.value! - a.value!)[0], worst = [...open].sort((a, b) => a.value! - b.value!)[0];
  const spent = ps.reduce((a, x) => a + x.price, 0), total = ps.reduce((a, x) => a + (x.value ?? 0), 0);
  const hasProj = ps.some((x) => x.proj !== null);
  const starts = (x: DraftPick) => {
    if (!x.held) return <span className="text-ink-3">–</span>;
    const me = x.held.find((h) => h.owner === owner);
    const next = x.held.find((h) => h.owner !== owner && h.from > (me?.from ?? 0));
    return <>{me?.started ?? 0}{next ? <span className="block text-xs text-ink-3">→ {shortCrew(H, next.owner, s.year)} wk {next.from}</span> : !me ? <span className="block text-xs text-ink-3">never in a lineup</span> : null}</>;
  };
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
        <label className="grid gap-1 text-sm text-ink-3">Team
          <select className="field w-full text-ink sm:w-auto sm:min-w-64" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {s.rows.map((r, i) => <option key={r.owner} value={r.owner}>{s.live ? i + 1 : r.finish}. {crewName(H, r.owner, s.year)} · {r.team}</option>)}
          </select>
        </label>
        <span className="flex items-center gap-2 pb-2.5 text-sm text-ink-3">How is value worked out? <ValueHelp /></span>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-4">
        <Fact label="Finish" value={s.live ? 'In progress' : ordinal(row.finish ?? 0)} sub={`${row.w}-${row.l}${row.t ? `-${row.t}` : ''} · luck ${signed(row.luck, 1)}`} />
        <Fact label="Draft" value={`$${spent}`} sub={`${ps.length} players · ${ps.filter((x) => x.keeper).length} keepers`} />
        <Fact label="Draft value" value={<Value v={total} />} sub={ds.pts === 'to-date' ? 'season to date' : 'hindsight'} />
        <Fact label="Best · worst buy" value={<span className="text-base">{best ? <>{best.name} <Value v={best.value} /></> : '–'}</span>} sub={worst ? <>{worst.name} <Value v={worst.value} /></> : undefined} />
      </div>
      {ds.notes.map((n) => <p key={n} className="max-w-[70ch] border-l-[3px] border-accent py-1 pl-3 text-sm text-ink-2"><span className="font-semibold">Partial data for {s.year}.</span> {n}</p>)}
      <div className="-mx-4 overflow-x-auto md:mx-0">
        <table className="tbl md:min-w-[42rem]">
          <caption className="sr-only">{crewName(H, owner, s.year)} {s.year} draft</caption>
          <thead><tr><th className="l stick">Player</th><th>Paid</th><th className="hidden md:table-cell" title={refTitle(ds)}>{refLabel(ds)}</th>{hasProj && <th className="hidden md:table-cell" title={projSource(ds)}>Proj</th>}<th>Pts</th><th title="Worth minus price paid">Value</th><th title="Weeks this team started him; an arrow shows where he went">Starts</th></tr></thead>
          <tbody>
            {ps.map((x) => (
              <tr key={x.i}>
                <td className="l stick"><span className="flex items-center gap-2"><PosTag pos={x.pos} /><button type="button" className="link max-w-32 truncate sm:max-w-48" onClick={() => setPlayer(x.player)}>{x.name}</button>{x.keeper && <KeeperTag />}</span></td>
                <td className="n font-semibold">${x.price}</td>
                <td className="n hidden text-ink-3 md:table-cell">{x.ref === null ? '–' : `$${Math.round(x.ref)}`}</td>
                {hasProj && <td className="n hidden text-ink-3 md:table-cell">{x.proj === null ? '–' : fmt(x.proj, 0)}</td>}
                <td className="n">{x.pts === null ? <span className="text-ink-3">–</span> : <>{fmt(x.pts, 0)}<span className="text-ink-3">{ptsMark(ds)}</span></>}</td>
                <td className="n"><Value v={x.value} /></td>
                <td className="n">{starts(x)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="max-w-[70ch] text-xs text-ink-3">Drafted roster only; in-season pickups are in the week-by-week box scores. {hasProj ? `Proj: ${projSource(ds)}.` : `No projections recorded for ${s.year}.`} {ds.pts === 'rostered' ? '* Points while on a league roster.' : ds.pts === 'to-date' ? '† Season to date.' : ''} Tap a player for every season he was drafted.</p>
      <PlayerSheet H={H} book={book} player={player} year={s.year} onClose={() => setPlayer(null)} />
    </div>
  );
}
