import { useMemo } from 'react';
import { POSITIONS, type TeamId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { standings, teamName } from '../engine/league.ts';
import { lineup } from '../engine/model.ts';
import { useRoute } from '../app/router.ts';
import { fmt, Mono, pct, PlayerName, Section, TeamSelect } from '../ui/components.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

export default function Teams() {
  const { idx, values: V, base, sim, settings } = useLeague();
  const { query, replace } = useRoute();
  const open = usePlayerSheet();
  const asked = Number(query.get('team'));
  const team: TeamId = idx.teams.has(asked) ? asked : settings.myTeamId ?? idx.teamIds[0]!;
  const rec = useMemo(() => standings(idx).find((r) => r.teamId === team), [idx, team]);
  const roster = idx.roster.get(team) ?? [];
  const lu = lineup(base, roster.filter((p) => !base.isOut(p)), () => 1);
  const starters = new Set(lu.slots.map((s) => s.pid));
  const role = (p: string) => (idx.irSlot.has(p) ? 'IR slot' : starters.has(p) ? 'Starter' : 'Bench');

  return (
    <div className="grid grid-cols-1 gap-8">
      <div className="grid gap-4 md:grid-cols-[minmax(0,18rem)_minmax(0,1fr)] md:items-end [&>*]:min-w-0">
        <TeamSelect label="Team" value={team} onChange={(t) => t !== null && replace('teams', `team=${t}`)} />
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
      </div>
      <Section title={`${teamName(idx, team)}'s roster`} aside={<span className="flex items-center gap-2"><Mono team={team} size="sm" />{roster.length} players</span>}>
        <div className="grid gap-8 md:grid-cols-2">
          {POSITIONS.map((pos) => {
            const ps = roster.filter((p) => idx.players.get(p)?.pos === pos).sort((a, b) => V.bv(b) - V.bv(a));
            if (!ps.length) return null;
            return (
              <div key={pos} className="min-w-0 overflow-x-auto">
                <h3 className="num mb-1 text-sm text-ink-3">{pos}</h3>
                <table className="tbl">
                  <thead><tr><th className="l">Player</th><th className="l">Role</th><th>Pts/wk</th><th className="hidden sm:table-cell">Avg</th><th>Value</th></tr></thead>
                  <tbody>
                    {ps.map((p) => (
                      <tr key={p}>
                        <td className="l whitespace-normal"><PlayerName pid={p} onOpen={open} /></td>
                        <td className={`l text-xs ${role(p) === 'Starter' ? 'font-semibold' : 'text-ink-3'}`}>{role(p)}</td>
                        <td className="n">{fmt(base.proj.get(p))}</td>
                        <td className="n hidden text-ink-2 sm:table-cell">{fmt(idx.stats.get(p)?.seasonAvg)}</td>
                        <td className="n font-semibold">{fmt(V.bv(p))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>
      </Section>
    </div>
  );
}
