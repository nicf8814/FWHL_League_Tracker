import { useId, useMemo, useState } from 'react';
import type { PlayerId, SavedTrade, TeamId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { teamName } from '../engine/league.ts';
import { evaluate, tradeToQuery, type Evaluation } from '../engine/trade.ts';
import { href } from '../app/router.ts';
import { Empty, fmt, signed, tone } from '../ui/components.tsx';

// Saved trades (audit FEAT-2): name, rename, duplicate, delete, and compare two or three side by side.
// They live on this device (IndexedDB) and travel in backup files.

const MAX_COMPARE = 3;
const newId = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);

export function autoName(idx: ReturnType<typeof useLeague>['idx'], t: { a: TeamId; b: TeamId; aGives: PlayerId[]; bGives: PlayerId[] }) {
  const last = (ids: PlayerId[]) => ids.map((p) => idx.players.get(p)?.name.split(' ').slice(-1)[0] ?? '?').join(', ') || 'nothing';
  return `${teamName(idx, t.a)}: ${last(t.aGives)} for ${last(t.bGives)} (${teamName(idx, t.b)})`.slice(0, 80);
}

export function SaveTradeButton({ trade }: { trade: { a: TeamId; b: TeamId | null; aGives: PlayerId[]; bGives: PlayerId[] } }) {
  const { idx, savedTrades, setSavedTrades } = useLeague();
  const [msg, setMsg] = useState('');
  const { a, b, aGives, bGives } = trade;
  if (b === null || (!aGives.length && !bGives.length)) return null;
  const same = savedTrades.find((s) => s.a === a && s.b === b && s.aGives.join() === aGives.join() && s.bGives.join() === bGives.join());
  const save = () => {
    const t: SavedTrade = { id: newId(), name: autoName(idx, { a, b, aGives, bGives }), savedAt: new Date().toISOString(), a, b, aGives, bGives };
    setSavedTrades((l) => [t, ...l]);
    setMsg('Saved below.');
  };
  return (
    <div className="grid justify-items-center gap-1">
      <button type="button" className="btn" onClick={save} disabled={!!same}>{same ? 'Saved' : 'Save this trade'}</button>
      <span className="text-xs text-ink-3" role="status">{same ? `As "${same.name}"` : msg}</span>
    </div>
  );
}

