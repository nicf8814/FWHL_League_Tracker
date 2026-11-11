import { useMemo } from 'react';
import type { PlayerId, TeamId } from '../data/schema.ts';
import { useDeadline, useLeague } from '../data/store.tsx';
import { teamName } from '../engine/league.ts';
import { lineup, type Lineup } from '../engine/model.ts';
import { evaluate, MAX_PER_SIDE, tradeFromQuery, tradeToQuery, type Evaluation, type Trade } from '../engine/trade.ts';
import { useRoute } from '../app/router.ts';
import { Empty, fmt, Mono, PlayerName, PosMark, signed, TeamSelect, tone } from '../ui/components.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';
import { SavedTrades, SaveTradeButton } from './SavedTrades.tsx';

// The trade lives in the URL, so a trade is a link and the back button undoes a team change.
function useTrade() {
  const { idx, settings } = useLeague();
  const { query, replace } = useRoute();
  const raw = tradeFromQuery(query);
  const a = raw.a !== undefined && idx.teams.has(raw.a) ? raw.a : settings.myTeamId ?? idx.teamIds[0]!;
  const b = raw.b !== undefined && idx.teams.has(raw.b) && raw.b !== a ? raw.b : null;
  // LOGIC-4: anything not on the sending team's roster is dropped, and the user is told.
  const keep = (list: PlayerId[] | undefined, team: TeamId | null) => (list ?? []).filter((p) => team !== null && idx.owner.get(p) === team);
  const aGives = keep(raw.aGives, a), bGives = keep(raw.bGives, b);
  const dropped = [...(raw.aGives ?? []), ...(raw.bGives ?? [])].filter((p) => !aGives.includes(p) && !bGives.includes(p));
  const set = (t: Omit<Partial<Trade>, 'b'> & { b?: TeamId | null }) => {
    const next = { a, b, aGives, bGives, ...t };
    replace('analyzer', next.b === null ? `a=${next.a}` : tradeToQuery(next as Trade));
  };
  return { a, b, aGives, bGives, dropped, set };
}

export default function Analyzer() {
  const { idx, values: V } = useLeague();
  const T = useTrade();
  const dl = useDeadline();
  const ev = useMemo(() => (T.b === null ? null : evaluate(V, { a: T.a, b: T.b, aGives: T.aGives, bGives: T.bGives })), [V, T.a, T.b, T.aGives.join(), T.bGives.join()]);
  const toggle = (side: 'aGives' | 'bGives', p: PlayerId) => {
    const cur = T[side];
    T.set({ [side]: cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p] });
  };

  return (
    <div className="grid grid-cols-1 gap-8">
      {dl.passed && (
        <p role="note" className="border-l-[3px] border-accent bg-surface px-4 py-2 text-sm">
          The trade deadline has passed. Anything here is a what-if: it can't be made until the 2027 season.
        </p>
      )}
      {T.dropped.length > 0 && (
        <p role="status" className="border border-even bg-even-soft px-4 py-2 text-sm">
          Removed {T.dropped.map((p) => idx.players.get(p)?.name ?? p).join(', ')}: not on that team's roster in the current data.
        </p>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_1px_minmax(18rem,22rem)_1px_minmax(0,1fr)] lg:gap-6">
        <div className="order-2 lg:order-1">
          <Side title="sends" team={T.a} other={T.b} picked={T.aGives} onTeam={(a) => a !== null && T.set({ a, aGives: [], b: T.b === a ? null : T.b })} onToggle={(p) => toggle('aGives', p)} />
        </div>
        <div className="perf order-2 hidden lg:block" aria-hidden="true" />
        <div className="order-1 lg:order-2">
          <div className="grid gap-3 lg:sticky lg:top-20">
            <VerdictPanel ev={ev} a={T.a} b={T.b} onClear={() => T.set({ aGives: [], bGives: [] })} />
            {ev && !ev.errors.length && <SaveTradeButton trade={T} />}
          </div>
        </div>
        <div className="perf order-3 hidden lg:block" aria-hidden="true" />
        <div className="order-3 lg:order-4">
          {T.b === null ? (
            <div className="grid gap-3">
              <TeamSelect label="Trade partner" value={null} exclude={T.a} allowEmpty="Pick a team" onChange={(b) => b !== null && T.set({ b, bGives: [] })} />
              <Empty>Pick a trade partner to see his roster.</Empty>
            </div>
          ) : (
            <Side title="sends" team={T.b} other={T.a} picked={T.bGives} onTeam={(b) => T.set({ b, bGives: [] })} onToggle={(p) => toggle('bGives', p)} />
          )}
        </div>
      </div>
      {ev && !ev.errors.length && T.b !== null && <LineupImpact a={T.a} b={T.b} aGives={T.aGives} bGives={T.bGives} />}
      <SavedTrades />
    </div>
  );
}

