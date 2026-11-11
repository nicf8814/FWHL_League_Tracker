import { useMemo, useState } from 'react';
import { useLeague, useSimHistory } from '../data/store.tsx';
import { bestActual, standings, teamName, type StandingRow } from '../engine/league.ts';
import { rank6 } from '../engine/sim.ts';
import { fmt, Mono, pct, Section } from '../ui/components.tsx';

type Key = 'seed' | 'pf' | 'pa' | 'maxPf' | 'odds';
const COLS: [Key, string][] = [['seed', 'Seed'], ['pf', 'PF'], ['pa', 'PA'], ['maxPf', 'Max PF'], ['odds', 'Playoffs']];

export default function Standings() {
  const { idx, sim, settings } = useLeague();
  const rows = useMemo(() => standings(idx), [idx]);
  const history = useSimHistory();
  const [sort, setSort] = useState<{ k: Key; dir: 1 | -1 }>({ k: 'seed', dir: 1 });
  const val = (r: StandingRow): number =>
    sort.k === 'seed' ? -r.seed : sort.k === 'odds' ? (sim?.odds[r.teamId] ?? 0) + r.pf / 1e7 : sort.k === 'maxPf' ? r.maxPf ?? -1 : r[sort.k];
  const sorted = [...rows].sort((a, b) => sort.dir * (val(b) - val(a)));
  const byRecord = idx.ds.season.seedsByRecord;
  const click = (k: Key) => setSort((s) => (s.k === k && k !== 'seed' ? { k, dir: s.dir === 1 ? -1 : 1 } : { k, dir: 1 }));
  const th = (k: Key, label: string, cls = '') => (
    <th className={cls} aria-sort={sort.k === k ? (sort.dir === 1 ? 'descending' : 'ascending') : 'none'}>
      <button type="button" className="link -my-3 py-3 no-underline" onClick={() => click(k)}>{label}{sort.k === k && k !== 'seed' ? (sort.dir === 1 ? ' ↓' : ' ↑') : ''}</button>
    </th>
  );

  return (
    <div className="grid grid-cols-1 gap-10">
      <Section title={`Through Week ${idx.scoresThrough}`} aside={sim ? `Playoff odds from ${idx.ds.season.sim.runs.toLocaleString()} simulated seasons` : 'Simulating the rest of the season…'}>
        <p className="max-w-[70ch] text-sm text-ink-2">
          Seeds 1 to {byRecord} go by record (ties broken head to head, then points for). Seed {byRecord + 1} is the most points for among everyone else.
          Weeks {idx.ds.season.top6Weeks.join(', ')} are not head to head: the top 6 scores get a win.
        </p>
        <div className="-mx-4 overflow-x-auto md:mx-0">
          <table className="tbl min-w-[46rem]">
            <thead>
              <tr>
                {th('seed', '#', 'l w-10')}
                <th className="l stick">Team</th>
                <th>W-L</th>
                {COLS.slice(1, 4).map(([k, l]) => th(k, l))}
                <th>Eff</th>
                {th('odds', 'Playoffs')}
                <th>Top {byRecord} by record</th>
                <th>Seed {byRecord + 1} by PF</th>
                <th className="l">Odds by week</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const cut = sort.k === 'seed' && r.seed === byRecord + 1;
                const mine = r.teamId === settings.myTeamId;
                return (
                  <tr key={r.teamId} className={`${mine ? 'bg-primary-soft' : ''} ${cut ? '[&>td]:border-b-ink' : ''}`}>
                    <td className="l n text-ink-3">{r.seed}</td>
                    <td className={`l stick ${mine ? '!bg-primary-soft' : ''}`}>
                      <span className="flex items-center gap-2 font-medium"><Mono team={r.teamId} size="sm" />{teamName(idx, r.teamId)}</span>
                    </td>
                    <td className="n">{r.w}-{r.l}{r.t ? `-${r.t}` : ''}</td>
                    <td className="n">{fmt(r.pf)}</td>
                    <td className="n">{fmt(r.pa)}</td>
                    <td className="n">{fmt(r.maxPf)}</td>
                    <td className="n">{r.efficiency === null ? '–' : `${Math.round(r.efficiency * 100)}%`}</td>
                    <td className="n font-semibold">{sim ? pct(sim.odds[r.teamId]) : '…'}</td>
                    <td className="n text-ink-2">{sim ? pct(sim.byRecord[r.teamId]) : '…'}</td>
                    <td className="n text-ink-2">{sim ? pct(sim.byPf[r.teamId]) : '…'}</td>
                    <td className="l"><Spark values={history ? Array.from({ length: idx.scoresThrough }, (_, i) => history[i + 1]?.[r.teamId] ?? null) : []} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Section>
      <Week />
    </div>
  );
}

function Spark({ values }: { values: (number | null)[] }) {
  const W = 88, H = 22;
  const pts = values.map((v, i) => (v === null ? null : `${(values.length < 2 ? W / 2 : (i / (values.length - 1)) * (W - 4) + 2).toFixed(1)},${(H - 2 - v * (H - 4)).toFixed(1)}`)).filter(Boolean);
  if (pts.length < 2) return <span className="text-xs text-ink-3">{values.length ? '' : '…'}</span>;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Playoff odds after each week">
      <line x1="0" x2={W} y1={H / 2} y2={H / 2} stroke="var(--rule)" strokeDasharray="2 2" />
      <polyline fill="none" stroke="var(--primary)" strokeWidth="1.5" points={pts.join(' ')} />
    </svg>
  );
}

