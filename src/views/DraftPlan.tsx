// Draft plan panel on the Draft prep page: Nic's 13-man target roster. His flagged keepers drop in at
// their keeper cost; "+" on a board row adds a player at his expected cost, and every bid can be typed.
// No bid can break the max-bid rule (Art. IV): typed bids stop at the max, and + is off at $0.
// Auto-fill (engine/autoFill.ts) rebuilds everything but keepers and locked players; avoided players
// are never picked. The plan lives in this browser (localStorage), one per draft year.
import { useState } from 'react';
import { playerKey } from '../data/drafts.ts';
import { STRATEGIES, type Strategy } from '../engine/autoFill.ts';
import type { PrepRow } from '../engine/draftPrep.ts';
import { maxBidFor, placePlan, type PlanPick } from '../engine/rosterPlan.ts';
import { fmt, PosMark } from '../ui/components.tsx';

const PLAN_KEY = 'fwhl-draft-plan'; // { year: { bids: { playerKey: bid }, locks: [], avoid: [] } }
interface YearPlan { bids: Record<string, number>; locks: string[]; avoid: string[] }
type Plans = Record<string, YearPlan>;
const blank: YearPlan = { bids: {}, locks: [], avoid: [] };
const read = (): Plans => {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAN_KEY) ?? '{}') as Record<string, unknown>;
    // part A saved just the bids
    return Object.fromEntries(Object.entries(raw).map(([y, v]) => [y, v && typeof v === 'object' && 'bids' in v ? { ...blank, ...(v as YearPlan) } : { ...blank, bids: v as Record<string, number> }]));
  } catch { return {}; }
};
const save = (p: Plans) => { try { localStorage.setItem(PLAN_KEY, JSON.stringify(p)); } catch { /* lasts for this visit */ } };

export const rowKey = (r: PrepRow) => playerKey(r.name, r.pos);

