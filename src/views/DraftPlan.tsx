// Draft plan panel on the Draft prep page: Nic's 13-man target roster. His flagged keepers drop in at
// their keeper cost; "+" on a board row adds a player at his expected cost, and every bid can be typed.
// No bid can break the max-bid rule (Art. IV): typed bids stop at the max, and + is off at $0.
// Auto-fill (engine/autoFill.ts) fills only the empty spots (Nic, Nov 18): keepers and every player Nic
// added himself stay, and the next auto-fill replaces only its own picks (marked auto). "Keep" turns an
// auto pick into one of Nic's; so does typing his bid. Avoided players are never picked. The plan lives in this browser (localStorage), one per draft year.
import { Fragment, useState } from 'react';
import { playerKey } from '../data/drafts.ts';
import { REACH_RESERVE, STRATEGIES, swapOptions, type Strategy } from '../engine/autoFill.ts';
import type { PrepRow } from '../engine/draftPrep.ts';
import type { SimOut } from '../engine/mockAuction.ts';
import { maxBidFor, placePlan, type PlanPick } from '../engine/rosterPlan.ts';
import { fmt } from '../ui/components.tsx';

const PLAN_KEY = 'fwhl-draft-plan'; // { year: { bids: { playerKey: bid }, auto: [], avoid: [], reach } }
const SAVED_KEY = 'fwhl-draft-plan-saved'; // { year: { name: plan } }
interface YearPlan { bids: Record<string, number>; auto: string[]; avoid: string[]; reach?: number }
type Plans = Record<string, YearPlan>;
const blank: YearPlan = { bids: {}, auto: [], avoid: [] };
const read = (): Plans => {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAN_KEY) ?? '{}') as Record<string, unknown>;
    // part A saved just the bids
    return Object.fromEntries(Object.entries(raw).map(([y, v]) => [y, v && typeof v === 'object' && 'bids' in v ? { bids: (v as YearPlan).bids, auto: (v as YearPlan).auto ?? [], avoid: (v as YearPlan).avoid ?? [], reach: (v as YearPlan).reach } : { ...blank, bids: v as Record<string, number> }]));
  } catch { return {}; }
};
const save = (p: Plans) => { try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch { /* lasts for this visit */ } };
type Saved = Record<string, Record<string, YearPlan>>;
const readSaved = (): Saved => { try { return JSON.parse(localStorage.getItem(SAVED_KEY) ?? '{}') as Saved; } catch { return {}; } };
const writeSaved = (s: Saved) => { try { localStorage.setItem(SAVED_KEY, JSON.stringify(s)); } catch { /* lasts for this visit */ } };

export const rowKey = (r: PrepRow) => playerKey(r.name, r.pos);