function Week() {
  const { idx, settings } = useLeague();
  const weeks = [...new Set(idx.ds.games.map((g) => g.week))].sort((a, b) => a - b);
  const [week, setWeek] = useState(Math.max(1, Math.min(idx.scoresThrough || 1, weeks[weeks.length - 1] ?? 1)));
  const games = idx.ds.games.filter((g) => g.week === week);
  const top6 = idx.ds.season.top6Weeks.includes(week);
  const done = games.length > 0 && games.every((g) => g.status === 'final');
  const scores = games.flatMap((g) => [[g.homeId, g.homePts], [g.awayId, g.awayPts]] as const);
  const line = (team: number, sc: number | null, won: boolean | null) => {
    const best = done ? bestActual(idx, team, week) : null;
    return (
      <div className={`flex items-baseline justify-between gap-3 py-1.5 ${won === false ? 'text-ink-3' : ''}`}>
        <span className="flex items-center gap-2"><Mono team={team} size="sm" /><span className={team === settings.myTeamId ? 'font-semibold' : ''}>{teamName(idx, team)}</span></span>
        <span className="text-right">
          <span className={`num ${won ? 'font-semibold' : ''}`}>{fmt(sc)}</span>
          {best !== null && sc !== null && <span className="num block text-xs text-ink-3">{Math.max(best, sc) - sc < 0.05 ? 'perfect lineup' : `${fmt(Math.max(best, sc) - sc)} left on bench`}</span>}
        </span>
      </div>
    );
  };
  return (
    <Section title={`Week ${week}`} aside={top6 ? 'Top 6 scores win' : done ? 'Final' : 'Not played yet'}>
      <div className="seg w-max max-w-full overflow-x-auto" role="group" aria-label="Week">
        {weeks.map((w) => <button key={w} type="button" aria-pressed={w === week} onClick={() => setWeek(w)}>{w}</button>)}
      </div>
      {top6 && done ? (
        <ol className="grid max-w-xl">
          {[...scores].sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0)).map(([t, sc], i) => {
            const r = rank6(sc ?? 0, scores.filter((x) => x[0] !== t).map((x) => x[1] ?? 0));
            return (
              <li key={t} className={`flex items-center justify-between border-b ${i === 5 ? 'border-ink' : 'border-rule'} py-1.5`}>
                <span className="flex items-center gap-2"><span className="num w-5 text-ink-3">{i + 1}</span><Mono team={t} size="sm" />{teamName(idx, t)}</span>
                <span className="flex items-center gap-3"><span className="num">{fmt(sc)}</span><span className={`tag ${r === 'W' ? 'text-gain' : r === 'L' ? 'text-loss' : 'text-even'}`}>{r}</span></span>
              </li>
            );
          })}
        </ol>
      ) : (
        <ul className="grid gap-x-8 sm:grid-cols-2 xl:grid-cols-3">
          {games.map((g) => {
            const fin = g.status === 'final';
            const hw = fin ? (g.homePts ?? 0) > (g.awayPts ?? 0) : null;
            return (
              <li key={`${g.homeId}-${g.awayId}`} className="border-b border-rule py-1">
                {line(g.homeId, g.homePts, hw)}
                {line(g.awayId, g.awayPts, hw === null ? null : !hw)}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
