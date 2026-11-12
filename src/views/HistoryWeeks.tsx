// A past season's weeks, in layers: pick a week, see its scoreboard, open a game for the box score
// (starters side by side, bench folded away), tap a player for his season. Loads the season's
// lineups file only when this view opens.
import { useEffect, useState, type ReactNode } from 'react';
import type { OwnerKey } from '../data/history.ts';
import { lineupsUrl, validateLineups, type Lineups, type Spot, type TeamWeek } from '../data/lineups.ts';
import { crewName, type Game, type Hist, type Season } from '../engine/history.ts';
import { benchBeats, benchTotal, EMPTY, playerLog, startersTotal } from '../engine/lineups.ts';
import { Empty, fmt, Sheet } from '../ui/components.tsx';

const cache = new Map<number, Promise<Lineups | string>>();
function load(year: number): Promise<Lineups | string> {
  if (!cache.has(year))
    cache.set(year, fetch(lineupsUrl(import.meta.env.BASE_URL, year), { cache: 'no-cache' })
      .then((r) => (r.status === 404 ? `No lineups were exported for ${year}.` : r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then((raw) => { if (typeof raw === 'string') return raw; const v = validateLineups(raw, year); return v.ok ? v.value : `The ${year} lineups file is invalid: ${v.errors[0]}`; })
      .catch((e) => { cache.delete(year); return `Could not load the ${year} lineups (${e instanceof Error ? e.message : e}).`; }));
  return cache.get(year)!;
}

function useLineups(year: number) {
  const [L, setL] = useState<Lineups | string | null>(null);
  useEffect(() => { let live = true; load(year).then((v) => live && setL(v)); return () => { live = false; }; }, [year]);
  return L;
}

export interface WeekState { week: number | null; open: OwnerKey | null }

export default function SeasonWeeks({ H, s, state, onState, onOwner }: { H: Hist; s: Season; state: WeekState; onState: (w: WeekState) => void; onOwner: (o: OwnerKey) => void }) {
  const L = useLineups(s.year);
  const [player, setPlayer] = useState<number | null>(null);
  if (L === null) return <p className="text-sm text-ink-3" role="status">Loading {s.year} lineups…</p>;
  if (typeof L === 'string') return <Empty>{L}</Empty>;
  const weeks = [...new Set([...Object.keys(L.weeks).map(Number), ...s.games.map((g) => g.week)])].sort((a, b) => a - b);
  const week = state.week !== null && weeks.includes(state.week) ? state.week : weeks[0]!;
  const games = s.games.filter((g) => g.week === week).sort((a, b) => rank(a) - rank(b));
  const playing = new Set(games.flatMap((g) => [g.home, g.away]));
  const idle = Object.keys(L.weeks[week] ?? {}).filter((o) => !playing.has(o));
  const name = (o: OwnerKey) => crewName(H, o, s.year);
  const team = (o: OwnerKey) => s.rows.find((r) => r.owner === o)?.team;
  const set = (p: Partial<WeekState>) => onState({ week, open: state.open, ...p });
  const box = (a: OwnerKey, b?: OwnerKey, g?: Game) => <BoxScore L={L} week={week} a={a} b={b} g={g} names={name} onPlayer={setPlayer} />;
  return (
    <div className="grid min-w-0 max-w-4xl grid-cols-[minmax(0,1fr)] gap-4">
      <WeekPicker s={s} weeks={weeks} week={week} onPick={(w) => set({ week: w, open: null })} />
      <div className="grid border-t border-ink">
        {games.map((g) => {
          const open = state.open === g.home || state.open === g.away;
          const [ha, aa] = [L.weeks[week]?.[g.home], L.weeks[week]?.[g.away]];
          return (
            <div key={`${g.home}-${g.away}`} className="border-b border-rule">
              <button type="button" aria-expanded={open} className="grid min-h-14 w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 py-2 text-left hover:bg-sunk sm:gap-3" onClick={() => set({ open: open ? null : g.home })}>
                <Side name={name(g.home)} team={team(g.home)} pts={g.hs} won={g.winner === g.home} />
                <span className="grid justify-items-center text-xs text-ink-3">
                  {g.kind !== 'regular' && <span className={g.kind === 'playoff' ? 'text-accent-ink' : ''}>{g.kind === 'playoff' ? 'Playoffs' : 'Consolation'}</span>}
                  <span aria-hidden="true">{open ? '▴' : '▾'}</span>
                </span>
                <Side name={name(g.away)} team={team(g.away)} pts={g.as} won={g.winner === g.away} right />
              </button>
              {open && (ha || aa ? box(g.home, g.away, g) : <p className="pb-4 text-sm text-ink-3">No lineups in the export for this game.</p>)}
            </div>
          );
        })}
        {!games.length && <p className="py-3 text-sm text-ink-3">No games recorded in Week {week}.</p>}
      </div>
      {idle.length > 0 && (
        <div className="grid gap-2">
          <p className="text-sm text-ink-3">No game this week (rosters only):</p>
          <div className="flex flex-wrap gap-2">
            {idle.map((o) => <button key={o} type="button" className="btn btn-quiet text-sm" aria-pressed={state.open === o} onClick={() => set({ open: state.open === o ? null : o })}>{name(o)}</button>)}
          </div>
          {state.open && idle.includes(state.open) && box(state.open)}
        </div>
      )}
      {L.final && <FinalRosters L={L} names={name} owners={s.rows.map((r) => r.owner)} onPlayer={setPlayer} />}
      {L.notes.map((n) => <p key={n} className="max-w-[70ch] text-xs text-ink-3">{n}</p>)}
      <PlayerSheet L={L} i={player} year={s.year} names={name} onClose={() => setPlayer(null)} onOwner={onOwner} />
    </div>
  );
}

const rank = (g: Game) => (g.kind === 'playoff' ? 0 : g.kind === 'regular' ? 1 : 2);

function WeekPicker({ s, weeks, week, onPick }: { s: Season; weeks: number[]; week: number; onPick: (w: number) => void }) {
  const group = (label: string, ws: number[]) => ws.length > 0 && (
    <div className="grid min-w-0 max-w-full grid-cols-[minmax(0,1fr)] gap-1">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      <div className="seg w-max max-w-full overflow-x-auto" role="group" aria-label={`${label} weeks`}>
        {ws.map((w) => <button key={w} type="button" aria-pressed={w === week} onClick={() => onPick(w)} className="min-w-10">{w}</button>)}
      </div>
    </div>
  );
  return (
    <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
      {group('Regular season', weeks.filter((w) => w <= s.regularWeeks))}
      {group('Playoffs', weeks.filter((w) => w > s.regularWeeks))}
    </div>
  );
}

function Side({ name, team, pts, won, right }: { name: string; team?: string; pts: number; won: boolean; right?: boolean }) {
  return (
    <span className={`grid min-w-0 gap-0.5 ${right ? 'text-right' : ''}`}>
      <span className={`flex min-w-0 items-baseline gap-2 ${right ? 'flex-row-reverse' : ''}`}>
        <span className={`num text-base ${won ? 'font-semibold' : 'text-ink-3'}`}>{fmt(pts, 2)}</span>
        <span className={`truncate text-sm ${won ? 'font-medium' : 'text-ink-2'}`}>{name}</span>
      </span>
      {team && <span className="truncate text-xs text-ink-3">{team}</span>}
    </span>
  );
}

// ---------- Box score ----------
function BoxScore({ L, week, a, b, g, names, onPlayer }: { L: Lineups; week: number; a: OwnerKey; b?: OwnerKey; g?: Game; names: (o: OwnerKey) => string; onPlayer: (i: number) => void }) {
  const ta = L.weeks[week]?.[a], tb = b ? L.weeks[week]?.[b] : undefined;
  const rows = Math.max(ta?.s.length ?? 0, tb?.s.length ?? 0);
  const proj = L.detail === 'full';
  const P = (x: Spot | undefined, right = false, vs?: Spot) => {
    if (!x) return <><span /><span /></>;
    const better = vs && x[2] !== null && vs[2] !== null && x[2] > vs[2];
    const pts = <span className={`num ${right ? 'text-left' : 'text-right'}`}><span className={better ? 'font-semibold' : ''}>{fmt(x[2], 2)}</span>{proj && x[3] !== null && <span className="block text-xs text-ink-3">{fmt(x[3], 1)}</span>}</span>;
    const who = <PlayerCell L={L} x={x} right={right} onPlayer={onPlayer} />;
    return right ? <>{pts}{who}</> : <>{who}{pts}</>;
  };
  const slot = (i: number) => { const x = ta?.s[i] ?? tb?.s[i]; return x?.[1] ?? (x && x[0] !== EMPTY ? L.players[x[0]]![1] : ''); };
  const official = (o: OwnerKey, t?: TeamWeek) => (g ? (o === g.home ? g.hs : g.as) : t?.pts ?? null);
  return (
    <div className="grid gap-3 pb-5">
      <div className={`grid min-w-0 items-center gap-x-2 text-sm sm:gap-x-3 ${b ? 'grid-cols-[minmax(0,1fr)_auto_2.75rem_auto_minmax(0,1fr)]' : 'grid-cols-[2.75rem_minmax(0,1fr)_auto]'}`}>
        <span className={`text-xs font-semibold uppercase tracking-wider text-ink-3 ${b ? '' : 'col-start-2'}`}>{names(a)}</span>
        {b ? <><span /><span className="text-center text-xs text-ink-3">{proj ? 'pts / proj' : 'pts'}</span><span /><span className="text-right text-xs font-semibold uppercase tracking-wider text-ink-3">{names(b)}</span></> : <span className="text-xs text-ink-3">{proj ? 'pts / proj' : 'pts'}</span>}
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="contents">
            {b ? <>{P(ta?.s[i], false, tb?.s[i])}<span className="border-y border-rule py-2 text-center text-xs text-ink-3">{slot(i)}</span>{P(tb?.s[i], true, ta?.s[i])}</>
              : <><span className="text-xs text-ink-3">{slot(i)}</span>{P(ta?.s[i])}</>}
          </div>
        ))}
        {b ? <>
          <Total t={ta} official={official(a, ta)} />
          <span className="text-center text-xs font-semibold text-ink-3">Total</span>
          <Total t={tb} official={b ? official(b, tb) : null} right />
        </> : <><span className="text-xs font-semibold text-ink-3">Total</span><Total t={ta} official={official(a, ta)} /></>}
      </div>
      {!ta && <p className="text-sm text-ink-3">No lineup in the export for {names(a)} this week.</p>}
      {b && !tb && <p className="text-sm text-ink-3">No lineup in the export for {names(b)} this week.</p>}
      <Bench L={L} a={ta} b={tb} names={[names(a), b ? names(b) : '']} onPlayer={onPlayer} />
    </div>
  );
}

