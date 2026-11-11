import type { PlayerId, TeamId } from '../data/schema.ts';
import type { Index } from './league.ts';
import type { Values } from './model.ts';

// A trade is exactly two teams, each sending players it owns today (audit LOGIC-4).
export interface Trade {
  a: TeamId;
  b: TeamId;
  aGives: PlayerId[];
  bGives: PlayerId[];
}

export const MAX_PER_SIDE = 6;

export function validateTrade(t: Trade, idx: Index): string[] {
  const errs: string[] = [];
  if (!idx.teams.has(t.a) || !idx.teams.has(t.b)) errs.push('Pick two teams.');
  if (t.a === t.b) errs.push('A trade needs two different teams.');
  const all = [...t.aGives, ...t.bGives];
  if (new Set(all).size !== all.length) errs.push('A player can only be in the trade once.');
  if (t.aGives.length > MAX_PER_SIDE || t.bGives.length > MAX_PER_SIDE) errs.push(`Up to ${MAX_PER_SIDE} players per side.`);
  const wrong = (side: PlayerId[], team: TeamId) => side.filter((p) => idx.owner.get(p) !== team);
  for (const p of [...wrong(t.aGives, t.a), ...wrong(t.bGives, t.b)]) {
    const pl = idx.players.get(p);
    errs.push(pl ? `${pl.name} is not on that team's roster.` : `Unknown player ${p}.`);
  }
  return errs;
}

export interface Verdict {
  kind: 'win' | 'lose' | 'fair';
  label: string;
  diff: number;
  pct: number;
}

export function verdict(give: number, get: number): Verdict {
  const diff = get - give, pct = (diff / Math.max(give, get, 1)) * 100;
  if (Math.abs(pct) < 6) return { kind: 'fair', label: 'Fair', diff, pct };
  if (pct > 0) return { kind: 'win', label: pct > 18 ? 'Clear win' : 'Slight win', diff, pct };
  return { kind: 'lose', label: pct < -18 ? 'Clear loss' : 'Slight loss', diff, pct };
}

// Side totals. When one side sends more players, its extra (lowest) players count only above the
// best healthy free agent at their position.
export function totals(V: Values, give: PlayerId[], get: PlayerId[], fn: (p: PlayerId) => number) {
  const side = (arr: PlayerId[], other: PlayerId[]) => {
    const vals = arr.map((p) => [p, fn(p) || 0] as const);
    const extra = arr.length - other.length;
    if (extra <= 0) return vals.reduce((s, [, v]) => s + v, 0);
    const pos = (p: PlayerId) => V.base.idx.players.get(p)!.pos;
    return [...vals].sort((x, y) => x[1] - y[1]).reduce((s, [p, v], i) => s + (i < extra ? Math.max(0, v - V.faReplacement[pos(p)]) : v), 0);
  };
  return { give: side(give, get), get: side(get, give) };
}

// What a team asks for the players it sends: their value, plus keeper surplus it loses and any stud premium.
export function asking(V: Values, team: TeamId, sends: PlayerId[], gets: PlayerId[]): number {
  const T = totals(V, sends, gets, (p) => V.blend(p).ev);
  const r = V.base.idx.roster.get(team) ?? [];
  return T.give + Math.max(0, -V.studPremium(sends, gets)) + V.keepWeight(team) * V.keepConv * (V.keeperValue(r) - V.keeperValue(r.filter((z) => !sends.includes(z))));
}

// How the receiving team sees the deal by its own values: > 0 means it thinks it wins.
export function partnerEdge(V: Values, team: TeamId, sends: PlayerId[], gets: PlayerId[]): number {
  const T = totals(V, sends, gets, (p) => V.blend(p).ev + V.injuryCorrection(p, team));
  const r = V.base.idx.roster.get(team) ?? [];
  const after = r.filter((k) => !sends.includes(k)).concat(gets.filter((k) => !r.includes(k)));
  return T.get - T.give + V.studPremium(sends, gets) + V.keepWeight(team) * V.keepConv * (V.keeperValue(after) - V.keeperValue(r));
}