export function SavedTrades() {
  const { idx, values: V, savedTrades, setSavedTrades } = useLeague();
  const [picked, setPicked] = useState<string[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const heading = useId();
  const live = picked.filter((id) => savedTrades.some((s) => s.id === id));
  // A saved trade is scored on today's rosters: players who moved since are flagged, not silently dropped.
  const scored = useMemo(() => new Map(savedTrades.map((s) => {
    const moved = [...s.aGives.filter((p) => idx.owner.get(p) !== s.a), ...s.bGives.filter((p) => idx.owner.get(p) !== s.b)];
    return [s.id, { moved, ev: moved.length ? null : evaluate(V, s) }];
  })), [savedTrades, V, idx]);

  const update = (id: string, patch: Partial<SavedTrade>) => setSavedTrades((l) => l.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const remove = (id: string) => { setSavedTrades((l) => l.filter((s) => s.id !== id)); setPicked((p) => p.filter((x) => x !== id)); };
  const duplicate = (s: SavedTrade) => setSavedTrades((l) => { const i = l.indexOf(s); const c = { ...s, id: newId(), name: `${s.name} (copy)`.slice(0, 80), savedAt: new Date().toISOString() }; return [...l.slice(0, i + 1), c, ...l.slice(i + 1)]; });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= MAX_COMPARE ? p : [...p, id]));

  return (
    <section aria-labelledby={heading} className="grid gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-1">
        <h2 id={heading} className="text-lg">Saved trades</h2>
        <span className="text-sm text-ink-3">{savedTrades.length ? `Tick two or three to compare` : ''}</span>
      </div>
      {!savedTrades.length ? (
        <Empty>Save a trade from the verdict panel to keep it here. Saved trades stay on this device and go into backups.</Empty>
      ) : (
        <ul className="grid">
          {savedTrades.map((s) => {
            const r = scored.get(s.id)!;
            const on = live.includes(s.id);
            return (
              <li key={s.id} className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3 border-b border-rule py-2">
                <input type="checkbox" className="mt-3 size-5 accent-[var(--color-primary)]" aria-label={`Compare ${s.name}`} checked={on} disabled={!on && live.length >= MAX_COMPARE} onChange={() => toggle(s.id)} />
                <div className="grid gap-1">
                  {editing === s.id ? (
                    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const v = String(new FormData(e.currentTarget).get('name') ?? '').trim(); if (v) update(s.id, { name: v.slice(0, 80) }); setEditing(null); }}>
                      <label className="sr-only" htmlFor={`n-${s.id}`}>Name</label>
                      <input id={`n-${s.id}`} name="name" className="field min-w-0 flex-1" defaultValue={s.name} maxLength={80} autoFocus onKeyDown={(e) => e.key === 'Escape' && setEditing(null)} />
                      <button className="btn">Save</button>
                    </form>
                  ) : (
                    <a className="link min-h-11 py-2 font-medium" href={href('analyzer', tradeToQuery(s))}>{s.name}</a>
                  )}
                  <p className="num text-sm text-ink-2">
                    {r.moved.length ? <span className="text-even">{r.moved.map((p) => idx.players.get(p)?.name ?? p).join(', ')} changed teams since this was saved</span>
                      : r.ev && !r.ev.errors.length ? <><span className={r.ev.fairBoth ? 'text-even' : r.ev.verdict.kind === 'win' ? 'text-gain' : r.ev.verdict.kind === 'lose' ? 'text-loss' : 'text-even'}>{r.ev.fairBoth ? 'Fair for both' : r.ev.verdict.label}</span> · {signed(r.ev.verdict.diff)} value · <span className={tone(r.ev.gainA)}>{signed(r.ev.gainA)} pts/wk</span></>
                      : 'Can\'t be scored'}
                  </p>
                  <div className="flex flex-wrap gap-1 text-sm">
                    <button type="button" className="btn btn-quiet" onClick={() => setEditing(s.id)}>Rename</button>
                    <button type="button" className="btn btn-quiet" onClick={() => duplicate(s)}>Duplicate</button>
                    <button type="button" className="btn btn-quiet text-loss" onClick={() => remove(s.id)}>Delete</button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {live.length >= 2 && <Compare list={live.map((id) => savedTrades.find((s) => s.id === id)!)} evs={live.map((id) => scored.get(id)!.ev)} />}
    </section>
  );
}

function Compare({ list, evs }: { list: SavedTrade[]; evs: (Evaluation | null)[] }) {
  const { idx, values: V } = useLeague();
  const rows: [string, (s: SavedTrade, e: Evaluation) => React.ReactNode][] = [
    ['Verdict', (_, e) => (e.fairBoth ? 'Fair for both' : e.verdict.label)],
    ['Value edge', (_, e) => <span className={tone(e.verdict.diff)}>{signed(e.verdict.diff)}</span>],
    ['You send', (_, e) => fmt(e.value.aSends)],
    ['You get', (_, e) => fmt(e.value.bSends)],
    ['Your lineup', (_, e) => <span className={tone(e.gainA)}>{signed(e.gainA)}/wk</span>],
    ['Their lineup', (_, e) => <span className={tone(e.gainB)}>{signed(e.gainB)}/wk</span>],
    ['They see', (_, e) => signed(e.partnerEdge)],
    ['Above repl.', (_, e) => `${fmt(e.aboveRepl.aSends)} → ${fmt(e.aboveRepl.bSends)}`],
    ['Keepers ($)', (s) => { const d = V.keeperValue(V.rosterAfter(s.a, s.aGives, s.bGives)) - V.keeperValue(idx.roster.get(s.a) ?? []); return Math.abs(d) < 0.5 ? 'No change' : <span className={tone(d)}>{signed(d)}</span>; }],
  ];
  return (
    <div className="overflow-x-auto">
      <table className="tbl">
        <caption className="mb-2 text-left text-sm text-ink-3">From the first team's side, on today's values.</caption>
        <thead>
          <tr><th className="l">Trade</th>{list.map((s) => <th key={s.id} className="max-w-48 whitespace-normal">{s.name}<span className="block text-xs font-normal text-ink-3">{teamName(idx, s.a)} ⇄ {teamName(idx, s.b)}</span></th>)}</tr>
        </thead>
        <tbody>
          {rows.map(([label, f]) => (
            <tr key={label}>
              <th scope="row" className="l font-normal">{label}</th>
              {list.map((s, i) => { const e = evs[i]; return <td key={s.id} className="n">{e && !e.errors.length ? f(s, e) : '–'}</td>; })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
