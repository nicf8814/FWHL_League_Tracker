import { useMemo, useState } from 'react';
import type { Player } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { chartAvgAt, chartHistory, teamName } from '../engine/league.ts';
import { fmt, PlayerName, PosMark, Seg, signed } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';
import { useFull } from '../ui/detail.ts';

const PAGE = 100;
// Ready-made column sets (Nov 11, item D). The column chooser still makes a custom one.
const PLAYER_VIEWS = {
  simple: ['name', 'pos', 'owner', 'season', 'proj', 'value'],
  charts: ['name', 'pos', 'owner', 'value', 'market', 'model', 'peaked', 'menton', 'fpros', 'move'],
  keepers: ['name', 'pos', 'owner', 'value', 'season', 'keep'],
};
const sameCols = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

export default function Players() {
  const { idx, values: V, base, settings } = useLeague();
  const open = usePlayerSheet();
  const [limit, setLimit] = useState(PAGE);
  const full = useFull();
  // FEAT-14: compare chart values with an earlier week.
  const hist = useMemo(() => chartHistory(idx.ds), [idx]);
  const chartWeeks = useMemo(() => [...new Set([...hist.peaked.keys(), ...hist.menton.keys()])].sort((a, b) => a - b), [hist]);
  const latest = chartWeeks[chartWeeks.length - 1] ?? 0;
  const [since, setSince] = useState<number>(() => chartWeeks[chartWeeks.length - 2] ?? latest);

  const rows = useMemo(
    () => [...idx.players.values()].filter((p) => V.blend(p.id).sources > 0 || base.proj.get(p.id)),
    [idx, V, base],
  );

  const filters = useMemo<FilterDef<Player>[]>(() => [
    { id: 'pos', label: 'Position', options: [['ANY', 'Any position'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], test: (p, v) => p.pos === v },
    {
      id: 'owner', label: 'Owner',
      options: [['all', 'Everyone'], ['rostered', 'Rostered'], ['fa', 'Free agents'], ...idx.ds.teams.map((t) => [String(t.id), `${t.name}${t.id === settings.myTeamId ? ' (mine)' : ''}`] as [string, string])],
      test: (p, v) => { const o = idx.owner.get(p.id); return v === 'rostered' ? o !== undefined : v === 'fa' ? o === undefined : o === Number(v); },
    },
  ], [idx, settings.myTeamId]);
  const search = useMemo(() => ({ placeholder: 'Player name', of: (p: Player) => `${p.name} ${p.aliases.join(' ')}` }), []);

  const cols = useMemo<Col<Player>[]>(() => {
    const owner = (p: Player) => idx.owner.get(p.id);
    const maxPts = Math.max(1, ...[...idx.stats.values()].map((x) => x.seasonPoints ?? 0));
    return [
      { id: 'name', label: 'Player', left: true, fixed: true, className: 'stick min-w-[9rem]', value: (p) => p.name, cell: (p) => <PlayerName pid={p.id} onOpen={open} /> },
      { id: 'pos', label: 'Pos', left: true, value: (p) => p.pos, cell: (p) => <PosMark pos={p.pos} /> },
      { id: 'owner', label: 'Owner', left: true, value: (p) => (owner(p) === undefined ? 'FA' : teamName(idx, owner(p))), cell: (p) => <span className="text-ink-2">{owner(p) === undefined ? 'FA' : teamName(idx, owner(p))}</span> },
      { id: 'season', label: 'Total pts', value: (p) => idx.stats.get(p.id)?.seasonPoints, cell: (p) => { const v = idx.stats.get(p.id)?.seasonPoints; return v == null ? '–' : <span className="inline-grid min-w-20 justify-items-end gap-1">{fmt(v)}<span className="meter w-full" aria-hidden="true"><span className="bg-primary" style={{ width: `${Math.max(2, (v / maxPts) * 100)}%` }} /></span></span>; } },
      { id: 'nfl', label: 'NFL', left: true, hidden: true, value: (p) => p.nflTeam },
      { id: 'value', label: 'Value', value: (p) => V.blend(p.id).v, cell: (p) => <b className="font-semibold">{fmt(V.blend(p.id).v)}</b> },
      { id: 'market', label: 'Market', value: (p) => V.blend(p.id).market },
      { id: 'model', label: 'Model', value: (p) => V.blend(p.id).model },
      { id: 'proj', label: 'Pts/wk', value: (p) => base.proj.get(p.id) },
      { id: 'repl', label: 'Above repl.', value: (p) => V.aboveReplacement(p.id), cell: (p) => signed(V.aboveReplacement(p.id)) },
      { id: 'peaked', label: 'Peaked', className: 'text-ink-2', value: (p) => V.chart(p.id, 'peaked') },
      { id: 'menton', label: 'Menton', className: 'text-ink-2', value: (p) => V.chart(p.id, 'menton') },
      { id: 'keep', label: "Keep '27", value: (p) => { const k = idx.keeper.get(p.id); return k ? k.cost ?? 'No' : null; }, cell: (p) => { const k = idx.keeper.get(p.id); return k ? (k.cost === null ? 'No' : `$${k.cost}`) : '–'; } },
      { id: 'move', label: `Charts since Wk ${since}`, value: (p) => { const a = chartAvgAt(hist, p.id, latest), b = chartAvgAt(hist, p.id, since); return a === null || b === null ? null : a - b; }, cell: (p) => { const a = chartAvgAt(hist, p.id, latest), b = chartAvgAt(hist, p.id, since); if (a === null || b === null) return '–'; const d = a - b; return <span className={Math.abs(d) < 0.5 ? 'text-ink-3' : d > 0 ? 'text-gain' : 'text-loss'}>{signed(d)}</span>; } },
      { id: 'bye', label: 'Bye', hidden: true, value: (p) => p.bye },
      { id: 'avg', label: 'Avg', hidden: true, value: (p) => idx.stats.get(p.id)?.seasonAvg },
      { id: 'ros', label: 'ROS proj', hidden: true, value: (p) => idx.stats.get(p.id)?.projRestOfSeason },
      { id: 'rank', label: 'ESPN rank', left: true, hidden: true, value: (p) => idx.stats.get(p.id)?.posRank },
    ];
  }, [idx, V, base, open, hist, since, latest]);
  const t = useTable('players', cols, rows, { id: 'value', dir: -1 }, { filters, search, shown: PLAYER_VIEWS.simple });
  const view = (Object.keys(PLAYER_VIEWS) as (keyof typeof PLAYER_VIEWS)[]).find((v) => sameCols(PLAYER_VIEWS[v], cols.filter((c) => !t.hidden.includes(c.id)).map((c) => c.id))) ?? 'custom';

  return (
    <div className="grid grid-cols-1 gap-4">
      <Seg label="Columns" value={view} options={[['simple', 'Simple'], ['charts', 'Charts'], ['keepers', 'Keepers'], ...(view === 'custom' ? [['custom', 'Custom'] as const] : [])] as const} onChange={(v) => v !== 'custom' && t.setHidden(cols.filter((c) => !PLAYER_VIEWS[v].includes(c.id)).map((c) => c.id))} />
      <TableBar t={t} noun="players" file={full ? `fwhl-players-wk${idx.currentWeek}` : undefined}>
        {view === 'charts' && (
          <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase tracking-wider text-ink-3">
            Chart moves since
            <select className="field min-w-0 text-sm font-medium normal-case tracking-normal text-ink" value={since} onChange={(e) => setSince(Number(e.target.value))}>
              {chartWeeks.filter((w) => w < latest).map((w) => <option key={w} value={w}>Week {w}</option>)}
            </select>
          </label>
        )}
      </TableBar>
      <DataTable
        t={t}
        rowKey={(p) => p.id}
        stickyId="name"
        limit={limit}
        minWidth={view === 'simple' ? undefined : 'min-w-[60rem]'}
        rowClass={(p) => (settings.myTeamId !== null && idx.owner.get(p.id) === settings.myTeamId ? 'bg-primary-soft' : '')}
        empty="No player matches these filters."
      />
      {t.sorted.length > limit && <button type="button" className="btn justify-self-start" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, t.sorted.length - limit)} more</button>}
    </div>
  );
}
