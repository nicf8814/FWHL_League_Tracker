import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { PlayerId } from '../data/schema.ts';
import { useDeadline, useLeague } from '../data/store.tsx';
import { findTradesAsync } from '../engine/finderClient.ts';
import type { Offer } from '../engine/finder.ts';
import { standings, teamName } from '../engine/league.ts';
import { lineup } from '../engine/model.ts';
import { evaluate, scenarioOf } from '../engine/replay.ts';
import { tradeToQuery } from '../engine/trade.ts';
import { href } from '../app/router.ts';
import { Empty, fmt, Mono } from '../ui/components.tsx';
import { Stamp } from './Tracker.tsx';
import { useThisWeek } from './ThisWeek.tsx';

// My Team home (Nov 11, item A): four answers up front, each one tap from the page with the detail.
const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
const last = (idx: ReturnType<typeof useLeague>['idx'], ids: PlayerId[]) => ids.map((p) => idx.players.get(p)?.name.split(' ').filter((x) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(x)).slice(-1)[0] ?? p).join(' + ');

function Card({ label, to, children }: { label: string; to: string; children: ReactNode }) {
  return (
    <a href={to} className="card grid content-start gap-2 p-4 no-underline">
      <span className="text-xs font-semibold uppercase tracking-wider text-ink-3">{label}</span>
      {children}
    </a>
  );
}

export default function Home() {
  const { idx, sim, settings } = useLeague();
  const me = settings.myTeamId;
  const table = useMemo(() => standings(idx), [idx]);
  if (me === null) return <Empty>Pick your team in Settings to see your home page.</Empty>;
  const row = table.find((r) => r.teamId === me)!;
  const pfRank = [...table].sort((a, b) => b.pf - a.pf).findIndex((r) => r.teamId === me) + 1;
  const odds = sim?.odds[me];
  const oddsText = odds === undefined ? 'odds loading' : odds >= 0.995 ? 'playoffs locked' : odds <= 0.005 ? 'out of the playoffs' : `${Math.round(odds * 100)}% to make the playoffs`;
  return (
    <div className="grid gap-6">
      <section aria-label="Your season" className="grid gap-1">
        <span className="flex items-center gap-2 text-sm text-ink-3"><Mono team={me} size="sm" />{teamName(idx, me)}</span>
        <p className="headline num">{row.w}-{row.l}{row.t ? `-${row.t}` : ''}</p>
        <p className="text-lg text-ink-2">
          {ord(row.seed)} seed · {pfRank === 1 ? 'most points in the league' : `${ord(pfRank)} in points`} · <b className={odds !== undefined && odds >= 0.9 ? 'text-gain' : odds !== undefined && odds < 0.3 ? 'text-loss' : 'text-even'}>{oddsText}</b>
        </p>
      </section>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <WeekCard />
        <TradeCard />
        <WaiverCard />
        <TradesCard />
      </div>
    </div>
  );
}

function WeekCard() {
  const { idx } = useLeague();
  const t = useThisWeek();
  if (!t) return <Card label="This week" to={href('standings')}><span>No regular-season game left.</span></Card>;
  const out = t.out.map((p) => idx.players.get(p)?.name.split(' ').slice(-1)[0]).join(', ');
  return (
    <Card label={`This week · Week ${t.w}`} to={href('standings')}>
      {t.top6 ? (
        <span className="text-[15px]">Top-6 week: you project <b className="num">{fmt(t.mine.start)}</b>, {ord(t.myRank)} of 12.</span>
      ) : t.opp !== null ? (
        <>
          <span className="flex items-baseline justify-between gap-3 text-[15px]">
            <span>vs <b>{teamName(idx, t.opp)}</b></span>
            <span className="num text-xl"><b>{fmt(t.mine.start)}</b> <span className="text-ink-3">– {fmt(t.oppPts)}</span></span>
          </span>
          <span className="flex h-2 gap-0.5" aria-hidden="true">
            <span className="bar bg-primary" style={{ flexGrow: t.mine.start }} />
            <span className="bar bg-rule-strong" style={{ flexGrow: t.oppPts ?? 0 }} />
          </span>
        </>
      ) : <span>No game this week.</span>}
      <span className="text-sm text-ink-3">Projected best lineups{out ? `. Out: ${out}` : ''}.</span>
    </Card>
  );
}

