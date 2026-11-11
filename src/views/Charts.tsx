import { useMemo, useState } from 'react';
import type { PlayerId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { chartAccuracy, chartHistory, type ChartSource } from '../engine/league.ts';
import { Empty, fmt, Section } from '../ui/components.tsx';

// Chart history: a player's Peaked and Menton values week by week, and how well each week's chart
// ranked players by what they scored afterwards.
const SRC: Record<ChartSource, { label: string; color: string; dash?: string }> = {
  peaked: { label: 'Peaked', color: 'var(--primary)' },
  menton: { label: 'Menton', color: 'var(--accent-ink)', dash: '5 3' },
};

export default function Charts() {
  const { idx, values: V, settings } = useLeague();
  const hist = useMemo(() => chartHistory(idx.ds), [idx]);
  const acc = useMemo(() => chartAccuracy(idx), [idx]);
  const start = (settings.myTeamId !== null ? [...(idx.roster.get(settings.myTeamId) ?? [])].sort((a, b) => V.bv(b) - V.bv(a))[0] : undefined) ?? [...idx.owner.keys()][0]!;
  const [pid, setPid] = useState<PlayerId>(start);
  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();
  const hits = term.length < 2 ? [] : [...idx.players.values()].filter((p) => p.name.toLowerCase().includes(term) && (hist.peaked.size || hist.menton.size)).sort((a, b) => V.bv(b.id) - V.bv(a.id)).slice(0, 8);
  const weeks = [...new Set([...hist.peaked.keys(), ...hist.menton.keys()])].sort((a, b) => a - b);
  const series = (s: ChartSource) => weeks.map((w) => (hist[s].has(w) ? hist[s].get(w)!.get(pid) ?? 0 : null));
  const name = idx.players.get(pid)?.name ?? pid;
  const mean = (s: ChartSource) => { const a = acc.filter((x) => x.source === s); return a.length ? a.reduce((t, x) => t + x.rho, 0) / a.length : null; };

  return (
    <div className="grid grid-cols-1 gap-10">
      <Section title={`${name} on the trade charts`}>
        <div className="relative max-w-sm">
          <label className="grid gap-1 text-sm text-ink-3">
            Player
            <input className="field" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a player" autoComplete="off" />
          </label>
          {hits.length > 0 && (
            <ul className="absolute z-10 mt-1 grid w-full border border-rule-strong bg-surface" aria-label="Matching players">
              {hits.map((p) => <li key={p.id}><button type="button" className="rowbtn min-h-11 w-full border-b border-rule px-3 text-left text-sm last:border-b-0" onClick={() => { setPid(p.id); setQ(''); }}>{p.name} <span className="text-ink-3">· {p.pos}</span></button></li>)}
            </ul>
          )}
        </div>
        {weeks.length ? <Lines weeks={weeks} data={{ peaked: series('peaked'), menton: series('menton') }} label={name} /> : <Empty>No charts loaded yet.</Empty>}
        <div className="-mx-4 overflow-x-auto md:mx-0">
          <table className="tbl">
            <thead><tr><th className="l">Chart</th>{weeks.map((w) => <th key={w}>Wk {w}</th>)}</tr></thead>
            <tbody>
              {(['peaked', 'menton'] as const).map((s) => (
                <tr key={s}><td className="l">{SRC[s].label}</td>{series(s).map((v, i) => <td key={weeks[i]} className="n">{v === null ? '' : v === 0 ? '–' : fmt(v, 0)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-ink-3">Each chart is scaled so its top player is 100. A dash means he wasn't on that week's chart.</p>
      </Section>

      <Section title="How well the charts rank players" aside={`Through Week ${idx.scoresThrough}`}>
        <p className="max-w-[70ch] text-sm text-ink-2">For each week's chart: how closely its order matches points per game scored from then on (rank correlation; 1 is a perfect order, 0 is a coin flip). Average: Peaked {fmt(mean('peaked'), 2)}, Menton {fmt(mean('menton'), 2)}. Use it when setting the chart weights.</p>
        <div className="-mx-4 overflow-x-auto md:mx-0">
          <table className="tbl">
            <thead><tr><th className="l">Chart</th>{[...new Set(acc.map((a) => a.week))].sort((a, b) => a - b).map((w) => <th key={w}>Wk {w}</th>)}</tr></thead>
            <tbody>
              {(['peaked', 'menton'] as const).map((s) => (
                <tr key={s}><td className="l">{SRC[s].label}</td>{[...new Set(acc.map((a) => a.week))].sort((a, b) => a - b).map((w) => { const a = acc.find((x) => x.source === s && x.week === w); return <td key={w} className="n">{a ? fmt(a.rho, 2) : ''}</td>; })}</tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}

function Lines({ weeks, data, label }: { weeks: number[]; data: Record<ChartSource, (number | null)[]>; label: string }) {
  const W = 640, H = 220, L = 34, R = 12, T = 10, B = 26;
  const max = Math.max(20, ...Object.values(data).flat().map((v) => v ?? 0));
  const top = Math.ceil(max / 20) * 20;
  const x = (i: number) => L + (weeks.length < 2 ? (W - L - R) / 2 : (i / (weeks.length - 1)) * (W - L - R));
  const y = (v: number) => T + (1 - v / top) * (H - T - B);
  return (
    <figure className="grid gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full max-w-3xl" role="img" aria-label={`${label}'s chart value by week`}>
        {Array.from({ length: top / 20 + 1 }, (_, i) => i * 20).map((v) => (
          <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="var(--rule)" /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--ink-3)">{v}</text></g>
        ))}
        {weeks.map((w, i) => <text key={w} x={x(i)} y={H - 8} textAnchor="middle" fontSize="11" fill="var(--ink-3)">{w}</text>)}
        {(['peaked', 'menton'] as const).map((s) => {
          const pts = data[s].map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
          return (
            <g key={s}>
              <polyline fill="none" stroke={SRC[s].color} strokeWidth="2" strokeDasharray={SRC[s].dash} points={pts.join(' ')} />
              {data[s].map((v, i) => v === null ? null : <circle key={i} cx={x(i)} cy={y(v)} r="3" fill={SRC[s].color} />)}
            </g>
          );
        })}
      </svg>
      <figcaption className="flex gap-4 text-xs text-ink-2">
        {(['peaked', 'menton'] as const).map((s) => <span key={s} className="flex items-center gap-1.5"><svg width="22" height="6" aria-hidden="true"><line x1="0" x2="22" y1="3" y2="3" stroke={SRC[s].color} strokeWidth="2" strokeDasharray={SRC[s].dash} /></svg>{SRC[s].label}</span>)}
        <span className="text-ink-3">Week</span>
      </figcaption>
    </figure>
  );
}