function Total({ t, official, right }: { t?: TeamWeek; official: number | null; right?: boolean }) {
  const sum = t ? startersTotal(t) : null;
  const off = official !== null && sum !== null && Math.abs(official - sum) > 0.06;
  return (
    <span className={`col-span-2 grid border-t border-ink pt-1 ${right ? 'text-left' : 'text-right'}`}>
      <span className="num font-semibold">{fmt(official ?? sum, 2)}</span>
      {off && <span className="text-xs text-ink-3" title="The listed starters do not add up to the league's recorded score">starters add to {fmt(sum, 2)}</span>}
    </span>
  );
}

function PlayerCell({ L, x, right, onPlayer }: { L: Lineups; x: Spot; right?: boolean; onPlayer: (i: number) => void }) {
  if (x[0] === EMPTY) return <span className={`border-y border-rule py-2 text-sm italic text-loss ${right ? 'text-right' : ''}`}>Empty slot</span>;
  const [name, pos, nfl] = L.players[x[0]]!;
  return (
    <span className={`grid min-w-0 border-y border-rule py-1 ${right ? 'justify-items-end text-right' : ''}`}>
      <button type="button" className="link max-w-full truncate text-left no-underline hover:underline" onClick={() => onPlayer(x[0])}>{name}</button>
      <span className="text-xs text-ink-3">{pos}{nfl ? ` · ${nfl}` : ''}</span>
    </span>
  );
}

