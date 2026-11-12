import { useMemo } from 'react';
import type { PlayerId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { fmt, PlayerName, PosMark, Section, signed, tone, Empty } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

// Waivers: free agents ranked by what they add to MY lineup per week, after cutting my lowest-valued
// player to make room (the same lineup math as the analyzer).
const POOL = 60; // free agents scored, by value, so the page stays fast
interface Row { p: PlayerId; gain: number; drop: PlayerId | null }

export default function Waivers() {
  const { idx, values: V, base, settings } = useLeague();
  const open = usePlayerSheet();
  const me = settings.myTeamId;
  const rows = useMemo<Row[]>(() => {
    if (me === null) return [];
    const fas = [...idx.stats.keys()].filter((p) => !idx.owner.has(p) && idx.players.has(p)).sort((a, b) => V.bv(b) - V.bv(a)).slice(0, POOL);
    return fas.map((p) => ({ p, gain: V.weekGain(me, [], [p]), drop: V.autoDrops(me, [], [p])[0] ?? null }));
  }, [idx, V, me]);

  const filters = useMemo<FilterDef<Row>[]>(() => [
    { id: 'pos', label: 'Position', options: [['ANY', 'Any position'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], test: (r, v) => idx.players.get(r.p)?.pos === v },
    { id: 'helps', label: 'Shows', options: [['all', 'All free agents'], ['gain', 'Only ones that help']], test: (r) => r.gain >= 0.1 },
  ], [idx]);
  const search = useMemo(() => ({ placeholder: 'Player name', of: (r: Row) => idx.players.get(r.p)?.name ?? '' }), [idx]);

  const cols = useMemo<Col<Row>[]>(() => [
    { id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[11rem]', value: (r) => idx.players.get(r.p)?.name, cell: (r) => <span className="flex items-center gap-2"><PosMark pos={idx.players.get(r.p)!.pos} /><PlayerName pid={r.p} onOpen={open} /></span> },
    { id: 'gain', label: 'Pts/wk for you', value: (r) => r.gain, cell: (r) => <b className={`font-semibold ${tone(r.gain)}`}>{signed(r.gain)}</b> },
    { id: 'proj', label: 'Proj', value: (r) => base.proj.get(r.p), cell: (r) => fmt(base.proj.get(r.p)) },
    { id: 'value', label: 'Value', value: (r) => V.bv(r.p), cell: (r) => fmt(V.bv(r.p), 0) },
    { id: 'rostered', label: 'Rostered', className: 'text-ink-2', value: (r) => { const w = idx.weeks.get(idx.currentWeek)?.get(r.p) ?? idx.weeks.get(idx.scoresThrough)?.get(r.p); return w?.rosteredPct ?? null; }, cell: (r) => { const w = idx.weeks.get(idx.currentWeek)?.get(r.p) ?? idx.weeks.get(idx.scoresThrough)?.get(r.p); return w?.rosteredPct == null ? '–' : `${Math.round(w.rosteredPct)}%`; } },
    { id: 'cut', label: 'Cut', left: true, className: 'text-ink-2', value: (r) => (r.drop ? idx.players.get(r.drop)?.name : null) },
  ], [idx, base, V, open]);

  const t = useTable('waivers', cols, rows, { id: 'gain', dir: -1 }, { filters, search });
  if (me === null) return <Empty>Pick your team in Data &amp; settings to rank free agents for your lineup.</Empty>;
  const best = t.sorted[0];
  return (
    <Section title="Best pickups for your lineup" aside={`Top ${POOL} free agents by value`}>
      <p className="headline-sm">{best && best.gain >= 0.1 ? `Add ${idx.players.get(best.p)?.name}, +${best.gain.toFixed(1)} a week` : 'Nobody beats your bench right now'}</p>
      <p className="max-w-[70ch] text-sm text-ink-2">Pts/wk is how much your best lineup gains through the rest of the season and playoffs if you add him and cut the player shown. It counts byes and injury returns, so a stash can rank high with no points this week.</p>
      <TableBar t={t} noun="free agents" file={`fwhl-waivers-wk${idx.currentWeek}`} />
      <DataTable t={t} rowKey={(r) => r.p} minWidth="min-w-[40rem]" empty="No free agent matches these filters." />
    </Section>
  );
}
