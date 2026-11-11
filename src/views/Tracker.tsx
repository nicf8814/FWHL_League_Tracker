import { useEffect, useMemo, useState } from 'react';
import type { PlayerId, TeamId, Transaction } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { teamName } from '../engine/league.ts';
import { evaluate, gradePath, rippleInputs, scenarioOf, type Evaluation, type Scenario, type WeekRow } from '../engine/replay.ts';
import { simulateOdds } from '../engine/simClient.ts';
import type { SimResult } from '../engine/sim.ts';
import { useRoute } from '../app/router.ts';
import { Empty, fmt, Mono, pct, PlayerName, Seg, Sheet, signed, tone } from '../ui/components.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

type Tab = 'all' | 'mine' | 'whatif';
const dateLabel = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const wl = (r: { w: number; l: number; t: number }) => `${r.w}-${r.l}${r.t ? `-${r.t}` : ''}`;

// Grades are stamped, not pilled: a square ink mark, tilted a few degrees (audit UI-9).
export function Stamp({ grade, size = 'md' }: { grade: string; size?: 'sm' | 'md' | 'lg' }) {
  const c = grade[0] === 'A' || grade[0] === 'B' ? 'text-gain' : grade[0] === 'C' ? 'text-even' : 'text-loss';
  const s = size === 'lg' ? 'size-14 text-2xl' : size === 'sm' ? 'size-7 text-sm' : 'size-11 text-xl';
  return (
    <span aria-label={`Grade ${grade}`} className={`inline-grid shrink-0 place-items-center border-2 border-current font-display font-extrabold leading-none [font-stretch:75%] ${s} ${c} -rotate-3`}>
      {grade}
    </span>
  );
}

function useEvaluations(list: Transaction[]) {
  const { values: V } = useLeague();
  return useMemo(() => new Map(list.map((tx) => { const s = scenarioOf(tx); return [tx.id, { s, ev: evaluate(V, s) }]; })), [V, list]);
}

export default function Tracker() {
  const { idx, settings } = useLeague();
  const { query, replace } = useRoute();
  const tab: Tab = (['all', 'mine', 'whatif'] as const).find((t) => t === query.get('tab')) ?? 'all';
  const [open, setOpen] = useState<string | null>(null);
  const trades = useMemo(() => idx.ds.transactions.filter((t) => t.type === 'trade').sort((a, b) => b.date.localeCompare(a.date) || b.effectiveWeek - a.effectiveWeek), [idx]);
  const vetoes = useMemo(() => idx.ds.transactions.filter((t) => t.type === 'veto').sort((a, b) => b.date.localeCompare(a.date)), [idx]);
  const mine = settings.myTeamId;
  const involves = (t: Transaction) => mine !== null && t.legs.some((l) => l.fromTeamId === mine || l.toTeamId === mine);
  const shown = tab === 'mine' ? trades.filter(involves) : trades;
  const evals = useEvaluations(tab === 'whatif' ? [...vetoes, ...trades] : shown);
  const sel = open ? evals.get(open) : undefined;

  return (
    <div className="grid grid-cols-1 gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Seg label="Trades to show" value={tab} options={[['all', 'All trades'], ['mine', 'My trades'], ['whatif', 'What if']] as const} onChange={(t) => replace('tracker', `tab=${t}`)} />
        <p className="text-sm text-ink-3">Through Week {idx.scoresThrough}</p>
      </div>
      {tab !== 'whatif' ? (
        shown.length ? (
          <ul className="grid gap-x-8 lg:grid-cols-2">
            {shown.map((t) => <li key={t.id}><TradeCard tx={t} ev={evals.get(t.id)!.ev} onOpen={() => setOpen(t.id)} /></li>)}
          </ul>
        ) : <Empty>{tab === 'mine' ? (mine === null ? 'Pick your team in Data & settings to see your trades.' : "You haven't made a trade this season.") : 'No trades logged yet.'}</Empty>
      ) : (
        <WhatIfList vetoes={vetoes} trades={trades} evals={evals} onOpen={setOpen} />
      )}
      <Sheet open={!!sel} onClose={() => setOpen(null)} title={sel ? title(idx, sel.s) : ''}>
        {sel && <Analysis s={sel.s} ev={sel.ev} />}
      </Sheet>
    </div>
  );
}

