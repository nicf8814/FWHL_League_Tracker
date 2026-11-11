import { useDeferredValue, useMemo, useState } from 'react';
import type { Player, Pos, TeamId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { chartAvgAt, chartHistory, teamName } from '../engine/league.ts';
import { fmt, PlayerName, POS_OPTIONS, Seg, signed } from '../ui/components.tsx';
import { SortHeader, TableTools, useTable, type Col } from '../ui/table.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

const PAGE = 100;

export default function Players() {
  const { idx, values: V, base, settings } = useLeague();
  const open = usePlayerSheet();
  const [pos, setPos] = useState<Pos | 'ANY'>('ANY');
  const [q, setQ] = useState('');
  const [who, setWho] = useState<'all' | 'rostered' | 'fa' | `${TeamId}`>('all');
  const [limit, setLimit] = useState(PAGE);
  const term = useDeferredValue(q.trim().toLowerCase());
  // FEAT-14: compare chart values with an earlier week.
  const hist = useMemo(() => chartHistory(idx.ds), [idx]);
  const chartWeeks = useMemo(() => [...new Set([...hist.peaked.keys(), ...hist.menton.keys()])].sort((a, b) => a - b), [hist]);
  const latest = chartWeeks[chartWeeks.length - 1] ?? 0;
  const [since, setSince] = useState<number>(() => chartWeeks[chartWeeks.length - 2] ?? latest);

  const rows = useMemo(() => {
    return [...idx.players.values()]
      .filter((p) => V.blend(p.id).sources > 0 || base.proj.get(p.id))
      .filter((p) => pos === 'ANY' || p.pos === pos)
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.aliases.some((a) => a.includes(term.replace(/[^a-z]/g, ''))))
      .filter((p) => {
        const o = idx.owner.get(p.id);
        return who === 'all' ? true : who === 'rostered' ? o !== undefined : who === 'fa' ? o === undefined : o === Number(who);
      });
  }, [idx, V, base, pos, term, who]);

  const cols = useMemo<Col<Player>[]>(() => {
    const owner = (p: Player) => idx.owner.get(p.id);
    return [
      { id: 'name', label: 'Player', left: true, fixed: true, className: 'stick min-w-[11rem]', value: (p) => p.name, cell: (p) => <PlayerName pid={p.id} onOpen={open} /> },
      { id: 'pos', label: 'Pos', left: true, value: (p) => p.pos, cell: (p) => <span className="num text-ink-3">{p.pos}</span> },
      { id: 'owner', label: 'Owner', left: true, value: (p) => (owner(p) === undefined ? 'FA' : teamName(idx, owner(p))), cell: (p) => <span className="text-ink-2">{owner(p) === undefined ? 'FA' : teamName(idx, owner(p))}</span> },
      { id: 'nfl', label: 'NFL', left: true, hidden: true, value: (p) => p.nflTeam },
      { id: 'value', label: 'Value', value: (p) => V.blend(p.id).v, cell: (p) => <b className="font-semibold">{fmt(V.blend(p.id).v)}</b> },
      { id: 'market', label: 'Market', value: (p) => V.blend(p.id).market },
      { id: 'model', label: 'Model', value: (p) => V.blend(p.id).model },
      { id: 'proj', label: 'Pts/wk', value: (p) => base.proj.get(p.id) },
      { id: 'season', label: 'Total pts', value: (p) => idx.stats.get(p.id)?.seasonPoints },
      { id: 'repl', label: 'Above repl.', value: (p) => V.aboveReplacement(p.id), cell: (p) => signed(V.aboveReplacement(p.id)) },
      { id: 'peaked', label: 'Peaked', value: (p) => V.chart(p.id, 'peaked') },
      { id: 'menton', label: 'Menton', value: (p) => V.chart(p.id, 'menton') },
      { id: 'fpros', label: 'FPros', value: (p) => V.chart(p.id, 'fantasypros') },
      { id: 'keep', label: "Keep '27", value: (p) => { const k = idx.keeper.get(p.id); return k ? k.cost ?? 'No' : null; }, cell: (p) => { const k = idx.keeper.get(p.id); return k ? (k.cost === null ? 'No' : `$${k.cost}`) : '–'; } },
      { id: 'move', label: `Charts since Wk ${since}`, value: (p) => { const a = chartAvgAt(hist, p.id, latest), b = chartAvgAt(hist, p.id, since); return a === null || b === null ? null : a - b; }, cell: (p) => { const a = chartAvgAt(hist, p.id, latest), b = chartAvgAt(hist, p.id, since); if (a === null || b === null) return '–'; const d = a - b; return <span className={Math.abs(d) < 0.5 ? 'text-ink-3' : d > 0 ? 'text-gain' : 'text-loss'}>{signed(d)}</span>; } },
      { id: 'bye', label: 'Bye', hidden: true, value: (p) => p.bye },
      { id: 'avg', label: 'Avg', hidden: true, value: (p) => idx.stats.get(p.id)?.seasonAvg },
      { id: 'ros', label: 'ROS proj', hidden: true, value: (p) => idx.stats.get(p.id)?.projRestOfSeason },
      { id: 'rank', label: 'ESPN rank', left: true, hidden: true, value: (p) => idx.stats.get(p.id)?.posRank },
    ];
  }, [idx, V, base, open, hist, since, latest]);
  const t = useTable('players', cols, rows, { id: 'value', dir: -1 });

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Seg label="Position" value={pos} options={POS_OPTIONS} onChange={(v) => { setPos(v); setLimit(PAGE); }} />
        <label className="grid gap-1 text-sm text-ink-3">
          Owner
          <select className="field w-auto" value={who} onChange={(e) => { setWho(e.target.value as typeof who); setLimit(PAGE); }}>
            <option value="all">Everyone</option>
            <option value="rostered">Rostered</option>
            <option value="fa">Free agents</option>
            {idx.ds.teams.map((tm) => <option key={tm.id} value={tm.id}>{tm.name}{tm.id === settings.myTeamId ? ' (mine)' : ''}</option>)}
          </select>
        </label>
        <label className="grid min-w-[12rem] flex-1 gap-1 text-sm text-ink-3 sm:max-w-xs">
          Search
          <input className="field" type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Player name" />
        </label>
        <label className="grid gap-1 text-sm text-ink-3">
          Chart moves since
          <select className="field w-auto" value={since} onChange={(e) => setSince(Number(e.target.value))}>
            {chartWeeks.filter((w) => w < latest).map((w) => <option key={w} value={w}>Week {w}</option>)}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-3">
          <p className="num text-sm text-ink-3" role="status">{rows.length} players</p>
          <TableTools t={t} file={`fwhl-players-wk${idx.currentWeek}`} />
        </div>
      </div>
      <div className="-mx-4 overflow-x-auto md:mx-0">
        <table className="tbl min-w-[60rem]">
          <thead>
            <tr>
              <th className="l w-10">#</th>
              {t.visible.map((c) => <SortHeader key={c.id} t={t} c={c} />)}
            </tr>
          </thead>
          <tbody>
            {t.sorted.slice(0, limit).map((p, i) => {
              const mine = settings.myTeamId !== null && idx.owner.get(p.id) === settings.myTeamId;
              return (
                <tr key={p.id} className={mine ? 'bg-primary-soft' : ''}>
                  <td className="l n text-ink-3">{i + 1}</td>
                  {t.visible.map((c) => (
                    <td key={c.id} className={`${c.left ? 'l' : 'n'} ${c.id === 'name' ? `stick ${mine ? '!bg-primary-soft' : ''}` : ''} ${['peaked', 'menton', 'fpros'].includes(c.id) ? 'text-ink-2' : ''}`}>
                      {c.cell ? c.cell(p, i) : typeof c.value(p) === 'number' ? fmt(c.value(p) as number) : c.value(p) ?? '–'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button type="button" className="btn justify-self-start" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>}
    </div>
  );
}