export function usePlan(year: number) {
  const [all, setAll] = useState<Plans>(read);
  const [saved, setSaved] = useState<Saved>(readSaved);
  const putSaved = (f: (y: Record<string, YearPlan>) => Record<string, YearPlan>) => setSaved((prev) => { const next = { ...prev, [year]: f(prev[year] ?? {}) }; writeSaved(next); return next; });
  const mine = all[year] ?? blank;
  // Every change builds on the latest plan (quick clicks in a row must not undo each other).
  const put = (f: (y: YearPlan) => Partial<YearPlan>) => setAll((prev) => {
    const cur = prev[year] ?? blank;
    const next = { ...prev, [year]: { ...cur, ...f(cur) } };
    save(next);
    return next;
  });
  const without = (y: YearPlan, k: string) => { const { [k]: _, ...rest } = y.bids; return rest; };
  return {
    bids: mine.bids,
    auto: new Set(mine.auto),
    avoid: new Set(mine.avoid),
    has: (k: string) => k in mine.bids,
    add: (k: string, bid: number) => put((y) => ({ bids: { ...y.bids, [k]: Math.max(1, Math.round(bid)) }, avoid: y.avoid.filter((x) => x !== k), auto: y.auto.filter((x) => x !== k) })),
    setBid: (k: string, bid: number) => put((y) => ({ bids: { ...y.bids, [k]: Math.max(1, Math.round(bid) || 1) }, auto: y.auto.filter((x) => x !== k) })),
    remove: (k: string) => put((y) => ({ bids: without(y, k), auto: y.auto.filter((x) => x !== k) })),
    keep: (k: string) => put((y) => ({ auto: y.auto.filter((x) => x !== k) })),
    // Swap one planned player for another at the given bid; the new one is Nic's pick.
    swap: (out: string, inn: string, bid: number) => put((y) => ({ bids: { ...without(y, out), [inn]: Math.max(1, Math.round(bid)) }, auto: y.auto.filter((x) => x !== out && x !== inn) })),
    reach: mine.reach ?? REACH_RESERVE,
    setReach: (v: number) => put(() => ({ reach: Math.max(0, Math.min(60, Math.round(v) || 0)) })),
    savedNames: Object.keys(saved[year] ?? {}),
    saveAs: (name: string) => putSaved((y) => ({ ...y, [name]: { ...mine, reach: mine.reach ?? REACH_RESERVE } })),
    load: (name: string) => { const p = saved[year]?.[name]; if (p) put(() => ({ ...blank, ...p, reach: p.reach ?? REACH_RESERVE })); },
    drop: (name: string) => putSaved((y) => { const { [name]: _, ...rest } = y; return rest; }),
    setAvoid: (k: string, on: boolean) => put((y) => (on ? { avoid: [...new Set([...y.avoid, k])], bids: without(y, k), auto: y.auto.filter((x) => x !== k) } : { avoid: y.avoid.filter((x) => x !== k) })),
    // Auto-fill result: Nic's own picks stay, the auto picks are swapped for these.
    fillWith: (autoBids: Record<string, number>) => put((y) => {
      const own = Object.fromEntries(Object.entries(y.bids).filter(([k]) => !y.auto.includes(k)));
      return { bids: { ...own, ...autoBids }, auto: Object.keys(autoBids).filter((k) => !(k in own)) };
    }),
    clearAuto: () => put((y) => ({ bids: Object.fromEntries(Object.entries(y.bids).filter(([k]) => !y.auto.includes(k))), auto: [] })),
    clear: () => put(() => ({ bids: {}, auto: [] })),
  };
}
export type Plan = ReturnType<typeof usePlan>;

// The plan's players: my keepers at their keeper cost, then the planned bids. A planned player now kept
// by someone else is listed as gone.
export function planPicks(rows: PrepRow[], me: string | null, bids: Record<string, number>) {
  const byKey = new Map(rows.map((r) => [rowKey(r), r]));
  const picks: PlanPick[] = [];
  for (const r of rows) if (me && r.keeper?.[3] === me) picks.push({ key: rowKey(r), name: r.name, pos: r.pos, bid: r.keeper[2], keeper: true });
  const gone: string[] = [];
  for (const [k, bid] of Object.entries(bids)) {
    const r = byKey.get(k);
    if (!r) continue;
    if (r.keeper) { if (r.keeper[3] !== me) gone.push(`${r.name} (kept by ${r.keeper[3]})`); continue; }
    picks.push({ key: k, name: r.name, pos: r.pos, bid, keeper: false });
  }
  return { picks, gone, byKey };
}

const btn = 'rowbtn h-7 min-w-7 rounded border border-line px-1.5 text-xs disabled:opacity-40';

export function PlanButton({ row, plan, mine, maxBid, full }: { row: PrepRow; plan: Plan; mine: boolean; maxBid: number; full: boolean }) {
  const k = rowKey(row);
  if (mine) return <span className="text-xs text-ink-3">yours</span>;
  if (row.keeper) return null;
  if (plan.has(k)) return <button type="button" className={btn} onClick={() => plan.remove(k)} aria-label={`Take ${row.name} off the plan`} title="In your plan. Click to take him off.">✓</button>;
  if (plan.avoid.has(k)) return <button type="button" className={`${btn} text-ink-3`} onClick={() => plan.setAvoid(k, false)} aria-label={`Stop avoiding ${row.name}`} title="Avoided: auto-fill skips him. Click to undo.">⊘</button>;
  return (
    <span className="flex gap-1">
      <button type="button" disabled={maxBid < 1 || full} title={maxBid < 1 ? 'No money or spot left' : full ? `No open spot for a ${row.pos}` : 'Add to my plan'} className={btn} onClick={() => plan.add(k, Math.min(Math.max(1, row.cost), maxBid))} aria-label={`Add ${row.name} to the plan`}>+</button>
      <button type="button" className={`${btn} text-ink-3`} onClick={() => plan.setAvoid(k, true)} aria-label={`Avoid ${row.name}`} title="Avoid: auto-fill never picks him">✕</button>
    </span>
  );
}

