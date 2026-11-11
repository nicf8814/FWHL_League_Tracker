import { useDeferredValue, useMemo, useState } from 'react';
import type { Pos, TeamId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { teamName } from '../engine/league.ts';
import { fmt, PlayerName, POS_OPTIONS, Seg, signed } from '../ui/components.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

const PAGE = 100;

export default function Players() {
  const { idx, values: V, base, settings } = useLeague();
  const open = usePlayerSheet();
  const [pos, setPos] = useState<Pos | 'ANY'>('ANY');
  const [q, setQ] = useState('');
  const [who, setWho] = useState<'all' | 'rostered' | 'fa' | `${TeamId}`>('all');
  const [limit, setLimit] = useState(PAGE);
  const term = useDeferredValue(q.trim().toLowerCase());

  const rows = useMemo(() => {
    return [...idx.players.values()]
      .filter((p) => V.blend(p.id).sources > 0 || base.proj.get(p.id))
      .filter((p) => pos === 'ANY' || p.pos === pos)
      .filter((p) => !term || p.name.toLowerCase().includes(term) || p.aliases.some((a) => a.includes(term.replace(/[^a-z]/g, ''))))
      .filter((p) => {
        const o = idx.owner.get(p.id);
        return who === 'all' ? true : who === 'rostered' ? o !== undefined : who === 'fa' ? o === undefined : o === Number(who);
      })
      .sort((a, b) => V.bv(b.id) - V.bv(a.id));
  }, [idx, V, base, pos, term, who]);

  return (
    <div className="grid grid-cols-1 gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Seg label="Position" value={pos} options={POS_OPTIONS} onChange={(v) => { setPos(v); setLimit(PAGE); }} />
        <label className="grid gap-1 text-sm text-ink-3">
          Owner
          <select className="field w-auto" value={who} onChange={(e) => { setWho(e.target.value as typeof who); setLimit(PAGE); }}>
            <option value="all">Everyone</option>
            <option value="rostered">Rostered</option>
            <option value="fa">Free agents</option>
            {idx.ds.teams.map((t) => <option key={t.id} value={t.id}>{t.name}{t.id === settings.myTeamId ? ' (mine)' : ''}</option>)}
          </select>
        </label>
        <label className="grid min-w-[12rem] flex-1 gap-1 text-sm text-ink-3 sm:max-w-xs">
          Search
          <input className="field" type="search" value={q} onChange={(e) => { setQ(e.target.value); setLimit(PAGE); }} placeholder="Player name" />
        </label>
        <p className="num ml-auto text-sm text-ink-3" role="status">{rows.length} players</p>
      </div>
      <div className="-mx-4 overflow-x-auto md:mx-0">
        <table className="tbl min-w-[60rem]">
          <thead>
            <tr>
              <th className="l w-10">#</th>
              <th className="l stick min-w-[11rem]">Player</th>
              <th className="l">Pos</th>
              <th className="l">Owner</th>
              <th>Value</th>
              <th>Market</th>
              <th>Model</th>
              <th>Pts/wk</th>
              <th>Above repl.</th>
              <th>Peaked</th>
              <th>Menton</th>
              <th>FPros</th>
              <th>Keep '27</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, limit).map((p, i) => {
              const b = V.blend(p.id);
              const k = idx.keeper.get(p.id);
              const o = idx.owner.get(p.id);
              return (
                <tr key={p.id} className={o !== undefined && o === settings.myTeamId ? 'bg-primary-soft' : ''}>
                  <td className="l n text-ink-3">{i + 1}</td>
                  <td className={`l stick ${o !== undefined && o === settings.myTeamId ? '!bg-primary-soft' : ''}`}><PlayerName pid={p.id} onOpen={open} /></td>
                  <td className="l n text-ink-3">{p.pos}</td>
                  <td className="l text-ink-2">{o === undefined ? 'FA' : teamName(idx, o)}</td>
                  <td className="n font-semibold">{fmt(b.v)}</td>
                  <td className="n">{fmt(b.market)}</td>
                  <td className="n">{fmt(b.model)}</td>
                  <td className="n">{fmt(base.proj.get(p.id))}</td>
                  <td className="n">{signed(V.aboveReplacement(p.id))}</td>
                  <td className="n text-ink-2">{fmt(V.chart(p.id, 'peaked'))}</td>
                  <td className="n text-ink-2">{fmt(V.chart(p.id, 'menton'))}</td>
                  <td className="n text-ink-2">{fmt(V.chart(p.id, 'fantasypros'))}</td>
                  <td className="n">{k ? (k.cost === null ? 'No' : `$${k.cost}`) : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {rows.length > limit && <button type="button" className="btn justify-self-start" onClick={() => setLimit((l) => l + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more</button>}
    </div>
  );
}
