import { useMemo, useState } from 'react';
import type { TeamId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { keeperCalls, keeperSet, type KeeperCall, type KeeperLabel } from '../engine/keepers.ts';
import { teamName } from '../engine/league.ts';
import { Empty, fmt, PlayerName, PosMark, Section, TeamSelect } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

// 2027 keepers: what a player's points-per-week rank at his position has gone for in this league's
// auctions, against his keeper cost (engine/keepers.ts).
const money = (n: number | null) => (n === null ? '–' : `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(0)}`);
const LABEL: Record<KeeperLabel, [string, string]> = {
  lock: ['Locked', 'text-primary'], legit: ['Keep', 'text-gain'], border: ['Borderline', 'text-even'], no: ['Pass', 'text-ink-3'], none: ["Can't keep", 'text-ink-3'],
};

export default function Keepers() {
  const { idx, settings, base } = useLeague();
  const [team, setTeam] = useState<TeamId>(settings.myTeamId ?? idx.teamIds[0]!);
  const calls = useMemo(() => keeperCalls(base), [base]);
  const slots = idx.ds.season.keeper.slots;
  const roster = idx.roster.get(team) ?? [];
  const set = keeperSet(calls, roster, slots);
  const rows = useMemo(() => roster.map((p) => calls.get(p)).filter((c): c is KeeperCall => !!c), [roster, calls]);
  const bargains = useMemo(() => [...calls.values()].filter((c) => idx.owner.has(c.pid) && (c.label === 'legit' || c.label === 'border')), [calls, idx]);
  return (
    <div className="grid grid-cols-1 gap-10">
      <Section title="2027 keepers" aside={`${slots} keeper slots per team`}>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="w-full max-w-xs"><TeamSelect label="Team" value={team} onChange={(t) => t !== null && setTeam(t)} /></div>
          <div className="grid gap-1">
            <p className="headline-sm">{set.length ? `Keep ${set.map((p) => idx.players.get(p)?.name.split(' ').slice(-1)[0]).join(' and ')}` : 'Nobody worth a slot'}</p>
            {set.length > 0 && <p className="text-sm text-ink-2"><span className="num">{money(set.reduce((s, p) => s + (calls.get(p)?.surplus ?? 0), 0))}</span> under what they'd cost at auction</p>}
          </div>
        </div>
        {rows.length ? <KeeperTable tkey={`keepers-roster`} rows={rows} keep={new Set(set)} file={`fwhl-keepers-${teamName(idx, team).replace(/\W+/g, '-').toLowerCase()}`} /> : <Empty>No keeper costs on this roster.</Empty>}
        <p className="text-xs text-ink-3">Worth is what this league has paid at auction (non-keepers, 2023-2026) for the player at his current points-per-week rank at his position. Keep = $10+ under; borderline = $0-10 under; pass = over, or he doesn't beat a replacement starter. A locked contract year has to be kept.</p>
      </Section>
      <Section title="Best keeper bargains in the league">
        {bargains.length ? <KeeperTable tkey="keepers-bargains" rows={bargains} keep={new Set()} showOwner file="fwhl-keeper-bargains" /> : <Empty>No bargains right now.</Empty>}
      </Section>
    </div>
  );
}

function KeeperTable({ tkey, rows, keep, showOwner, file }: { tkey: string; rows: KeeperCall[]; keep: Set<string>; showOwner?: boolean; file: string }) {
  const { idx } = useLeague();
  const open = usePlayerSheet();
  const filters = useMemo<FilterDef<KeeperCall>[]>(() => [
    { id: 'pos', label: 'Position', options: [['ANY', 'Any position'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], test: (c, v) => idx.players.get(c.pid)?.pos === v },
    { id: 'call', label: 'Call', options: [['all', 'Every call'], ['lock', 'Locked'], ['legit', 'Keep'], ['border', 'Borderline'], ['no', 'Pass'], ['none', "Can't keep"]], test: (c, v) => c.label === v },
    ...(showOwner ? [{ id: 'owner', label: 'Owner', options: [['all', 'Every team'] as [string, string], ...idx.ds.teams.map((t) => [String(t.id), t.name] as [string, string])], test: (c: KeeperCall, v: string) => idx.owner.get(c.pid) === Number(v) }] : []),
  ], [idx, showOwner]);
  const search = useMemo(() => ({ placeholder: 'Player name', of: (c: KeeperCall) => idx.players.get(c.pid)?.name ?? '' }), [idx]);
  const cols = useMemo<Col<KeeperCall>[]>(() => [
    { id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[11rem]', value: (c) => idx.players.get(c.pid)?.name, cell: (c) => <span className="flex items-center gap-2"><PosMark pos={idx.players.get(c.pid)!.pos} /><PlayerName pid={c.pid} onOpen={open} /></span> },
    ...(showOwner ? [{ id: 'owner', label: 'Owner', left: true, className: 'text-ink-2', value: (c: KeeperCall) => teamName(idx, idx.owner.get(c.pid)) }] : []),
    { id: 'surplus', label: 'Surplus', value: (c) => c.surplus, cell: (c) => <b className={`font-semibold ${c.surplus === null ? '' : c.surplus >= 0 ? 'text-gain' : 'text-loss'}`}>{money(c.surplus)}</b> },
    { id: 'call', label: 'Call', left: true, value: (c) => LABEL[c.label][0], cell: (c) => <span className={`font-medium ${LABEL[c.label][1]}`}>{LABEL[c.label][0]}</span> },
    { id: 'cost', label: 'Cost', value: (c) => c.cost, cell: (c) => money(c.cost) },
    { id: 'worth', label: 'Worth', value: (c) => c.worth, cell: (c) => money(c.worth) },
    { id: 'ppw', label: 'Pts/wk', value: (c) => c.ppw, cell: (c) => fmt(c.ppw) },
    { id: 'rank', label: 'Rank', className: 'text-ink-2', value: (c) => c.rank, cell: (c) => `${idx.players.get(c.pid)!.pos}${c.rank}` },
    { id: 'note', label: 'Contract', left: true, className: 'min-w-[14rem] whitespace-normal text-xs text-ink-2', value: (c) => c.note },
  ], [idx, open, showOwner]);
  const t = useTable(tkey, cols, rows, { id: 'surplus', dir: -1 }, { filters, search });
  return (
    <>
      <TableBar t={t} noun="players" file={file} />
      <DataTable t={t} rowKey={(c) => c.pid} minWidth="min-w-[40rem]" rowClass={(c) => (keep.has(c.pid) ? 'bg-primary-soft' : '')} empty="No keeper matches these filters." />
    </>
  );
}