const teamsOf = (tx: Transaction) => [...new Set(tx.legs.flatMap((l) => [l.fromTeamId, l.toTeamId]))] as [TeamId, TeamId];
const title = (idx: ReturnType<typeof useLeague>['idx'], s: Scenario) => teamsOf(s.tx).map((t) => teamName(idx, t)).join(' ⇄ ') + (s.veto ? ' (vetoed)' : '');
const lastNames = (idx: ReturnType<typeof useLeague>['idx'], ids: PlayerId[]) => ids.map((p) => idx.players.get(p)?.name.split(' ').filter((x) => !/^(Jr\.?|Sr\.?|II|III|IV)$/.test(x)).slice(-1)[0] ?? p).join(', ');

// One headline (the grade) and one supporting line (the record) per team (audit UI-3).
function TradeCard({ tx, ev, onOpen }: { tx: Transaction; ev: Evaluation; onOpen: () => void }) {
  const { idx, settings } = useLeague();
  return (
    <button type="button" onClick={onOpen} className="rowbtn grid w-full gap-1 border-b border-rule py-3 text-left">
      <span className="flex justify-between text-xs text-ink-3">
        <span>Week {tx.week} · {dateLabel(tx.date)}</span>
        <span>{ev.n ? `${ev.n} week${ev.n > 1 ? 's' : ''} played` : 'Graded on projections'}</span>
      </span>
      {teamsOf(tx).map((tm) => {
        const r = ev.res.get(tm)!, now = ev.calc.real.get(tm)!, alt = ev.calc.alt.get(tm)!;
        const same = wl(now) === wl(alt);
        return (
          <span key={tm} className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 py-1">
            <Stamp grade={r.grade} />
            <span className="min-w-0">
              <span className={`block truncate font-medium ${tm === settings.myTeamId ? 'text-primary' : ''}`}>{teamName(idx, tm)} <span className="font-normal text-ink-3">got {lastNames(idx, tx.legs.filter((l) => l.toTeamId === tm).map((l) => l.playerId))}</span></span>
              <span className="num block text-sm text-ink-2">{wl(now)}{same ? ' · same without it' : <> · <b className={alt.w > now.w ? 'text-loss' : 'text-gain'}>{wl(alt)} without it</b></>}</span>
            </span>
          </span>
        );
      })}
    </button>
  );
}