// The finder's best offer with your bench up for trade (its default fairness settings).
function TradeCard() {
  const { idx, values: V, base, settings, valuesVersion } = useLeague();
  const dl = useDeadline();
  const me = settings.myTeamId!;
  const [best, setBest] = useState<{ o: Offer; partner: number } | null | undefined>(undefined);
  useEffect(() => {
    if (dl.passed) return;
    let live = true;
    const roster = idx.roster.get(me) ?? [];
    const starters = new Set(lineup(base, roster.filter((p) => !base.isOut(p)), () => 1).slots.map((x) => x.pid));
    const q = { team: me, pos: 'ANY' as const, sell: roster.filter((p) => !starters.has(p)), keep: [], want: [], gap: 3, maxLoss: 1, partner: 'all' as const, sort: 'me' as const };
    findTradesAsync({ ds: idx.ds, version: valuesVersion, ramp: V.base.ramp, settings: V.settings, sim: V.sim, q, V }).then(
      (r) => { if (!live) return; const g = r[0]; setBest(g ? { o: g.offers[0]!, partner: g.team } : null); },
      () => live && setBest(null),
    );
    return () => { live = false; };
  }, [idx, V, base, me, valuesVersion, dl.passed]);
  if (dl.passed) return <Card label="Keepers" to={href('keepers')}><span className="text-[15px]">Trading is closed. See who to keep for 2027.</span></Card>;
  return (
    <Card label="Best trade idea" to={best ? href('analyzer', tradeToQuery({ a: me, b: best.partner, aGives: best.o.give, bGives: best.o.get })) : href('finder')}>
      {best === undefined ? <span className="text-sm text-ink-3" role="status">Looking…</span>
        : best === null ? <span className="text-[15px]">No fair deal for your bench right now.</span>
        : <>
            <span className="text-[15px]">{last(idx, best.o.give)} to {teamName(idx, best.partner)} for <b>{last(idx, best.o.get)}</b></span>
            <span className={`text-sm font-medium ${best.o.myGain >= 0 ? 'text-gain' : 'text-loss'}`}>{best.o.myGain >= 0 ? '+' : ''}{best.o.myGain.toFixed(1)} pts a week for you · {teamName(idx, best.partner)} should say yes</span>
          </>}
    </Card>
  );
}

function WaiverCard() {
  const { idx, values: V, settings } = useLeague();
  const me = settings.myTeamId!;
  const pick = useMemo(() => {
    const fas = [...idx.stats.keys()].filter((p) => !idx.owner.has(p) && idx.players.has(p)).sort((a, b) => V.bv(b) - V.bv(a)).slice(0, 40);
    const ranked = fas.map((p) => ({ p, gain: V.weekGain(me, [], [p]) })).sort((a, b) => b.gain - a.gain);
    return { top: ranked[0], stash: fas[0] };
  }, [idx, V, me]);
  const name = (p?: PlayerId) => (p ? `${idx.players.get(p)?.name}, ${idx.players.get(p)?.pos}` : '');
  return (
    <Card label="Waivers" to={href('waivers')}>
      {pick.top && pick.top.gain >= 0.1
        ? <><span className="text-[15px]">Add <b>{name(pick.top.p)}</b></span><span className="text-sm font-medium text-gain">+{pick.top.gain.toFixed(1)} pts a week</span></>
        : <><span className="text-[15px]">Nobody beats your bench</span>{pick.stash && <span className="text-sm text-ink-3">Best stash: {name(pick.stash)}</span>}</>}
    </Card>
  );
}

function TradesCard() {
  const { idx, values: V, settings } = useLeague();
  const me = settings.myTeamId!;
  const grades = useMemo(() => idx.ds.transactions.filter((t) => t.type === 'trade' && t.legs.some((l) => l.toTeamId === me)).sort((a, b) => a.date.localeCompare(b.date)).map((t) => ({ id: t.id, g: evaluate(V, scenarioOf(t)).res.get(me)!.grade })), [idx, V, me]);
  return (
    <Card label="Your trades" to={href('tracker', 'tab=mine')}>
      {grades.length ? <span className="flex flex-wrap gap-2">{grades.map((x) => <Stamp key={x.id} grade={x.g} size="sm" />)}</span> : <span className="text-[15px]">No trades yet this season.</span>}
      <span className="text-sm text-ink-3">{grades.length} trade{grades.length === 1 ? '' : 's'} this season</span>
    </Card>
  );
}
