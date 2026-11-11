import type { PlayerId, Pos, TeamId } from '../data/schema.ts';
import { lineup, type Values } from './model.ts';
import { partnerEdge } from './trade.ts';

// Trade finder, ported from the Sandbox's three modes:
//   want  - players you tagged as wanted, plus at most one filler from the same team
//   sell  - players you tagged to sell, offered to every team (plus a sweetener when it helps)
//   pos   - any offer that brings back a player at the position you need
// The search is pure and keyed by finderKey(); the UI caches results by that key so expanding a team
// card or paging offers never reruns it (audit PERF-2).

export interface FinderQuery {
  team: TeamId;
  pos: Pos | 'ANY';
  sell: PlayerId[];
  keep: PlayerId[];
  want: PlayerId[];
  gap: number; // -10 (you win on paper by 10+) .. +10 (partner wins by 10+)
  maxLoss: number; // pts/wk of your lineup you'll give up
  partner: TeamId | 'all';
  sort: 'me' | 'winwin';
}

export interface Offer {
  give: PlayerId[];
  get: PlayerId[];
  myGain: number;
  theirGain: number;
  edge: number; // partner's on-paper view
  score: number;
}

export interface TeamOffers {
  team: TeamId;
  offers: Offer[];
  count: number;
  best: number;
}

export const finderKey = (q: FinderQuery, valuesVersion: number) =>
  JSON.stringify([valuesVersion, q.team, q.pos, [...q.sell].sort(), [...q.keep].sort(), [...q.want].sort(), q.gap, q.maxLoss, q.partner, q.sort]);

export const hasInput = (q: FinderQuery) => q.want.length > 0 || q.sell.length > 0 || q.pos !== 'ANY';

const PER_TEAM = 12;

export function combos<T>(a: T[], maxN: number): T[][] {
  const out: T[][] = [];
  const rec = (i: number, cur: T[]) => {
    if (cur.length) out.push([...cur]);
    if (cur.length === maxN) return;
    for (let j = i; j < a.length; j++) { cur.push(a[j]!); rec(j + 1, cur); cur.pop(); }
  };
  rec(0, []);
  return out;
}