function WhatIfList({ vetoes, trades, evals, onOpen }: { vetoes: Transaction[]; trades: Transaction[]; evals: Map<string, { s: Scenario; ev: Evaluation }>; onOpen: (id: string) => void }) {
  const { idx, settings } = useLeague();
  const card = (tx: Transaction) => {
    const { s, ev } = evals.get(tx.id)!;
    const C = ev.calc;
    const [nowS, altS] = s.veto ? [C.alt, C.real] : [C.real, C.alt]; // "now" = the world being judged
    const others = [...C.real.keys()].filter((t) => !teamsOf(tx).includes(t) && (wl(C.real.get(t)!) !== wl(C.alt.get(t)!) || C.real.get(t)!.seed !== C.alt.get(t)!.seed));
    const chain = C.undo.filter((u) => u.id !== tx.id);
    const sixth = (m: typeof C.real) => [...m].find(([, r]) => r.seed === idx.ds.season.seedsByRecord + 1)?.[0];
    return (
      <button key={tx.id} type="button" onClick={() => onOpen(tx.id)} className="rowbtn grid w-full gap-1.5 border-b border-rule py-3 text-left">
        <span className="flex justify-between text-xs text-ink-3">
          <span><span className={`tag mr-2 ${s.veto ? 'text-loss' : 'text-primary'}`}>{s.veto ? 'Vetoed' : 'Rewind'}</span>Week {tx.week} · {dateLabel(tx.date)}</span>
          <span>{s.veto ? 'If it went through' : 'If it never happened'}</span>
        </span>
        {teamsOf(tx).map((tm) => {
          const a = (s.veto ? altS : nowS).get(tm)!, b = (s.veto ? nowS : altS).get(tm)!; // real -> scenario
          const d = b.w - a.w;
          return (
            <span key={tm} className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className={`flex items-center gap-2 font-medium ${tm === settings.myTeamId ? 'text-primary' : ''}`}><Mono team={tm} size="sm" />{teamName(idx, tm)}</span>
              <span className="num text-sm">{wl(a)} → <b className={d > 0 ? 'text-gain' : d < 0 ? 'text-loss' : ''}>{wl(b)}</b> · PF {fmt(a.pf)} → {fmt(b.pf)} · seed {a.seed} → {b.seed}</span>
            </span>
          );
        })}
        {others.length > 0 && <span className="text-xs text-ink-2">Also: {others.map((t) => { const a = C.real.get(t)!, b = C.alt.get(t)!; return `${teamName(idx, t)} ${wl(a) === wl(b) ? `seed ${a.seed} → ${b.seed}` : `${wl(a)} → ${wl(b)}`}`; }).join(', ')}</span>}
        <span className="text-xs text-ink-3">6th seed (PF): {sixth(C.real) === sixth(C.alt) ? `${teamName(idx, sixth(C.real))} either way` : `${teamName(idx, sixth(C.real))} really, ${teamName(idx, sixth(C.alt))} in this version`}{chain.length ? ` · also undoes ${chain.map((u) => `${teamsOf(u).map((t) => teamName(idx, t)).join('-')} (Wk ${u.week})`).join(', ')}` : ''}</span>
      </button>
    );
  };
  return (
    <div className="grid gap-8">
      <section className="grid gap-1">
        <h2 className="border-b border-ink pb-1 text-lg">Vetoed trades, as if they went through</h2>
        {vetoes.length ? vetoes.map(card) : <Empty>No vetoed trades this season.</Empty>}
      </section>
      <section className="grid gap-1">
        <h2 className="border-b border-ink pb-1 text-lg">Rewind a real trade</h2>
        <p className="text-sm text-ink-3">Records, points for and seeds through Week {idx.scoresThrough} if the trade never happened. Later trades that moved the same players are undone too.</p>
        {trades.map(card)}
      </section>
    </div>
  );
}

