import { useMemo, useState } from 'react';
import type { TeamId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { keeperCalls, keeperSet, type KeeperCall, type KeeperLabel } from '../engine/keepers.ts';
import { teamName } from '../engine/league.ts';
import { Empty, fmt, PlayerName, PosMark, Section, TeamSelect } from '../ui/components.tsx';
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
  const rows = roster.map((p) => calls.get(p)).filter((c): c is KeeperCall => !!c).sort((a, b) => (b.surplus ?? -999) - (a.surplus ?? -999));
  const bargains = useMemo(() => [...calls.values()].filter((c) => idx.owner.has(c.pid) && (c.label === 'legit' || c.label === 'border')).sort((a, b) => b.surplus! - a.surplus!).slice(0, 15), [calls, idx]);
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
        {rows.length ? <KeeperTable rows={rows} keep={new Set(set)} /> : <Empty>No keeper costs on this roster.</Empty>}
        <p className="text-xs text-ink-3">Worth is what this league has paid at auction (non-keepers, 2023-2026) for the player at his current points-per-week rank at his position. Keep = $10+ under; borderline = $0-10 under; pass = over, or he doesn't beat a replacement starter. A locked contract year has to be kept.</p>
      </Section>
      <Section title="Best keeper bargains in the league">
        {bargains.length ? <KeeperTable rows={bargains} keep={new Set()} showOwner /> : <Empty>No bargains right now.</Empty>}
      </Section>
    </div>
  );
}

function KeeperTable({ rows, keep, showOwner }: { rows: KeeperCall[]; keep: Set<string>; showOwner?: boolean }) {
  const { idx } = useLeague();
  const open = usePlayerSheet();
  return (
    <div className="-mx-4 overflow-x-auto md:mx-0">
      <table className="tbl min-w-[40rem]">
        <thead><tr><th className="l">Player</th>{showOwner && <th className="l">Owner</th>}<th>Surplus</th><th className="l">Call</th><th>Cost</th><th>Worth</th><th>Pts/wk</th><th>Rank</th><th className="l">Contract</th></tr></thead>
        <tbody>
          {rows.map((c) => {
            const pos = idx.players.get(c.pid)!.pos;
            return (
              <tr key={c.pid} className={keep.has(c.pid) ? 'bg-primary-soft' : ''}>
                <td className="l"><span className="flex items-center gap-2"><PosMark pos={pos} /><PlayerName pid={c.pid} onOpen={open} /></span></td>
                {showOwner && <td className="l text-ink-2">{teamName(idx, idx.owner.get(c.pid))}</td>}
                <td className={`n font-semibold ${c.surplus === null ? '' : c.surplus >= 0 ? 'text-gain' : 'text-loss'}`}>{money(c.surplus)}</td>
                <td className={`l font-medium ${LABEL[c.label][1]}`}>{LABEL[c.label][0]}</td>
                <td className="n">{money(c.cost)}</td>
                <td className="n">{money(c.worth)}</td>
                <td className="n">{fmt(c.ppw)}</td>
                <td className="n text-ink-2">{pos}{c.rank}</td>
                <td className="l min-w-[14rem] whitespace-normal text-xs text-ink-2">{c.note}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