export function findTrades(V: Values, q: FinderQuery): TeamOffers[] {
  const { idx } = V.base;
  const FT = q.team;
  const ok = (k: PlayerId) => !V.base.isOut(k) && V.bv(k) > 2;
  const byValue = (a: PlayerId, b: PlayerId) => V.bv(b) - V.bv(a);
  const roster = (t: TeamId) => idx.roster.get(t) ?? [];
  const pos = q.pos === 'ANY' ? null : q.pos;
  const posOf = (k: PlayerId) => idx.players.get(k)?.pos;
  const gapC = Math.max(-10, Math.min(10, q.gap));

  const judge = (partner: TeamId, give: PlayerId[], get: PlayerId[]): Offer | null => {
    const edge = partnerEdge(V, partner, get, give);
    if (q.gap >= 10 ? edge < 10 : q.gap <= -10 ? edge > -10 : Math.abs(edge - q.gap) > 2.5) return null;
    const myGain = V.weekGain(FT, give, get);
    if (myGain < -q.maxLoss || (myGain < 0.2 && q.maxLoss === 0)) return null;
    const theirGain = V.weekGain(partner, get, give);
    if (theirGain < -8) return null; // don't gut his lineup; he won't take it
    const spread = Math.abs(edge - gapC);
    const score = q.sort === 'winwin' ? myGain + 0.6 * theirGain - 0.15 * spread : myGain - 0.15 * spread;
    return { give, get, myGain, theirGain, edge, score };
  };
  const rank = (res: Offer[], sig: (o: Offer) => string) => {
    res.sort((a, b) => b.score - a.score || b.theirGain - a.theirGain);
    const seen = new Set<string>(), top: Offer[] = [];
    for (const o of res) {
      const s = sig(o);
      if (seen.has(s)) continue;
      seen.add(s);
      top.push(o);
      if (top.length >= PER_TEAM) break;
    }
    return top;
  };
  const partners = idx.teamIds.filter((t) => t !== FT && (q.partner === 'all' || q.partner === t));
  const mine = (n: number, exclude: PlayerId[] = []) => roster(FT).filter((k) => ok(k) && !q.keep.includes(k) && !exclude.includes(k)).sort(byValue).slice(0, n);
  const out: TeamOffers[] = [];

  if (q.want.length) {
    const pool = mine(10);
    const gives = q.sell.length
      ? combos([...q.sell, ...pool.filter((k) => !q.sell.includes(k))].slice(0, Math.max(10, q.sell.length)), 3).filter((g) => g.some((k) => q.sell.includes(k)))
      : combos(pool, 3);
    const by = new Map<TeamId, { res: Offer[]; n: number }>();
    for (const T of q.want) {
      const team = idx.owner.get(T);
      if (team === undefined || team === FT || !partners.includes(team)) continue;
      const fill = roster(team).filter((k) => k !== T && ok(k)).sort(byValue).slice(0, 8);
      const gets = [[T], ...fill.map((f) => [T, f])];
      const res: Offer[] = [];
      for (const give of gives) for (const get of gets) { const o = judge(team, give, get); if (o) res.push(o); }
      const g = by.get(team) ?? { res: [], n: 0 };
      g.res.push(...rank(res, (o) => o.give.join() + '|' + o.get.join()));
      g.n += res.length;
      by.set(team, g);
    }
    for (const [team, g] of by) if (g.res.length) out.push({ team, offers: rank(g.res, (o) => o.give.join() + '|' + o.get.join()), count: g.n, best: Math.max(...g.res.map((o) => o.score)) });
  } else if (q.sell.length) {
    const pool = mine(10, q.sell);
    const subs = combos(q.sell, 3), small = subs.filter((g) => g.length < 3);
    const nf = Math.max(0, Math.min(10, Math.floor((60 - subs.length) / Math.max(small.length, 1))));
    const gives = [...subs, ...small.flatMap((g) => pool.slice(0, nf).map((f) => [...g, f]))];
    for (const team of partners) {
      let cand = roster(team).filter(ok).sort(byValue).slice(0, q.partner === 'all' ? 8 : 10);
      if (pos) cand = [...new Set([...roster(team).filter((k) => ok(k) && posOf(k) === pos).sort(byValue).slice(0, 4), ...cand])];
      const gets = combos(cand, 2).filter((g) => !pos || g.some((k) => posOf(k) === pos));
      const res: Offer[] = [];
      for (const give of gives) for (const get of gets) { const o = judge(team, give, get); if (o) res.push(o); }
      if (res.length) { const top = rank(res, (o) => o.get.join()); out.push({ team, offers: top, count: res.length, best: top[0]!.score }); }
    }
  } else if (pos) {
    const gives = combos(mine(8), 3);
    for (const team of partners) {
      const pc = roster(team).filter((k) => ok(k) && posOf(k) === pos).sort(byValue).slice(0, 4);
      if (!pc.length) continue;
      const oth = roster(team).filter((k) => ok(k) && !pc.includes(k)).sort(byValue).slice(0, 6);
      const gets = [...pc.map((k) => [k]), ...combos(pc, 2).filter((g) => g.length === 2), ...pc.flatMap((k) => oth.map((o) => [k, o]))];
      const res: Offer[] = [];
      for (const give of gives) for (const get of gets) { const o = judge(team, give, get); if (o) res.push(o); }
      if (res.length) { const top = rank(res, (o) => o.get.join()); out.push({ team, offers: top, count: res.length, best: top[0]!.score }); }
    }
  }
  return out.sort((a, b) => b.best - a.best);
}

// Each team's weakest lineup spot against the league average, and the best bench player it could
// spare (old app's teamNeed). Groups follow the lineup: QB, RB, WR, WR/TE, FLEX.
export interface TeamNeed { slot: string; pct: number; spare: PlayerId | null }
export function teamNeeds(V: Values): Map<TeamId, TeamNeed> {
  const { base } = V;
  const { idx } = base;
  const label = (s: readonly string[]) => (s.length > 2 ? 'FLEX' : s.join('/'));
  const by = new Map<TeamId, Map<string, number>>();
  const starters = new Map<TeamId, Set<PlayerId>>();
  for (const t of idx.teamIds) {
    const L = lineup(base, (idx.roster.get(t) ?? []).filter((p) => !base.isOut(p)), () => 1);
    const g = new Map<string, number>();
    for (const x of L.slots) g.set(label(x.slot), (g.get(label(x.slot)) ?? 0) + x.v);
    by.set(t, g);
    starters.set(t, new Set(L.slots.map((x) => x.pid).filter((p): p is PlayerId => !!p)));
  }
  const keys = [...by.get(idx.teamIds[0]!)!.keys()];
  const avg = new Map(keys.map((k) => [k, idx.teamIds.reduce((s, t) => s + by.get(t)!.get(k)!, 0) / idx.teamIds.length]));
  return new Map(idx.teamIds.map((t) => {
    const worst = keys.map((k) => ({ slot: k, pct: ((by.get(t)!.get(k)! - avg.get(k)!) / Math.max(avg.get(k)!, 1)) * 100 })).sort((a, b) => a.pct - b.pct)[0]!;
    const spare = (idx.roster.get(t) ?? []).filter((p) => !starters.get(t)!.has(p) && !base.isOut(p) && idx.players.get(p)?.pos !== 'QB').sort((a, b) => V.bv(b) - V.bv(a))[0] ?? null;
    return [t, { ...worst, spare }];
  }));
}
export const fitsSlot = (pos: string, slot: string) => (slot === 'FLEX' ? pos !== 'QB' : slot.split('/').includes(pos));