function Analysis({ s, ev }: { s: Scenario; ev: Evaluation }) {
  const { idx, settings, values: V } = useLeague();
  const teams = teamsOf(s.tx);
  const [tab, setTab] = useState<TeamId>(teams.includes(settings.myTeamId as TeamId) ? settings.myTeamId! : teams[0]);
  const [sub, setSub] = useState<'sum' | 'wk' | 'pl'>('sum');
  const path = useMemo(() => gradePath(V, s, ev), [V, s, ev]);
  const r = ev.res.get(tab)!;
  return (
    <div className="grid gap-5">
      <p className="text-sm text-ink-3">Week {s.tx.week} · {dateLabel(s.tx.date)} · {ev.n ? `${ev.n} week${ev.n > 1 ? 's' : ''} of results` : 'no games played yet'}{s.veto ? ' · what if it went through' : ''}</p>
      <div className="grid grid-cols-2 gap-px bg-rule" role="group" aria-label="Team">
        {teams.map((tm) => (
          <button key={tm} type="button" aria-pressed={tab === tm} onClick={() => setTab(tm)} className={`flex items-center gap-3 p-3 text-left ${tab === tm ? 'border-b-[3px] border-accent bg-surface' : 'border-b-[3px] border-transparent bg-paper text-ink-3'}`}>
            <Stamp grade={ev.res.get(tm)!.grade} size="sm" />
            <span className="font-medium">{teamName(idx, tm)}</span>
          </button>
        ))}
      </div>
      <Seg label="Section" value={sub} options={[['sum', 'Summary'], ['wk', 'Weeks'], ['pl', 'Players']] as const} onChange={setSub} />
      {sub === 'sum' && <Summary s={s} ev={ev} tm={tab} path={path.get(tab)!} />}
      {sub === 'wk' && <Weeks rows={r.rows} veto={s.veto} />}
      {sub === 'pl' && <Players s={s} tm={tab} />}
      <details className="text-sm text-ink-2">
        <summary className="min-h-11 cursor-pointer py-2 font-medium text-ink">How this is figured</summary>
        <div className="grid gap-2">
          <p><b>Grade.</b> Starts from the trade itself (value received and projected points per week above replacement), then moves toward production as weeks are played: weeks ÷ (weeks + 4) of the grade. Production is each player's points above a replacement starter at his position that week (QB12, RB31, WR34, TE7); out weeks count as 0. Keeper value for 2027 is added on top, weighted 12% for contenders up to 60% for teams out of the race. Lineups and wins don't enter the grade. C is even.</p>
          <p><b>{s.veto ? 'If it went through' : 'No trade'}.</b> Each week is the team's real score plus the difference between its best possible lineup {s.veto ? 'with the trade' : 'with the trade undone'} and its best possible lineup as it really was, so the manager's real start/sit choices still count. Any later trade that moved one of the same players is undone too, down the chain. An empty slot takes the average of the top three free agents at that position that week.</p>
          <p><b>League ripple.</b> When a result flips, the opponent's flips the other way. Weeks {idx.ds.season.top6Weeks.join(', ')} go by the top-6 rule, so a changed score can move another team across the line. Playoff odds rerun the season simulation in both worlds with today's rosters.</p>
        </div>
      </details>
    </div>
  );
}

function Summary({ s, ev, tm, path }: { s: Scenario; ev: Evaluation; tm: TeamId; path: string[] }) {
  const { values: V } = useLeague();
  const r = ev.res.get(tm)!;
  const got = s.tx.legs.filter((l) => l.toTeamId === tm).map((l) => l.playerId);
  const vNow = got.reduce((a, p) => a + V.bv(p), 0);
  const now = ev.calc.real.get(tm)!, alt = ev.calc.alt.get(tm)!;
  const [mine, other] = s.veto ? [alt, now] : [now, alt];
  const kwLabel = r.kw <= 0.13 ? 'contender' : r.kw >= 0.45 ? 'out of the race' : 'bubble';
  const stat = (label: string, v: React.ReactNode, sub: string) => (
    <div className="border-t border-rule pt-2"><dt className="text-xs text-ink-3">{label}</dt><dd className="num text-lg">{v}</dd><dd className="text-xs text-ink-3">{sub}</dd></div>
  );
  return (
    <div className="grid gap-5">
      <ol className="flex flex-wrap items-end gap-3" aria-label="Grade after each week">
        {path.map((g, i) => (
          <li key={i} className="grid justify-items-center gap-1"><Stamp grade={g} size="sm" /><span className="text-xs text-ink-3">{i ? `Wk ${s.tx.effectiveWeek + i - 1}` : 'Trade'}</span></li>
        ))}
      </ol>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3">
        {stat('Record', `${wl(mine)}`, wl(mine) === wl(other) ? (s.veto ? 'same as real life' : 'same without the trade') : `${wl(other)} ${s.veto ? 'in real life' : 'without the trade'}`)}
        {stat(s.veto ? 'Pts/wk if it went through' : 'Pts/wk vs no trade', r.act == null ? '–' : <span className={tone(r.act)}>{signed(r.act)}</span>, 'best possible lineups, both worlds')}
        {stat('Production', r.par == null ? 'No games yet' : <span className={tone(r.par)}>{signed(r.par)}/wk</span>, 'above replacement, got vs gave')}
        {stat('Value', s.veto ? fmt(vNow, 0) : `${fmt(r.val, 0)} → ${fmt(vNow, 0)}`, s.veto ? 'received, today' : 'at trade → now')}
        {stat('Proj pts/wk then', r.pGain == null ? 'Not saved' : <span className={tone(r.pGain)}>{signed(r.pGain)}</span>, 'above replacement')}
        {stat('Keepers (2027)', Math.abs(r.keep) < 0.5 ? 'No change' : <span className={tone(r.keep)}>{r.keep >= 0 ? '+' : '−'}${Math.abs(r.keep).toFixed(1)}</span>, `counts ${Math.round(r.kw * 100)}% (${kwLabel})`)}
      </dl>
      <Ripple s={s} ev={ev} />
    </div>
  );
}