export function PlanPanel({ rows, me, plan, budget, onFill, sim }: { rows: PrepRow[]; me: string | null; plan: Plan; budget: number; onFill: (s: Strategy) => void; sim: SimOut | null }) {
  const { picks, gone, byKey } = planPicks(rows, me, plan.bids);
  const s = placePlan(picks, budget);
  const [swapping, setSwapping] = useState<string | null>(null);
  const [name, setName] = useState('');
  return (
    <div className="grid gap-2 rounded border border-line bg-panel p-2.5 text-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-x-2">
        <h3 className="text-sm font-semibold">My plan{me ? ` (${me})` : ''}</h3>
        <p className="num">${s.spent}/{budget} · ${s.left} left · {s.open} open · <b>max ${Math.max(0, s.maxBid)}</b>{sim?.planOdds != null && <> · <span title="Share of mock auctions where every player you bid on stays within your bid">plan odds <b>{Math.round(sim.planOdds * 100)}%</b></span></>}</p>
      </div>
      <div className="flex flex-wrap items-center gap-1" title="Fills the empty spots at expected cost. Your keepers and the players you added stay; a new fill replaces only the auto picks.">
        <span className="text-ink-3">Auto-fill</span>
        {STRATEGIES.map((x) => <button key={x.id} type="button" className="rowbtn h-6 rounded border border-line px-2" title={x.help} onClick={() => onFill(x.id)}>{x.label}</button>)}
        {plan.auto.size > 0 && <button type="button" className="link" onClick={() => plan.clearAuto()}>clear auto</button>}
        {plan.auto.size > 0 && <span className="text-ink-3">· <i>italic</i> = auto pick</span>}
        {plan.avoid.size > 0 && <span className="text-ink-3">· avoiding {plan.avoid.size}</span>}
        <label className="flex items-center gap-1 text-ink-3" title="Money auto-fill holds back for the 3 reach bench spots">reach $<input type="number" min={0} max={60} value={plan.reach} onChange={(e) => plan.setReach(Number(e.target.value))} className="h-6 w-10 rounded border border-line bg-panel px-1 text-right text-ink" aria-label="Money held back for reach spots" /></label>
      </div>
      {!me && <p className="text-ink-2">Pick your team in Data &amp; settings so your keepers drop in.</p>}
      {(s.problems.length > 0 || gone.length > 0) && (
        <ul className="text-loss">{[...s.problems, ...(gone.length ? [`Off the board: ${gone.join(', ')}`] : [])].map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="text-left text-ink-3"><th className="py-0.5">Spot</th><th>Player</th><th className="text-right">Bid</th><th className="text-right" title="Expected cost (bid window)">Cost</th><th className="text-right">Worth</th><th className="text-right" title="Share of mock auctions where nobody else pays more than your bid">Get</th><th /></tr></thead>
          <tbody>
            {[...s.placed.map((x) => [x.slot.label, x.pick] as const), ...s.extra.map((p) => ['Extra', p] as const)].map(([label, p], i) => {
              const r = p ? byKey.get(p.key) : undefined;
              const auto = !!p && plan.auto.has(p.key);
              return (
                <Fragment key={i}>
                <tr className="border-t border-line">
                  <td className="whitespace-nowrap py-0.5 pr-1.5 text-ink-3">{label.replace('Bench (reach)', 'Reach').replace('Bench ($1)', '$1')}</td>
                  <td className="pr-1.5">{p ? <span className="flex items-center gap-1"><span className="w-5 shrink-0 font-mono text-[10px] text-ink-3">{p.pos}</span><span className={`truncate ${auto ? 'italic text-ink-2' : ''}`} title={auto ? 'Auto pick: the next fill replaces him' : undefined}>{p.name}</span>{p.keeper && <span className="text-xs text-ink-3">keeper</span>}</span> : <span className="text-ink-3">–</span>}</td>
                  <td className="text-right">{p && !p.keeper ? <input type="number" min={1} max={maxBidFor(picks, p.key, budget)} value={p.bid} onChange={(e) => plan.setBid(p.key, Math.min(Number(e.target.value), maxBidFor(picks, p.key, budget)))} className="h-6 w-10 rounded border border-line bg-panel px-1 text-right" aria-label={`Bid for ${p.name}`} title={`Max $${maxBidFor(picks, p.key, budget)}`} /> : p ? `$${p.bid}` : ''}</td>
                  <td className="num whitespace-nowrap text-right text-ink-2" title={r ? `Window $${r.floor}–${r.ceiling}` : undefined}>{r ? `$${fmt(r.cost, 0)}` : ''}</td>
                  <td className="num text-right text-ink-2">{r ? `$${fmt(r.worth, 0)}` : ''}</td>
                  <td className="num text-right text-ink-2">{p && !p.keeper && sim?.players.get(p.key) ? `${Math.round(sim.players.get(p.key)!.get * 100)}%` : ''}</td>
                  <td className="whitespace-nowrap text-right">{p && !p.keeper && <>
                    <button type="button" className={`rowbtn h-6 px-1 ${swapping === p.key ? 'font-semibold' : 'text-ink-3'}`} aria-expanded={swapping === p.key} onClick={() => setSwapping(swapping === p.key ? null : p.key)} aria-label={`Swaps for ${p.name}`} title="Players at about his price">⇄</button>
                    {auto && <button type="button" className="rowbtn h-6 px-1" onClick={() => plan.keep(p.key)} aria-label={`Keep ${p.name} in the plan`} title="Keep: make him yours, auto-fill won't replace him">✓</button>}
                    <button type="button" className="rowbtn h-6 px-1 text-ink-3" onClick={() => plan.remove(p.key)} aria-label={`Remove ${p.name}`}>✕</button>
                  </>}</td>
                </tr>
                {p && swapping === p.key && (
                  <tr><td colSpan={7} className="pb-1.5">
                    <div className="flex flex-wrap items-center gap-1 rounded bg-sunk p-1.5">
                      <span className="text-ink-3">Swap {p.name} for</span>
                      {(() => {
                        const opts = swapOptions(rows, picks, p.key, plan.avoid, rowKey, budget);
                        return opts.length ? opts.map((o) => (
                          <button key={rowKey(o.row)} type="button" className="rowbtn h-6 rounded border border-line bg-panel px-2" onClick={() => { plan.swap(p.key, rowKey(o.row), o.bid); setSwapping(null); }} aria-label={`Swap in ${o.row.name}`} title={`Over replacement ${o.dVorp >= 0 ? '+' : ''}${o.dVorp} pts`}>
                            {o.row.name} <span className="num text-ink-3">${o.bid} ({o.dCost >= 0 ? '+' : '−'}${Math.abs(o.dCost)}, {o.dVorp >= 0 ? '+' : ''}{o.dVorp} pts)</span>
                          </button>
                        )) : <span className="text-ink-3">no one at about his price</span>;
                      })()}
                    </div>
                  </td></tr>
                )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-1 border-t border-line pt-2">
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const n = name.trim(); if (n) { plan.saveAs(n); setName(''); } }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this plan" maxLength={24} className="h-6 w-28 rounded border border-line bg-panel px-1.5" aria-label="Plan name" />
          <button type="submit" disabled={!name.trim()} className="rowbtn h-6 rounded border border-line px-2 disabled:opacity-40">Save</button>
        </form>
        {plan.savedNames.map((n) => (
          <span key={n} className="flex items-center rounded border border-line">
            <button type="button" className="rowbtn h-6 px-2" onClick={() => plan.load(n)} title="Load this plan (replaces the current one)" aria-label={`Load plan ${n}`}>{n}</button>
            <button type="button" className="rowbtn h-6 px-1 text-ink-3" onClick={() => plan.drop(n)} aria-label={`Delete plan ${n}`}>✕</button>
          </span>
        ))}
        {Object.keys(plan.bids).length > 0 && <button type="button" className="link ml-auto" onClick={() => plan.clear()}>Clear</button>}
      </div>
    </div>
  );
}