export interface Evaluation {
  errors: string[];
  value: { aSends: number; bSends: number }; // what each side gives up, by its own values
  verdict: Verdict; // from team A's side
  gainA: number; // pts/wk for team A's lineup
  gainB: number;
  partnerEdge: number; // team B's on-paper view
  fairBoth: boolean;
  aboveRepl: { aSends: number; bSends: number };
}

export function evaluate(V: Values, t: Trade): Evaluation | null {
  const errors = validateTrade(t, V.base.idx);
  if (!t.aGives.length && !t.bGives.length) return null;
  if (errors.length) return { errors, value: { aSends: 0, bSends: 0 }, verdict: verdict(0, 0), gainA: 0, gainB: 0, partnerEdge: 0, fairBoth: false, aboveRepl: { aSends: 0, bSends: 0 } };
  const aSends = asking(V, t.a, t.aGives, t.bGives), bSends = asking(V, t.b, t.bGives, t.aGives);
  const gainA = V.weekGain(t.a, t.aGives, t.bGives), gainB = V.weekGain(t.b, t.bGives, t.aGives);
  const edge = partnerEdge(V, t.b, t.bGives, t.aGives);
  const fairBoth = Math.abs(edge) <= V.FAIR_RANGE && gainA >= -V.WEEKLY_LOSS_OK;
  const par = (ks: PlayerId[]) => ks.reduce((s, p) => s + Math.max(0, V.aboveReplacement(p) ?? 0) * (V.base.isOut(p) ? V.availFor(p, V.base.idx.owner.get(p)) : 1), 0);
  const v = verdict(aSends, bSends);
  return { errors, value: { aSends, bSends }, verdict: fairBoth ? { ...v, kind: 'fair', label: 'Fair' } : v, gainA, gainB, partnerEdge: edge, fairBoth, aboveRepl: { aSends: par(t.aGives), bSends: par(t.bGives) } };
}

// Trades travel in the URL hash: #/analyzer?a=10&b=3&ag=pl-0001,pl-0002&bg=pl-0300
export function tradeToQuery(t: Trade): string {
  return new URLSearchParams({ a: String(t.a), b: String(t.b), ag: t.aGives.join(','), bg: t.bGives.join(',') }).toString();
}

export function tradeFromQuery(q: URLSearchParams): Partial<Trade> {
  const num = (k: string) => (q.get(k) && Number.isInteger(+q.get(k)!) ? +q.get(k)! : undefined);
  const list = (k: string) => (q.get(k) ?? '').split(',').filter(Boolean);
  const out: Partial<Trade> = {};
  const a = num('a'), b = num('b');
  if (a !== undefined) out.a = a;
  if (b !== undefined) out.b = b;
  if (q.has('ag')) out.aGives = list('ag');
  if (q.has('bg')) out.bGives = list('bg');
  return out;
}

// "Charts say" and the toss-up badge (old app): the same trade read by each source on its own. A source
// that doesn't rate a player falls back to his market blend. Toss-up = one source has team A winning by
// 6%+ and another has him losing by 6%+.
export type SourceRead = { source: 'Peaked' | 'Menton' | 'FantasyPros' | 'Scoring'; verdict: Verdict };
export function bySource(V: Values, t: Trade): { reads: SourceRead[]; tossUp: boolean } {
  const srcs: [SourceRead['source'], (p: PlayerId) => number | null][] = [
    ['Peaked', (p) => V.chart(p, 'peaked')],
    ['Menton', (p) => V.chart(p, 'menton')],
    ['FantasyPros', (p) => V.chart(p, 'fantasypros')],
    ['Scoring', (p) => V.blend(p).model],
  ];
  const reads = srcs.map(([source, f]) => {
    const T = totals(V, t.aGives, t.bGives, (p) => f(p) ?? V.blend(p).market ?? 0);
    return { source, verdict: verdict(T.give, T.get) };
  });
  const pcts = reads.map((r) => r.verdict.pct);
  return { reads, tossUp: Math.max(...pcts) >= 6 && Math.min(...pcts) <= -6 };
}