export function usePlan(year: number) {
  const [all, setAll] = useState<Plans>(read);
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
    locks: new Set(mine.locks),
    avoid: new Set(mine.avoid),
    has: (k: string) => k in mine.bids,
    add: (k: string, bid: number) => put((y) => ({ bids: { ...y.bids, [k]: Math.max(1, Math.round(bid)) }, avoid: y.avoid.filter((x) => x !== k) })),
    setBid: (k: string, bid: number) => put((y) => ({ bids: { ...y.bids, [k]: Math.max(1, Math.round(bid) || 1) } })),
    remove: (k: string) => put((y) => ({ bids: without(y, k), locks: y.locks.filter((x) => x !== k) })),
    lock: (k: string, on: boolean) => put((y) => ({ locks: on ? [...new Set([...y.locks, k])] : y.locks.filter((x) => x !== k) })),
    setAvoid: (k: string, on: boolean) => put((y) => (on ? { avoid: [...new Set([...y.avoid, k])], bids: without(y, k), locks: y.locks.filter((x) => x !== k) } : { avoid: y.avoid.filter((x) => x !== k) })),
    replace: (bids: Record<string, number>) => put(() => ({ bids })),
    clear: () => put(() => ({ bids: {}, locks: [] })),
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

const btn = 'rowbtn h-7 rounded border border-line px-2 text-xs disabled:opacity-40';

export function PlanButton({ row, plan, mine, maxBid, full }: { row: PrepRow; plan: Plan; mine: boolean; maxBid: number; full: boolean }) {
  const k = rowKey(row);
  if (mine) return <span className="text-xs text-ink-3">yours</span>;
  if (row.keeper) return null;
  if (plan.has(k)) return <button type="button" className={btn} onClick={() => plan.remove(k)} aria-label={`Take ${row.name} off the plan`}>✓ planned</button>;
  if (plan.avoid.has(k)) return <button type="button" className={`${btn} text-ink-3`} onClick={() => plan.setAvoid(k, false)} aria-label={`Stop avoiding ${row.name}`} title="Auto-fill skips him. Click to undo.">avoided</button>;
  return (
    <span className="flex gap-1">
      <button type="button" disabled={maxBid < 1 || full} title={maxBid < 1 ? 'No money or spot left' : full ? `No open spot for a ${row.pos}` : undefined} className={btn} onClick={() => plan.add(k, Math.min(Math.max(1, row.cost), maxBid))} aria-label={`Add ${row.name} to the plan`}>+ plan</button>
      <button type="button" className={`${btn} text-ink-3`} onClick={() => plan.setAvoid(k, true)} aria-label={`Avoid ${row.name}`} title="Never auto-fill him">avoid</button>
    </span>
  );
}

export function PlanPanel({ rows, me, plan, budget, onFill }: { rows: PrepRow[]; me: string | null; plan: Plan; budget: number; onFill: (s: Strategy) => void }) {
  const { picks, gone, byKey } = planPicks(rows, me, plan.bids);
  const s = placePlan(picks, budget);
  return (
    <div className="grid gap-3 rounded border border-line p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">My plan{me ? ` (${me})` : ''}</h3>
        <p className="num text-sm">${s.spent} of ${budget} · ${s.left} left · {s.open} open · <b>max bid ${Math.max(0, s.maxBid)}</b></p>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-ink-2">Auto-fill:</span>
        {STRATEGIES.map((x) => <button key={x.id} type="button" className="rowbtn h-8 rounded border border-line px-3" title={x.help} onClick={() => onFill(x.id)}>{x.label}</button>)}
        <span className="text-xs text-ink-3">Keepers and locked players stay; the rest is rebuilt at expected cost.{plan.avoid.size ? ` Avoiding ${plan.avoid.size}.` : ''}</span>
      </div>
      {!me && <p className="text-sm text-ink-2">Pick your team in Data &amp; settings so your keepers drop in.</p>}
      {(s.problems.length > 0 || gone.length > 0) && (
        <ul className="text-sm text-loss">{[...s.problems, ...(gone.length ? [`Off the board: ${gone.join(', ')}`] : [])].map((p) => <li key={p}>{p}</li>)}</ul>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead><tr className="text-left text-ink-3"><th className="py-1">Spot</th><th>Player</th><th className="text-right">Bid</th><th className="text-right">Cost (window)</th><th className="text-right">Worth</th><th /></tr></thead>
          <tbody>
            {[...s.placed.map((x) => [x.slot.label, x.pick] as const), ...s.extra.map((p) => ['Extra', p] as const)].map(([label, p], i) => {
              const r = p ? byKey.get(p.key) : undefined;
              const locked = !!p && plan.locks.has(p.key);
              return (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 pr-2 text-ink-2">{label}</td>
                  <td className="pr-2">{p ? <span className="flex items-center gap-2"><PosMark pos={p.pos} />{p.name}{p.keeper && <span className="text-xs text-ink-3">keeper</span>}</span> : <span className="text-ink-3">–</span>}</td>
                  <td className="text-right">{p && !p.keeper ? <input type="number" min={1} max={maxBidFor(picks, p.key, budget)} value={p.bid} onChange={(e) => plan.setBid(p.key, Math.min(Number(e.target.value), maxBidFor(picks, p.key, budget)))} className="h-8 w-16 rounded border border-line bg-panel px-2 text-right" aria-label={`Bid for ${p.name}`} title={`Max $${maxBidFor(picks, p.key, budget)}`} /> : p ? `$${p.bid}` : ''}</td>
                  <td className="num text-right text-ink-2">{r ? `$${fmt(r.cost, 0)} ($${r.floor}–${r.ceiling})` : ''}</td>
                  <td className="num text-right text-ink-2">{r ? `$${fmt(r.worth, 0)}` : ''}</td>
                  <td className="whitespace-nowrap text-right">{p && !p.keeper && <>
                    <button type="button" className={`rowbtn h-7 px-2 text-xs ${locked ? 'font-semibold' : 'text-ink-3'}`} aria-pressed={locked} onClick={() => plan.lock(p.key, !locked)} aria-label={`${locked ? 'Unlock' : 'Lock'} ${p.name}`} title={locked ? 'Locked: auto-fill keeps him' : 'Lock him through auto-fill'}>{locked ? 'locked' : 'lock'}</button>
                    <button type="button" className="rowbtn h-7 px-2 text-xs text-ink-3" onClick={() => plan.remove(p.key)} aria-label={`Remove ${p.name}`}>✕</button>
                  </>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {Object.keys(plan.bids).length > 0 && <button type="button" className="link justify-self-start text-sm" onClick={() => plan.clear()}>Clear the plan</button>}
    </div>
  );
}