function Side({ title, team, other, picked, onTeam, onToggle }: { title: string; team: TeamId; other: TeamId | null; picked: PlayerId[]; onTeam: (t: TeamId | null) => void; onToggle: (p: PlayerId) => void }) {
  const { idx, values: V, base } = useLeague();
  const open = usePlayerSheet();
  const roster = [...(idx.roster.get(team) ?? [])].sort((x, y) => V.bv(y) - V.bv(x));
  const full = picked.length >= MAX_PER_SIDE;
  return (
    <section className="grid gap-3" aria-label={`${teamName(idx, team)} ${title}`}>
      <TeamSelect label="Team" value={team} exclude={other} onChange={onTeam} />
      <div className="flex items-baseline justify-between border-b border-ink pb-1">
        <h2 className="flex items-center gap-2 text-lg"><Mono team={team} />{teamName(idx, team)} {title}</h2>
        <span className="num text-sm text-ink-3">{picked.length ? `${picked.length} · ${fmt(picked.reduce((s, p) => s + V.bv(p), 0))}` : 'none yet'}</span>
      </div>
      <ul className="grid">
        {roster.map((p) => {
          const on = picked.includes(p);
          return (
            <li key={p} className={`rowbtn grid min-h-11 grid-cols-[auto_auto_minmax(0,1fr)_auto_auto] items-center gap-x-2 border-b border-rule py-0.5 pr-1 ${on ? 'bg-primary-soft shadow-[inset_3px_0_0_var(--accent)]' : ''}`}>
              <label className="flex min-h-11 items-center pl-2 pr-1">
                <input type="checkbox" checked={on} disabled={!on && full} onChange={() => onToggle(p)} aria-label={`Include ${idx.players.get(p)?.name}`} />
              </label>
              <PosMark pos={idx.players.get(p)!.pos} />
              <span className="min-w-0"><PlayerName pid={p} onOpen={open} /></span>
              <span className="num w-12 text-right text-xs text-ink-3" title="Projected points per week">{fmt(base.proj.get(p))}</span>
              <span className="num w-10 text-right font-medium">{fmt(V.bv(p), 0)}</span>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-3">Columns: projected pts/wk, trade value. {full && `Up to ${MAX_PER_SIDE} players per side.`}</p>
    </section>
  );
}

function VerdictPanel({ ev, a, b, onClear }: { ev: Evaluation | null; a: TeamId; b: TeamId | null; onClear: () => void }) {
  const { idx, values: V } = useLeague();
  if (b === null) return <Empty>Pick a trade partner, then tick players on both sides.</Empty>;
  if (!ev) return <Empty>Tick the players each team sends. The verdict updates as you go.</Empty>;
  if (ev.errors.length)
    return (
      <div role="alert" className="grid gap-2 border border-loss bg-loss-soft p-4 text-sm">
        <b>This trade can't be scored yet.</b>
        <ul className="list-inside list-disc">{ev.errors.map((e) => <li key={e}>{e}</li>)}</ul>
      </div>
    );
  const A = teamName(idx, a), B = teamName(idx, b);
  const k = ev.verdict.kind;
  const color = k === 'win' ? 'text-gain' : k === 'lose' ? 'text-loss' : 'text-even';
  const odds = V.teamOdds(b);
  return (
    <section aria-live="polite" aria-label="Verdict" className="grid gap-4 border-y-2 border-ink py-4">
      <div className="grid justify-items-center gap-1 text-center">
        <p className={`font-display text-2xl font-extrabold uppercase [font-stretch:75%] ${color}`}>{ev.fairBoth ? 'Fair for both' : ev.verdict.label}</p>
        <p className="text-sm text-ink-2">{ev.fairBoth ? `${B} sees it as even by his own values, and ${A}'s lineup doesn't lose ground.` : `On trade value, from ${A}'s side.`}</p>
      </div>
      <dl className="grid grid-cols-2 gap-px bg-rule text-center">
        {[[`${A} sends`, ev.value.aSends], [`${B} sends`, ev.value.bSends]].map(([l, v]) => (
          <div key={l as string} className="bg-paper py-2">
            <dt className="truncate px-1 text-xs text-ink-3">{l}</dt>
            <dd className="num text-xl">{fmt(v as number)}</dd>
          </div>
        ))}
      </dl>
      <p className={`num text-center text-sm ${color}`}>{signed(ev.verdict.diff)} ({signed(ev.verdict.pct, 0)}%) for {A}</p>
      <dl className="grid gap-2 text-sm">
        <Row label={`${A} lineup`} value={<span className={`num ${tone(ev.gainA)}`}>{signed(ev.gainA)} pts/wk</span>} />
        <Row label={`${B} lineup`} value={<span className={`num ${tone(ev.gainB)}`}>{signed(ev.gainB)} pts/wk</span>} />
        <Row label={`${B} on paper`} value={<span className="num">{signed(ev.partnerEdge)}</span>} hint={`By ${B}'s own values${V.oddsReady ? ` (playoff odds ${Math.round(odds * 100)}%)` : ''}; ±${V.FAIR_RANGE} reads as even.`} />
        <Row label="Above replacement" value={<span className="num">{fmt(ev.aboveRepl.aSends)} → {fmt(ev.aboveRepl.bSends)}</span>} hint={`Pts/wk above a replacement starter: what ${A} sends → gets.`} />
      </dl>
      {!V.oddsReady && <p className="text-xs text-ink-3" role="status">Refining with playoff odds…</p>}
      <button type="button" className="btn justify-self-center" onClick={onClear}>Clear players</button>
    </section>
  );
}

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="border-t border-rule pt-2">
      <div className="flex items-baseline justify-between gap-3"><dt className="text-ink-2">{label}</dt><dd>{value}</dd></div>
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

function LineupImpact({ a, b, aGives, bGives }: { a: TeamId; b: TeamId; aGives: PlayerId[]; bGives: PlayerId[] }) {
  const { idx, base, values: V } = useLeague();
  const one = (team: TeamId, out: PlayerId[], inn: PlayerId[]) => {
    const now = (keys: PlayerId[]) => lineup(base, keys.filter((k) => !base.isOut(k)), () => 1);
    return { before: now(idx.roster.get(team) ?? []), after: now(V.rosterAfter(team, out, inn)), gain: V.weekGain(team, out, inn) };
  };
  return (
    <details className="group border-t-2 border-ink pt-3" open>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between">
        <h2 className="text-lg">Lineup impact</h2>
        <span className="text-sm text-ink-3 group-open:hidden">Show</span>
        <span className="hidden text-sm text-ink-3 group-open:inline">Hide</span>
      </summary>
      <p className="mb-4 max-w-[70ch] text-sm text-ink-2">
        This week's best lineup before and after. Pts/wk is the weighted average change through Week {idx.ds.season.regularSeasonWeeks} and the playoffs, counting byes, injury returns and each team's playoff odds.
      </p>
      <div className="grid gap-8 md:grid-cols-2">
        <LineupCol team={a} {...one(a, aGives, bGives)} />
        <LineupCol team={b} {...one(b, bGives, aGives)} />
      </div>
    </details>
  );
}

function LineupCol({ team, before, after, gain }: { team: TeamId; before: Lineup; after: Lineup; gain: number }) {
  const { idx } = useLeague();
  return (
    <div className="grid gap-2">
      <div className="flex items-baseline justify-between border-b border-ink pb-1">
        <h3 className="flex items-center gap-2"><Mono team={team} size="sm" />{teamName(idx, team)}</h3>
        <span className={`num font-semibold ${tone(gain)}`}>{signed(gain)} pts/wk</span>
      </div>
      <table className="tbl">
        <tbody>
          {after.slots.map((s, i) => {
            const old = before.slots[i]!;
            const changed = old.pid !== s.pid;
            return (
              <tr key={i}>
                <td className="l w-16 text-xs text-ink-3">{s.slot.join('/')}</td>
                <td className="l">
                  {changed && old.pid && <span className="mr-2 text-ink-3 line-through">{idx.players.get(old.pid)?.name}</span>}
                  <span className={changed ? 'font-semibold text-primary' : ''}>{s.pid ? idx.players.get(s.pid)?.name : 'Empty'}</span>
                </td>
                <td className="n">{fmt(s.v)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="num text-xs text-ink-3">Starters this week {fmt(before.start)} → {fmt(after.start)}</p>
    </div>
  );
}