// The bench sits folded under the starters: the summary says what was left there.
function Bench({ L, a, b, names, onPlayer }: { L: Lineups; a?: TeamWeek; b?: TeamWeek; names: [string, string]; onPlayer: (i: number) => void }) {
  if (L.detail === 'starters') return <p className="text-xs text-ink-3">ESPN did not keep benches for {L.year}; only starters are known.</p>;
  const sides = [a, b].map((t, k) => t && { t, name: names[k]!, beat: benchBeats(L, t), total: benchTotal(t) }).filter(Boolean) as { t: TeamWeek; name: string; beat: Set<number>; total: number }[];
  if (!sides.length) return null;
  const left = sides.reduce((n, x) => n + x.beat.size, 0);
  return (
    <details className="group border-t border-rule">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-sm">
        <span>Bench <span className="text-ink-3">· {sides.map((x) => fmt(x.total, 1)).join(' / ')} pts</span></span>
        <span className="text-xs text-ink-3">{left ? `${left} bench player${left > 1 ? 's' : ''} outscored a starter` : 'no bench player outscored a starter'}</span>
      </summary>
      <div className={`grid gap-x-8 gap-y-4 pb-2 ${sides.length > 1 ? 'sm:grid-cols-2' : ''}`}>
        {sides.map(({ t, name, beat }) => (
          <div key={name} className="grid content-start">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">{name}</span>
            {!t.b.length && <span className="py-2 text-sm text-ink-3">Empty bench</span>}
            {t.b.map((x, i) => ({ x, i })).sort((p, q) => (q.x[2] ?? -99) - (p.x[2] ?? -99)).map(({ x, i }) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <PlayerCell L={L} x={x} onPlayer={onPlayer} />
                <span className="num text-right text-sm">
                  {beat.has(i) && <span className="mr-2 text-xs text-accent-ink" title="Outscored a starter at the same position">▲ beat a starter</span>}
                  {x[1] === 'IR' && <span className="mr-2 text-xs text-ink-3">IR</span>}
                  {fmt(x[2], 2)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
}

// ---------- End-of-season rosters (seasons with starters only) ----------
function FinalRosters({ L, names, owners, onPlayer }: { L: Lineups; names: (o: OwnerKey) => string; owners: OwnerKey[]; onPlayer: (i: number) => void }) {
  const [o, setO] = useState(owners[0]!);
  const list = L.final?.[o] ?? [];
  return (
    <details className="border-t border-ink">
      <summary className="flex min-h-11 cursor-pointer items-center justify-between text-sm font-medium">End-of-season rosters <span className="font-normal text-ink-3">season totals</span></summary>
      <div className="grid gap-3 pb-4">
        <label className="flex items-center gap-2 text-sm text-ink-3">Team
          <select className="field w-auto" value={o} onChange={(e) => setO(e.target.value)}>{owners.filter((x) => L.final?.[x]).map((x) => <option key={x} value={x}>{names(x)}</option>)}</select>
        </label>
        <div className="grid max-w-md">
          {list.map((x, i) => (
            <div key={i} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
              <PlayerCell L={L} x={x} onPlayer={onPlayer} />
              <span className="num text-sm">{fmt(x[2], 0)}</span>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}

// ---------- One player's season ----------
function PlayerSheet({ L, i, year, names, onClose, onOwner }: { L: Lineups; i: number | null; year: number; names: (o: OwnerKey) => string; onClose: () => void; onOwner: (o: OwnerKey) => void }) {
  const p = i !== null ? L.players[i] : undefined;
  const log = i !== null ? playerLog(L, i) : [];
  const started = log.filter((r) => r.role === 'start');
  const startPts = started.reduce((a, r) => a + (r.pts ?? 0), 0);
  const benchPts = log.filter((r) => r.role === 'bench').reduce((a, r) => a + (r.pts ?? 0), 0);
  const owners = [...new Set(log.map((r) => r.owner))];
  const cell = (c: ReactNode, cls = '') => <td className={`n ${cls}`}>{c}</td>;
  return (
    <Sheet open={i !== null} onClose={onClose} title={p ? `${p[0]} in ${year}` : ''}>
      {p && (
        <div className="grid gap-4">
          <p className="text-sm text-ink-2">
            {p[1]}{p[2] ? ` · ${p[2]}` : ''} · rostered by {owners.map((o, k) => <span key={o}>{k > 0 && ', '}<button type="button" className="link" onClick={() => { onClose(); onOwner(o); }}>{names(o)}</button></span>)}.
            {' '}Started {started.length} of {log.length} weeks for {fmt(startPts, 1)} pts{L.detail === 'full' ? `; ${fmt(benchPts, 1)} pts on the bench` : ''}.
          </p>
          <div className="-mx-5 overflow-x-auto">
            <table className="tbl">
              <thead><tr><th className="l">Wk</th><th className="l">Team</th><th className="l">Role</th><th>Pts</th>{L.detail === 'full' && <th>Proj</th>}</tr></thead>
              <tbody>
                {log.map((r) => (
                  <tr key={`${r.week}-${r.owner}`}>
                    <td className="l n">{r.week}</td>
                    <td className="l">{names(r.owner)}</td>
                    <td className="l text-sm">{r.role === 'start' ? (r.slot ?? 'Starter') : r.role === 'ir' ? <span className="text-ink-3">IR</span> : <span className="text-ink-3">Bench</span>}</td>
                    {cell(fmt(r.pts, 2), r.role === 'start' ? 'font-semibold' : 'text-ink-3')}
                    {L.detail === 'full' && cell(fmt(r.proj, 1), 'text-ink-3')}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {L.detail === 'starters' && <p className="text-xs text-ink-3">ESPN kept only starters for {year}, so weeks on a bench are not shown.</p>}
        </div>
      )}
    </Sheet>
  );
}
