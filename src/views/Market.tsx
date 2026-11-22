import { useMemo } from 'react';
import type { PlayerId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { teamName } from '../engine/league.ts';
import { buildBase, buildValues } from '../engine/model.ts';
import { tradeToQuery } from '../engine/trade.ts';
import { href } from '../app/router.ts';
import { fmt, PlayerName, PosMark, Section } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

// Buy & sell (Nov 22, no trade charts): where our price and ESPN's own projection disagree, who ESPN
// managers are starting more or less, and injury returns.
//   Ours vs ESPN: our auction-dollar value against the same value built from ESPN's projection alone
//   (no production ramp). Ours higher = he is scoring better than ESPN, and anyone reading ESPN, rates him.
//   Start % move: ESPN started % now against 2 weeks ago, across every ESPN league.
const EDGE = 8; // auction dollars between our price and ESPN's before it's worth a look
const START_MOVE = 15; // points of ESPN started % in 2 weeks

type Row = { p: PlayerId; edge: number; reasons: string[]; score: number };

export default function Market() {
  const { idx, values: V, base, settings } = useLeague();
  const me = settings.myTeamId;
  // ESPN's view: the same engine on ESPN's projection alone.
  const espn = useMemo(() => buildValues(buildBase(idx, false, { returns: settings.returnWeeks }), { ...settings, marketShare: 0 }, V.sim), [idx, settings, V.sim]);
  const { buy, sell } = useMemo(() => {
    const now = idx.currentWeek;
    // Byes and injuries swing started % everywhere: count a move only when he was projected to play at both ends.
    const started = (p: PlayerId, w: number) => { const r = idx.weeks.get(w)?.get(p); return !r || r.opponent === 'BYE' || !r.projection ? null : r.startedPct ?? null; };
    const read = (p: PlayerId): Row => {
      const ours = V.worth(p)?.dollars ?? null, theirs = espn.worth(p)?.dollars ?? null;
      const edge = ours !== null && theirs !== null ? ours - theirs : 0;
      const reasons: string[] = [];
      let score = edge;
      if (Math.abs(edge) >= EDGE) reasons.push(edge > 0 ? `Scores like $${fmt(ours, 0)}, ESPN says $${fmt(theirs, 0)}` : `ESPN says $${fmt(theirs, 0)}, scores like $${fmt(ours, 0)}`);
      const s1 = started(p, now), s0 = started(p, now - 2);
      if (s1 !== null && s0 !== null && Math.abs(s1 - s0) >= START_MOVE) { reasons.push(`Started ${s1 > s0 ? 'up' : 'down'} ${fmt(Math.abs(s1 - s0), 0)}% in 2 weeks`); score -= (s1 - s0) / 4; }
      const r = base.returnWeek(p);
      if (base.isOut(p) && r < 18 && r <= now + 2 && (base.proj.get(p) ?? 0) >= 10) { reasons.push(`Out now, back around Week ${r}`); score += 4; }
      return { p, edge, reasons, score };
    };
    const rostered = [...idx.owner.keys()].filter((p) => V.worth(p));
    const rows = rostered.map(read).filter((r) => r.reasons.length);
    return {
      buy: rows.filter((r) => idx.owner.get(r.p) !== me && r.score >= EDGE / 2).sort((a, b) => b.score - a.score).slice(0, 25),
      sell: rows.filter((r) => (me === null || idx.owner.get(r.p) === me) && r.score <= -EDGE / 2).sort((a, b) => a.score - b.score).slice(0, 25),
    };
  }, [idx, V, espn, base, me]);

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start">
      <Section title="Buy" aside="On other rosters">
        <p className="text-sm text-ink-2">Scoring better than ESPN rates him, being benched across ESPN leagues, or about to come back from injury.</p>
        <MarketTable tkey="market-buy" rows={buy} kind="buy" me={me} file="fwhl-buy" />
      </Section>
      <Section title="Sell" aside={me === null ? 'Whole league' : `On ${teamName(idx, me)}`}>
        <p className="text-sm text-ink-2">Rated above what he scores, or started everywhere after a hot stretch: worth more in a trade than in your lineup.</p>
        <MarketTable tkey="market-sell" rows={sell} kind="sell" me={me} file="fwhl-sell" />
      </Section>
      <p className="text-sm text-ink-3 lg:col-span-2">Our price and ESPN's have to be ${EDGE} or more apart, or ESPN started % move {START_MOVE} points in 2 weeks, to show.</p>
    </div>
  );
}

function MarketTable({ tkey, rows, kind, me, file }: { tkey: string; rows: Row[]; kind: 'buy' | 'sell'; me: number | null; file: string }) {
  const { idx, values: V } = useLeague();
  const open = usePlayerSheet();
  const filters = useMemo<FilterDef<Row>[]>(() => [
    { id: 'pos', label: 'Position', options: [['ANY', 'Any position'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], test: (r, v) => idx.players.get(r.p)?.pos === v },
    { id: 'why', label: 'Reason', options: [['all', 'Any reason'], ['gap', 'Ours vs ESPN'], ['move', 'Start % move'], ['inj', 'Injury return']], test: (r, v) => r.reasons.some((x) => (v === 'gap' ? x.includes('Scores like') || x.includes('ESPN says') : v === 'move' ? x.startsWith('Started') : x.startsWith('Out now'))) },
  ], [idx]);
  const search = useMemo(() => ({ placeholder: 'Player name', of: (r: Row) => idx.players.get(r.p)?.name ?? '' }), [idx]);
  const cols = useMemo<Col<Row>[]>(() => [
    { id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[11rem]', value: (r) => idx.players.get(r.p)?.name, cell: (r) => <span className="flex items-center gap-2"><PosMark pos={idx.players.get(r.p)!.pos} /><PlayerName pid={r.p} onOpen={open} /></span> },
    { id: 'owner', label: 'Owner', left: true, className: 'text-ink-3', value: (r) => teamName(idx, idx.owner.get(r.p)) },
    { id: 'value', label: 'Value $', value: (r) => V.bv(r.p), cell: (r) => fmt(V.bv(r.p), 0) },
    { id: 'edge', label: 'Ours − ESPN $', value: (r) => r.edge, cell: (r) => <span className={r.edge > 0 ? 'text-gain' : r.edge < 0 ? 'text-loss' : ''}>{fmt(r.edge, 0)}</span> },
    { id: 'why', label: 'Why', left: true, className: 'min-w-[16rem] whitespace-normal', value: (r) => r.reasons.join('; '), cell: (r) => <ul className="flex flex-wrap gap-1.5 py-1 text-xs">{r.reasons.map((x) => <li key={x} className="tag text-ink-2">{x}</li>)}</ul> },
    ...(kind === 'buy' && me !== null
      ? [{ id: 'build', label: 'Trade', left: true, value: () => '', cell: (r: Row) => <a className="link text-sm" href={href('analyzer', tradeToQuery({ a: me, b: idx.owner.get(r.p)!, aGives: [], bGives: [r.p] }))}>Build one</a> }]
      : []),
  ], [idx, V, open, kind, me]);
  const t = useTable(tkey, cols, rows, { id: 'edge', dir: kind === 'buy' ? -1 : 1 }, { filters, search , phone: ['owner', 'edge'] });
  return (
    <>
      <TableBar t={t} noun="players" file={file} />
      <DataTable t={t} rowKey={(r) => r.p} minWidth="min-w-[36rem]" empty="Nothing stands out right now." />
    </>
  );
}
