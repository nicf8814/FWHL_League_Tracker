import { useMemo } from 'react';
import type { PlayerId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { standings, teamName } from '../engine/league.ts';
import { lineup } from '../engine/model.ts';
import { useViewTeam } from '../app/viewTeam.ts';
import { fmt, Mono, pct, PlayerName, PosMark, Section } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

// A team's roster. Which team comes from the My Team dropdown in the header (?team=).
export default function Teams() {
  const { idx, values: V, base, sim } = useLeague();
  const { team } = useViewTeam();
  const open = usePlayerSheet();
  const rec = useMemo(() => standings(idx).find((r) => r.teamId === team), [idx, team]);
  const roster = idx.roster.get(team) ?? [];
  const lu = lineup(base, roster.filter((p) => !base.isOut(p)), () => 1);
  const starters = useMemo(() => new Set(lu.slots.map((s) => s.pid)), [lu]);
  const role = useMemo(() => (p: PlayerId) => (idx.irSlot.has(p) ? 'IR slot' : starters.has(p) ? 'Starter' : 'Bench'), [idx, starters]);

  const filters = useMemo<FilterDef<PlayerId>[]>(() => [
    { id: 'pos', label: 'Position', options: [['ANY', 'Any position'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], test: (p, v) => idx.players.get(p)?.pos === v },
    { id: 'role', label: 'Role', options: [['all', 'Whole roster'], ['Starter', 'Starters'], ['Bench', 'Bench'], ['IR slot', 'IR']], test: (p, v) => role(p) === v },
  ], [idx, role]);
  const search = useMemo(() => ({ placeholder: 'Player name', of: (p: PlayerId) => idx.players.get(p)?.name ?? '' }), [idx]);
  const cols = useMemo<Col<PlayerId>[]>(() => [
    { id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[11rem]', value: (p) => idx.players.get(p)?.name, cell: (p) => <span className="flex items-center gap-2"><PosMark pos={idx.players.get(p)!.pos} /><PlayerName pid={p} onOpen={open} /></span> },
    { id: 'role', label: 'Role', left: true, value: (p) => role(p), cell: (p) => <span className={`text-xs ${role(p) === 'Starter' ? 'font-semibold' : 'text-ink-3'}`}>{role(p)}</span> },
    { id: 'proj', label: 'Pts/wk', value: (p) => base.proj.get(p), cell: (p) => fmt(base.proj.get(p)) },
    { id: 'avg', label: 'Avg', className: 'text-ink-2', value: (p) => idx.stats.get(p)?.seasonAvg, cell: (p) => fmt(idx.stats.get(p)?.seasonAvg) },
    { id: 'season', label: 'Total pts', value: (p) => idx.stats.get(p)?.seasonPoints, cell: (p) => fmt(idx.stats.get(p)?.seasonPoints) },
    { id: 'value', label: 'Value', value: (p) => V.bv(p), cell: (p) => <b className="font-semibold">{fmt(V.bv(p))}</b> },
    { id: 'keep', label: "Keep '27", hidden: true, value: (p) => { const k = idx.keeper.get(p); return k ? k.cost ?? 'No' : null; }, cell: (p) => { const k = idx.keeper.get(p); return k ? (k.cost === null ? 'No' : `$${k.cost}`) : '–'; } },
    { id: 'bye', label: 'Bye', hidden: true, value: (p) => idx.players.get(p)?.bye },
  ], [idx, base, V, open, role]);
  const t = useTable('roster', cols, roster, { id: 'value', dir: -1 }, { filters, search });

  return (
    <div className="grid grid-cols-1 gap-8">
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        {[
          ['Record', rec ? `${rec.w}-${rec.l}${rec.t ? `-${rec.t}` : ''}` : '–'],
          ['Seed', rec ? `#${rec.seed}` : '–'],
          ['Playoff odds', sim ? pct(sim.odds[team]) : '…'],
          ['Lineup this week', fmt(lu.start)],
        ].map(([l, v]) => (
          <div key={l} className="border-t border-rule pt-1"><dt className="text-xs text-ink-3">{l}</dt><dd className="num text-lg">{v}</dd></div>
        ))}
      </dl>
      <Section title={`${teamName(idx, team)}'s roster`} aside={<span className="flex items-center gap-2"><Mono team={team} size="sm" />{roster.length} players</span>}>
        <TableBar t={t} noun="players" file={`fwhl-roster-${teamName(idx, team).replace(/\W+/g, '-').toLowerCase()}`} />
        <DataTable t={t} rowKey={(p) => p} minWidth="min-w-[36rem]" rowClass={(p) => (starters.has(p) ? 'bg-primary-soft' : '')} empty="No player matches these filters." />
      </Section>
    </div>
  );
}