// Records and seeds are instant; playoff odds come from the worker a moment later (audit PERF-9).
function Ripple({ s, ev }: { s: Scenario; ev: Evaluation }) {
  const { idx, values: V, simInput } = useLeague();
  const [odds, setOdds] = useState<{ now: SimResult; alt: SimResult } | null>(null);
  useEffect(() => {
    let live = true;
    setOdds(null);
    const { now, alt } = rippleInputs(V, s, ev.calc, simInput);
    Promise.all([simulateOdds(now), simulateOdds(alt)]).then(([a, b]) => live && setOdds({ now: a, alt: b }), () => {});
    return () => { live = false; };
  }, [V, s, ev, simInput]);
  const C = ev.calc;
  const [W1, W2] = s.veto ? [C.alt, C.real] : [C.real, C.alt]; // judged world, other world
  const [O1, O2] = odds ? (s.veto ? [odds.alt, odds.now] : [odds.now, odds.alt]) : [null, null];
  const rows = idx.teamIds.filter((t) => C.aff.includes(t) || wl(W1.get(t)!) !== wl(W2.get(t)!) || W1.get(t)!.seed !== W2.get(t)!.seed || (O1 && O2 && Math.abs(O1.odds[t]! - O2.odds[t]!) >= 0.04)).sort((a, b) => W1.get(a)!.seed - W1.get(b)!.seed);
  const other = s.veto ? 'real' : 'no trade';
  return (
    <section className="grid gap-2">
      <h3 className="border-b border-ink pb-1">League ripple</h3>
      <div className="overflow-x-auto">
        <table className="tbl">
          <thead><tr><th className="l">Team</th><th>Record</th><th>Seed</th><th>PF</th><th>Playoffs</th></tr></thead>
          <tbody>
            {rows.map((t) => {
              const a = W1.get(t)!, b = W2.get(t)!;
              const cell = (x: string, y: string, better: boolean) => <td className="n">{x}{x !== y && <span className={`block text-xs ${better ? 'text-gain' : 'text-loss'}`}>{other} {y}</span>}</td>;
              return (
                <tr key={t}>
                  <td className="l"><span className="flex items-center gap-2"><Mono team={t} size="sm" />{teamName(idx, t)}</span></td>
                  {cell(wl(a), wl(b), a.w > b.w)}
                  {cell(String(a.seed), String(b.seed), a.seed < b.seed)}
                  {cell(fmt(a.pf), fmt(b.pf), a.pf > b.pf)}
                  {O1 && O2 ? cell(pct(O1.odds[t]), pct(O2.odds[t]), O1.odds[t]! > O2.odds[t]!) : <td className="n text-ink-3">…</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!odds && <p className="text-xs text-ink-3" role="status">Simulating playoff odds in both worlds…</p>}
    </section>
  );
}

function Weeks({ rows, veto }: { rows: WeekRow[]; veto: boolean }) {
  const { idx } = useLeague();
  if (!rows.length) return <Empty>No games played since the trade yet.</Empty>;
  const [A, B] = veto ? ['If traded', 'Real'] : ['Actual', 'No trade'];
  const ord = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
  return (
    <ol className="grid">
      {rows.map((x) => {
        const flip = (x.rAct === 'W') !== (x.rCf === 'W');
        const d = x.act - x.cf;
        return (
          <li key={x.w} className={`grid gap-1 border-b border-rule py-2 ${flip ? (x.rAct === 'W' ? 'bg-gain-soft' : 'bg-loss-soft') : ''}`}>
            <div className="flex justify-between gap-3">
              <span className="font-medium">Week {x.w} · {x.top6 ? 'top-6 week' : `vs ${teamName(idx, x.opp)}${x.vsPartner ? '*' : ''}`}</span>
              <span className="num">{flip ? <><s className="text-ink-3">{x.rCf}</s> → <b>{x.rAct}</b></> : x.rAct}</span>
            </div>
            <div className="num flex justify-between gap-3 text-sm">
              <span>{A} <b>{fmt(x.act)}</b>{x.pAct ? ` (${ord(x.pAct)})` : ''} · {B} <b>{fmt(x.cf)}</b>{x.pCf ? ` (${ord(x.pCf)})` : ''}</span>
              <span className={`font-semibold ${tone(d)}`}>{signed(d)}</span>
            </div>
            <div className="num flex justify-between gap-3 text-xs text-ink-3">
              <span>Perfect lineups {fmt(x.bAct)} · {fmt(x.bCf)}</span>
              <span>{x.top6 ? '6th place' : 'Opponent'} {fmt(x.oppAct)}{Math.abs(x.oppAct - x.oppCf) > 0.05 ? ` (${fmt(x.oppCf)})` : ''}</span>
            </div>
            {x.bump && x.bump.length > 0 && <p className="text-xs text-ink-2">{x.bump.map((b) => `${teamName(idx, b.team)}: ${b.cf} → ${b.act}`).join(' · ')}</p>}
          </li>
        );
      })}
    </ol>
  );
}

function Players({ s, tm }: { s: Scenario; tm: TeamId }) {
  const { idx, values: V } = useLeague();
  const open = usePlayerSheet();
  const legs = s.tx.legs.filter((l) => l.toTeamId === tm);
  const avg = (p: PlayerId, from: number, to: number) => {
    const pts = [...idx.weeks].filter(([w, m]) => w >= from && w <= to && m.get(p) && m.get(p)!.points != null && m.get(p)!.opponent !== 'BYE').map(([, m]) => m.get(p)!.points!);
    return pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null;
  };
  const started = (p: PlayerId) => [...idx.weeks].filter(([w, m]) => w >= s.tx.effectiveWeek && w <= idx.scoresThrough && m.get(p)?.slot === 'start' && m.get(p)?.teamId === tm).length;
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <thead><tr><th className="l">Player</th><th>Before</th><th>After</th><th>Started</th><th>Value</th></tr></thead>
        <tbody>
          {legs.map((l) => (
            <tr key={l.playerId}>
              <td className="l whitespace-normal"><PlayerName pid={l.playerId} onOpen={open} /></td>
              <td className="n">{fmt(avg(l.playerId, 1, s.tx.effectiveWeek - 1))}</td>
              <td className="n">{fmt(avg(l.playerId, s.tx.effectiveWeek, idx.scoresThrough))}</td>
              <td className="n">{started(l.playerId)}</td>
              <td className="n">{s.veto ? fmt(V.bv(l.playerId), 0) : `${fmt(l.valueAtTrade ?? null, 0)} → ${fmt(V.bv(l.playerId), 0)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs text-ink-3">Points per week. Before is with his old team, after is since the trade; byes are skipped and out weeks count as 0.</p>
    </div>
  );
}
