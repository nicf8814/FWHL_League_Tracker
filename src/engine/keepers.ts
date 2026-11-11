import type { PlayerId, Pos } from '../data/schema.ts';
import { POSITIONS } from '../data/schema.ts';
import type { Base } from './model.ts';

// Keeper calls, ported from the old app's kEval: rank each player by points per week at his position,
// read what that rank went for in this league's auctions (non-keepers, 2023-2026), and compare to his
// keeper cost. A player who doesn't beat a replacement starter isn't worth a slot at any price.
export type KeeperLabel = 'lock' | 'legit' | 'border' | 'no' | 'none';
export interface KeeperCall { pid: PlayerId; cost: number | null; ppw: number; rank: number; worth: number; surplus: number | null; par: number; label: KeeperLabel; note: string }

export function keeperCalls(base: Base): Map<PlayerId, KeeperCall> {
  const { idx } = base;
  const S = idx.ds.season;
  const pool = Object.fromEntries(POSITIONS.map((p) => [p, [] as number[]])) as Record<Pos, number[]>;
  for (const [pid, v] of base.proj) { const pos = idx.players.get(pid)?.pos; if (pos && v > 0) pool[pos].push(v); }
  for (const p of POSITIONS) pool[p].sort((a, b) => b - a);
  const out = new Map<PlayerId, KeeperCall>();
  for (const K of idx.ds.keepers) {
    const pos = idx.players.get(K.playerId)?.pos;
    if (!pos) continue;
    const ppw = base.proj.get(K.playerId) ?? 0;
    const rep = pool[pos][S.replacementRank[pos] - 1] ?? 0;
    const rank = pool[pos].filter((v) => v > ppw).length + 1;
    const curve = S.keeper.priceByPositionRank[pos] ?? [];
    const worth = Math.round(curve[rank - 1] ?? 1);
    const par = ppw - rep;
    const surplus = K.cost === null ? null : worth - K.cost;
    const label: KeeperLabel = K.cost === null ? 'none' : K.contractYear === 2 ? 'lock' : par <= 0 ? 'no' : surplus! >= 10 ? 'legit' : surplus! >= 0 ? 'border' : 'no';
    out.set(K.playerId, { pid: K.playerId, cost: K.cost, ppw, rank, worth, surplus, par, label, note: K.note });
  }
  return out;
}

// A roster's keepers: locked contracts first, then the best legit/borderline calls, up to the slots.
export function keeperSet(calls: Map<PlayerId, KeeperCall>, roster: PlayerId[], slots: number): PlayerId[] {
  const c = roster.map((p) => calls.get(p)).filter((x): x is KeeperCall => !!x);
  const locks = c.filter((x) => x.label === 'lock').map((x) => x.pid);
  const rest = c.filter((x) => x.label === 'legit' || x.label === 'border').sort((a, b) => b.surplus! - a.surplus!).map((x) => x.pid);
  return [...locks, ...rest].slice(0, Math.max(slots, locks.length));
}
