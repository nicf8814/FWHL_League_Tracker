import { useMemo, useState } from 'react';
import { useLeague, useSimHistory } from '../data/store.tsx';
import { bestActual, standings, teamName, type StandingRow } from '../engine/league.ts';
import { luck, type Luck } from '../engine/luck.ts';
import { rank6 } from '../engine/sim.ts';
import { fmt, Mono, pct, Section, signed, tone } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import { ThisWeek } from './ThisWeek.tsx';
import { useFull } from '../ui/detail.ts';

const SIMPLE = ['team', 'rec', 'pf', 'luck', 'odds'];

export default function Standings() {
  const { idx, sim, settings } = useLeague();
  const rows = useMemo(() => standings(idx), [idx]);
  const L = useMemo(() => luck(idx.teamIds, idx.games, idx.ds.season.top6Weeks), [idx]);
  const history = useSimHistory();
  const byRecord = idx.ds.season.seedsByRecord;
  const full = useFull();

  const filters = useMemo<FilterDef<StandingRow>[]>(() => [
    {
      id: 'picture', label: 'Playoff picture',
      options: [['all', 'Every team'], ['in', 'In (99%+)'], ['bubble', 'On the bubble'], ['out', 'Long shots']],
      test: (r, v) => { const o = sim?.odds[r.teamId] ?? 0; return v === 'in' ? o >= 0.99 : v === 'bubble' ? o < 0.99 && o >= 0.25 : o < 0.25; },
    },
    { id: 'record', label: 'Record', options: [['all', 'Any record'], ['win', 'Winning'], ['lose', 'Losing']], test: (r, v) => (v === 'win' ? r.w > r.l : r.l > r.w) },
  ], [sim]);
  const search = useMemo(() => ({ label: 'Find a team', placeholder: 'Team name', of: (r: StandingRow) => teamName(idx, r.teamId) }), [idx]);

  const cols = useMemo<Col<StandingRow>[]>(() => {
    const lk = (r: StandingRow) => L.get(r.teamId)!;
    return [
      { id: 'team', label: 'Team', left: true, fixed: true, className: 'min-w-[10rem]', value: (r) => teamName(idx, r.teamId), cell: (r) => <span className="flex items-center gap-2 font-medium"><Mono team={r.teamId} size="sm" />{teamName(idx, r.teamId)}</span> },
      { id: 'seed', label: 'Seed', value: (r) => r.seed, cell: (r) => `#${r.seed}` },
      { id: 'rec', label: 'W-L', value: (r) => r.w + r.t / 2 + r.pf / 1e7, cell: (r) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}` },
      { id: 'pf', label: 'PF', value: (r) => r.pf, cell: (r) => fmt(r.pf) },
      { id: 'pa', label: 'PA', value: (r) => r.pa, cell: (r) => fmt(r.pa) },
      { id: 'maxPf', label: 'Max PF', value: (r) => r.maxPf, cell: (r) => fmt(r.maxPf) },
      { id: 'eff', label: 'Eff', value: (r) => r.efficiency, cell: (r) => (r.efficiency === null ? '–' : `${Math.round(r.efficiency * 100)}%`) },
      { id: 'xw', label: 'xW', className: 'text-ink-2', value: (r) => lk(r).xw, cell: (r) => fmt(lk(r).xw) },
      { id: 'luck', label: 'Luck', value: (r) => lk(r).luck, cell: (r) => <span className={tone(lk(r).luck, 0.5)}>{signed(lk(r).luck)}</span> },
      { id: 'allplay', label: 'All-play', className: 'text-ink-2', value: (r) => lk(r).allPlay.w, cell: (r) => `${lk(r).allPlay.w}-${lk(r).allPlay.l}${lk(r).allPlay.t ? `-${lk(r).allPlay.t}` : ''}` },
      {
        id: 'odds', label: 'Playoffs', value: (r) => sim?.odds[r.teamId] ?? null,
        cell: (r) => (sim ? <span className="inline-flex items-center justify-end gap-2"><span className="meter w-16 sm:w-24" aria-hidden="true"><span className={pctTone(sim.odds[r.teamId]!)} style={{ width: `${Math.max(2, sim.odds[r.teamId]! * 100)}%` }} /></span><span className="w-11 font-semibold">{pct(sim.odds[r.teamId])}</span></span> : '…'),
      },
      { id: 'byRecord', label: `Top ${byRecord} by record`, className: 'text-ink-2', value: (r) => sim?.byRecord[r.teamId] ?? null, cell: (r) => (sim ? pct(sim.byRecord[r.teamId]) : '…') },
      { id: 'byPf', label: `Seed ${byRecord + 1} by PF`, className: 'text-ink-2', value: (r) => sim?.byPf[r.teamId] ?? null, cell: (r) => (sim ? pct(sim.byPf[r.teamId]) : '…') },
      { id: 'spark', label: 'Odds by week', left: true, value: (r) => sim?.odds[r.teamId] ?? null, cell: (r) => <Spark values={history ? Array.from({ length: idx.scoresThrough }, (_, i) => history[i + 1]?.[r.teamId] ?? null) : []} /> },
    ];
  }, [idx, L, sim, history, byRecord]);

  // Simple and Full keep their own column choice, so the detail switch always changes what you see.
  const t = useTable(full ? 'standings.full' : 'standings.simple', cols, rows, { id: 'seed', dir: 1 }, { filters, search, shown: full ? undefined : SIMPLE });

  // Headline (Nov 11, item E): who's in, and the bubble.
  const locks = sim ? rows.filter((r) => sim.odds[r.teamId]! >= 0.99).sort((a, b) => a.seed - b.seed) : [];
  const bubble = sim ? rows.filter((r) => sim.odds[r.teamId]! < 0.99 && sim.odds[r.teamId]! >= 0.25).sort((a, b) => sim.odds[b.teamId]! - sim.odds[a.teamId]!) : [];
  const names = (rs: StandingRow[]) => rs.map((r) => teamName(idx, r.teamId)).join(', ').replace(/, ([^,]*)$/, ' and $1');
  const words = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
  return (
    <div className="grid grid-cols-1 gap-10">
      {sim && (
        <section aria-label="Headline" className="grid gap-2">
          <p className="headline-sm">{locks.length >= byRecord + 1 ? 'The field is set' : `${words[locks.length] ?? locks.length} team${locks.length === 1 ? ' is' : 's are'} in`}</p>
          <p className="max-w-[70ch] text-ink-2">{locks.length ? `${names(locks)} ${locks.length === 1 ? 'is' : 'are'} 99% or better.` : ''}{bubble.length ? ` On the bubble: ${bubble.map((r) => `${teamName(idx, r.teamId)} ${pct(sim.odds[r.teamId])}`).join(', ')}.` : ''}</p>
        </section>
      )}
      {full && <ThisWeek />}
      <Section title={`Through Week ${idx.scoresThrough}`} aside={sim ? `Playoff odds from ${idx.ds.season.sim.runs.toLocaleString()} simulated seasons` : 'Simulating the rest of the season…'}>
        {full && <p className="max-w-[70ch] text-sm text-ink-2">
          Seeds 1 to {byRecord} go by record (ties broken head to head, then points for). Seed {byRecord + 1} is the most points for among everyone else.
          Weeks {idx.ds.season.top6Weeks.join(', ')} are not head to head: the top 6 scores get a win.
        </p>}
        {full && <p className="max-w-[70ch] text-sm text-ink-2">
          Luck is wins minus expected wins (xW). Each week your score is compared with all 11 others: beating 8 of them is worth 8/11 of a win, whoever you actually played.
          Top 6 weeks have no opponent, so they add no luck. {lucky(L, idx)}
        </p>}
        <TableBar t={t} noun="teams" file={`fwhl-standings-wk${idx.scoresThrough}`} />
        <DataTable
          t={t}
          rowKey={(r) => String(r.teamId)}
          stickyId="team"
          minWidth={full ? 'min-w-[56rem]' : 'max-w-3xl'}
          rowClass={(r) => (r.teamId === settings.myTeamId ? 'bg-primary-soft' : '')}
          empty="No team matches these filters."
        />
      </Section>
      <Week />
    </div>
  );
}

const pctTone = (o: number) => (o >= 0.9 ? 'bg-gain' : o >= 0.3 ? 'bg-accent' : 'bg-loss');

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

function lucky(L: Map<number, Luck>, idx: Parameters<typeof teamName>[0]): string {
  const rows = [...L].filter(([, x]) => x.games > 0).sort((a, b) => b[1].luck - a[1].luck);
  if (rows.length < 2) return '';
  const [hi, lo] = [rows[0]!, rows[rows.length - 1]!];
  return `Luckiest so far: ${teamName(idx, hi[0])} (${signed(hi[1].luck)} wins). Unluckiest: ${teamName(idx, lo[0])} (${signed(lo[1].luck)}).`;
}
