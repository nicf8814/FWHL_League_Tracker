import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { PlayerId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { chartAvgAt, chartHistory, teamName } from '../engine/league.ts';
import { useMemo } from 'react';
import { tradeToQuery } from '../engine/trade.ts';
import { href } from '../app/router.ts';
import { fmt, signed, Sheet, Status, TeamLabel } from '../ui/components.tsx';

const Ctx = createContext<(p: PlayerId) => void>(() => {});
export const usePlayerSheet = () => useContext(Ctx);

export function PlayerSheetProvider({ children }: { children: ReactNode }) {
  const [pid, setPid] = useState<PlayerId | null>(null);
  const open = useCallback((p: PlayerId) => setPid(p), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      <PlayerSheet pid={pid} onClose={() => setPid(null)} />
    </Ctx.Provider>
  );
}

function PlayerSheet({ pid, onClose }: { pid: PlayerId | null; onClose: () => void }) {
  const { idx } = useLeague();
  const p = pid ? idx.players.get(pid) : undefined;
  return (
    <Sheet open={!!p} onClose={onClose} title={p?.name ?? ''}>
      {p && pid && <Body pid={pid} onClose={onClose} />}
    </Sheet>
  );
}

function Body({ pid, onClose }: { pid: PlayerId; onClose: () => void }) {
    const { idx, values: V, base, settings } = useLeague();
    const p = idx.players.get(pid)!;
    const b = V.blend(pid);
    const s = idx.stats.get(pid);
    const owner = idx.owner.get(pid);
    const k = idx.keeper.get(pid);
    const inj = idx.injury.get(pid);
    const news = idx.news.get(pid);
    const weeks = [...idx.weeks.entries()].map(([w, m]) => [w, m.get(pid)] as const).filter(([, r]) => r).sort((a, b) => b[0] - a[0]);
    const mine = settings.myTeamId;
    const toAnalyzer =
      mine === null || owner === undefined ? null
      : owner === mine ? href('analyzer', tradeToQuery({ a: mine, b: idx.teamIds.find((t) => t !== mine)!, aGives: [pid], bGives: [] }))
      : href('analyzer', tradeToQuery({ a: mine, b: owner, aGives: [], bGives: [pid] }));
    const stat = (label: string, value: ReactNode) => (
      <div className="border-t border-rule pt-2">
        <dt className="text-xs text-ink-3">{label}</dt>
        <dd className="num text-lg">{value}</dd>
      </div>
    );
    return (
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
          <span className="num">{p.pos}</span>
          <span>{p.nflTeam ?? 'No NFL team'}{p.bye ? ` · bye Wk ${p.bye}` : ''}</span>
          <TeamLabel team={owner} />
          <Status pid={pid} />
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
          {stat('Trade value', fmt(b.v))}
          {stat('Pts/wk', fmt(base.proj.get(pid)))}
          {stat('Total pts', fmt(s?.seasonPoints))}
          {stat('Pos rank', s?.posRank ?? '–')}
        </dl>
        <ValueTrend pid={pid} />
        {inj && <p className="text-sm"><b>Status.</b> {inj.note || inj.status}{base.isOut(pid) && base.returnWeek(pid) < 18 ? `, back around Week ${base.returnWeek(pid)}` : base.returnWeek(pid) >= 18 ? ', out for the season' : ''}.</p>}
        {!inj && base.stale.has(pid) && <p className="text-sm"><b>Status.</b> Scored 0 with no projection in his last {base.stale.get(pid)} games, so he's treated as out until he plays again.</p>}
        {(() => { const h = V.handcuffOf(pid); if (!h) return null; const other = h.backup === pid ? h.starter : h.backup; const both = idx.owner.get(h.starter) !== undefined && idx.owner.get(h.starter) === idx.owner.get(h.backup);
          return <p className="text-sm"><b>Handcuff.</b> {h.backup === pid ? 'Backup to' : 'Backed up by'} {idx.players.get(other)?.name}. Worth about +{h.gain.toFixed(1)} pts/wk of insurance to a team holding both{both ? ` (${teamName(idx, idx.owner.get(pid))} does)` : ''}{V.settings.handcuff ? '' : '; turn on handcuff insurance in Data & settings to count it'}.</p>; })()}
        {news && <p className="text-sm"><b>News.</b> {news.note} (<span className="num">{signed(news.pct, 0)}%</span>).</p>}
        {k && <p className="text-sm text-ink-2"><b>Keeper 2027.</b> {k.cost === null ? "Can't be kept" : `$${k.cost}`}{k.note ? `. ${k.note}` : ''}.</p>}
        {weeks.length > 0 && (
          <div className="overflow-x-auto">
            <table className="tbl">
              <caption className="mb-2 text-left text-sm font-medium">By week</caption>
              <thead><tr><th className="l">Week</th><th className="l">Opp</th><th className="l">Team</th><th className="l">Slot</th><th>Pts</th><th>Proj</th></tr></thead>
              <tbody>
                {weeks.map(([w, r]) => (
                  <tr key={w}>
                    <td className="l n">{w}</td>
                    <td className="l">{r!.opponent ?? '–'}</td>
                    <td className="l">{r!.teamId === null ? 'FA' : teamName(idx, r!.teamId)}</td>
                    <td className="l">{w > idx.scoresThrough ? 'Projected' : { start: 'Started', bench: 'Bench', ir: 'IR', fa: 'Free agent' }[r!.slot]}</td>
                    <td className="n">{fmt(r!.points)}</td>
                    <td className="n">{fmt(r!.projection)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {toAnalyzer && <a className="btn btn-primary justify-self-start" href={toAnalyzer} onClick={onClose}>Open in analyzer</a>}
      </div>
    );
}

// Value trend: the player's trade-chart value (Peaked/Menton average) at each chart week.
function ValueTrend({ pid }: { pid: PlayerId }) {
  const { idx } = useLeague();
  const hist = useMemo(() => chartHistory(idx.ds), [idx]);
  const weeks = [...new Set([...hist.peaked.keys(), ...hist.menton.keys()])].sort((a, b) => a - b);
  const pts = weeks.map((w) => [w, chartAvgAt(hist, pid, w)] as const).filter((x): x is readonly [number, number] => x[1] !== null);
  if (pts.length < 2) return <p className="text-sm text-ink-3">Not on enough trade charts for a trend yet.</p>;
  const W = 280, H = 56, P = 4;
  const vals = pts.map((x) => x[1]);
  const hi = Math.max(...vals), span = Math.max(hi - Math.min(...vals), 20), lo = Math.min(...vals) - (span - (hi - Math.min(...vals))) / 2; // at least 20 points of height so small wiggles stay small
  const x = (i: number) => P + (i / (pts.length - 1)) * (W - 2 * P);
  const y = (v: number) => P + (1 - (v - lo) / span) * (H - 2 * P);
  const first = vals[0]!, last = vals[vals.length - 1]!, d = last - first;
  return (
    <figure className="grid gap-1">
      <figcaption className="flex items-baseline justify-between text-xs text-ink-3">
        <span>Trade chart value, Week {pts[0]![0]} to {pts[pts.length - 1]![0]}</span>
        <span className="num"><span className="text-ink">{fmt(first, 0)} → {fmt(last, 0)}</span> <span className={Math.abs(d) < 1 ? '' : d > 0 ? 'text-gain' : 'text-loss'}>({signed(d, 0)})</span></span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full" role="img" aria-label={`Chart value from ${fmt(first, 0)} in Week ${pts[0]![0]} to ${fmt(last, 0)} in Week ${pts[pts.length - 1]![0]}`} preserveAspectRatio="none">
        <polyline fill="none" stroke="var(--primary)" strokeWidth="2" vectorEffect="non-scaling-stroke" points={pts.map(([, v], i) => `${x(i)},${y(v)}`).join(' ')} />
      </svg>
    </figure>
  );
}
