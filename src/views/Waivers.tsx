import { useMemo, useState } from 'react';
import type { Pos } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { fmt, PlayerName, POS_OPTIONS, PosMark, Section, Seg, signed, tone, Empty } from '../ui/components.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

// Waivers: free agents ranked by what they add to MY lineup per week, after cutting my lowest-valued
// player to make room (the same lineup math as the analyzer).
const POOL = 60; // free agents scored, by value, so the page stays fast

export default function Waivers() {
  const { idx, values: V, base, settings } = useLeague();
  const open = usePlayerSheet();
  const me = settings.myTeamId;
  const [pos, setPos] = useState<Pos | 'ANY'>('ANY');
  const rows = useMemo(() => {
    if (me === null) return [];
    const fas = [...idx.stats.keys()].filter((p) => !idx.owner.has(p) && idx.players.has(p)).sort((a, b) => V.bv(b) - V.bv(a)).slice(0, POOL);
    return fas.map((p) => ({ p, gain: V.weekGain(me, [], [p]), drop: V.autoDrops(me, [], [p])[0] ?? null })).sort((a, b) => b.gain - a.gain || V.bv(b.p) - V.bv(a.p));
  }, [idx, V, me]);
  if (me === null) return <Empty>Pick your team in Data & settings to rank free agents for your lineup.</Empty>;
  const shown = rows.filter((r) => pos === 'ANY' || idx.players.get(r.p)!.pos === pos);
  return (
    <Section title="Best pickups for your lineup" aside={`Top ${POOL} free agents by value`}>
      <p className="max-w-[70ch] text-sm text-ink-2">Pts/wk is how much your best lineup gains through the rest of the season and playoffs if you add him and cut the player shown. It counts byes and injury returns, so a stash can rank high with no points this week.</p>
      <Seg label="Position" value={pos} options={POS_OPTIONS} onChange={setPos} />
      <div className="-mx-4 overflow-x-auto md:mx-0">
        <table className="tbl min-w-[40rem]">
          <thead><tr><th className="l">Player</th><th>Pts/wk for you</th><th>Proj</th><th>Value</th><th>Rostered</th><th className="l">Cut</th></tr></thead>
          <tbody>
            {shown.map(({ p, gain, drop }) => {
              const w = idx.weeks.get(idx.currentWeek)?.get(p) ?? idx.weeks.get(idx.scoresThrough)?.get(p);
              return (
                <tr key={p}>
                  <td className="l"><span className="flex items-center gap-2"><PosMark pos={idx.players.get(p)!.pos} /><PlayerName pid={p} onOpen={open} /></span></td>
                  <td className={`n font-semibold ${tone(gain)}`}>{signed(gain)}</td>
                  <td className="n">{fmt(base.proj.get(p))}</td>
                  <td className="n">{fmt(V.bv(p), 0)}</td>
                  <td className="n text-ink-2">{w?.rosteredPct == null ? '–' : `${Math.round(w.rosteredPct)}%`}</td>
                  <td className="l text-ink-2">{drop ? idx.players.get(drop)?.name : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
