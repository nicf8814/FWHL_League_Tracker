import { useMemo } from 'react';
import type { PlayerId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { chartAvgAt, chartHistory, teamName } from '../engine/league.ts';
import { tradeToQuery } from '../engine/trade.ts';
import { href } from '../app/router.ts';
import { fmt, PlayerName, PosMark, Section } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

// Buy & sell: where the market (charts) and the scoring model disagree, plus chart momentum and injury returns.
const EDGE = 8; // value points of model vs market before it's worth a look

type Row = { p: PlayerId; edge: number; reasons: string[]; score: number };

export default function Market() {
  const { idx, values: V, base, settings } = useLeague();
  const me = settings.myTeamId;
  const hist = useMemo(() => chartHistory(idx.ds), [idx]);
  const latest = Math.max(0, ...hist.peaked.keys(), ...hist.menton.keys());
  const { buy, sell } = useMemo(() => {
    const read = (p: PlayerId): Row => {
      const b = V.blend(p);
      const edge = b.model !== null && b.market !== null ? b.model - b.market : 0;
      const reasons: string[] = [];
      let score = edge;
      if (Math.abs(edge) >= EDGE) reasons.push(edge > 0 ? `Scores like ${fmt(b.model, 0)}, charts say ${fmt(b.market, 0)}` : `Charts say ${fmt(b.market, 0)}, scores like ${fmt(b.model, 0)}`);
      const now = chartAvgAt(hist, p, latest), then = chartAvgAt(hist, p, latest - 2);
      if (now !== null && then !== null && Math.abs(now - then) >= 6) { reasons.push(`Charts ${now > then ? 'up' : 'down'} ${fmt(Math.abs(now - then), 0)} in 2 weeks`); score -= (now - then) / 2; }
      const r = base.returnWeek(p);
      if (base.isOut(p) && r < 18 && r <= idx.currentWeek + 2 && (base.proj.get(p) ?? 0) >= 10) { reasons.push(`Out now, back around Week ${r}`); score += 4; }
      return { p, edge, reasons, score };
    };
    const rostered = [...idx.owner.keys()].filter((p) => V.blend(p).sources > 0);
    const rows = rostered.map(read).filter((r) => r.reasons.length);
    return {
      buy: rows.filter((r) => idx.owner.get(r.p) !== me && r.score >= EDGE / 2).sort((a, b) => b.score - a.score).slice(0, 25),
      sell: rows.filter((r) => (me === null || idx.owner.get(r.p) === me) && r.score <= -EDGE / 2).sort((a, b) => a.score - b.score).slice(0, 25),
    };
  }, [idx, V, base, hist, latest, me]);

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start">
      <Section title="Buy" aside="On other rosters">
        <p className="text-sm text-ink-2">Scoring better than the charts price him, sliding on the charts, or about to come back from injury.</p>
        <MarketTable tkey="market-buy" rows={buy} kind="buy" me={me} file="fwhl-buy" />
      </Section>
      <Section title="Sell" aside={me === null ? 'Whole league' : `On ${teamName(idx, me)}`}>
        <p className="text-sm text-ink-2">Priced above what he scores, or rising on the charts: worth more in a trade than in your lineup.</p>
        <MarketTable tkey="market-sell" rows={sell} kind="sell" me={me} file="fwhl-sell" />
      </Section>
      <p className="text-sm text-ink-3 lg:col-span-2">Scoring and charts have to be {EDGE} or more value apart to show.</p>
    </div>
  );
}

function MarketTable({ tkey, rows, kind, me, file }: { tkey: string; rows: Row[]; kind: 'buy' | 'sell'; me: number | null; file: string }) {
  const { idx, values: V } = useLeague();
  const open = usePlayerSheet();
  const filters = useMemo<FilterDef<Row>[]>(() => [
    { id: 'pos', label: 'Position', options: [['ANY', 'Any position'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], test: (r, v) => idx.players.get(r.p)?.pos === v },
    { id: 'why', label: 'Reason', options: [['all', 'Any reason'], ['gap', 'Scoring vs charts'], ['move', 'Chart move'], ['inj', 'Injury return']], test: (r, v) => r.reasons.some((x) => (v === 'gap' ? x.includes('Scores like') || x.includes('Charts say') : v === 'move' ? x.startsWith('Charts up') || x.startsWith('Charts down') : x.startsWith('Out now'))) },
  ], [idx]);
  const search = useMemo(() => ({ placeholder: 'Player name', of: (r: Row) => idx.players.get(r.p)?.name ?? '' }), [idx]);
  const cols = useMemo<Col<Row>[]>(() => [
    { id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[11rem]', value: (r) => idx.players.get(r.p)?.name, cell: (r) => <span className="flex items-center gap-2"><PosMark pos={idx.players.get(r.p)!.pos} /><PlayerName pid={r.p} onOpen={open} /></span> },
    { id: 'owner', label: 'Owner', left: true, className: 'text-ink-3', value: (r) => teamName(idx, idx.owner.get(r.p)) },
    { id: 'value', label: 'Value', value: (r) => V.bv(r.p), cell: (r) => fmt(V.bv(r.p), 0) },
    { id: 'edge', label: 'Model − charts', value: (r) => r.edge, cell: (r) => <span className={r.edge > 0 ? 'text-gain' : r.edge < 0 ? 'text-loss' : ''}>{fmt(r.edge, 0)}</span> },
    { id: 'why', label: 'Why', left: true, className: 'min-w-[16rem] whitespace-normal', value: (r) => r.reasons.join('; '), cell: (r) => <ul className="flex flex-wrap gap-1.5 py-1 text-xs">{r.reasons.map((x) => <li key={x} className="tag text-ink-2">{x}</li>)}</ul> },
    ...(kind === 'buy' && me !== null
      ? [{ id: 'build', label: 'Trade', left: true, value: () => '', cell: (r: Row) => <a className="link text-sm" href={href('analyzer', tradeToQuery({ a: me, b: idx.owner.get(r.p)!, aGives: [], bGives: [r.p] }))}>Build one</a> }]
      : []),
  ], [idx, V, open, kind, me]);
  const t = useTable(tkey, cols, rows, { id: 'edge', dir: kind === 'buy' ? -1 : 1 }, { filters, search });
  return (
    <>
      <TableBar t={t} noun="players" file={file} />
      <DataTable t={t} rowKey={(r) => r.p} minWidth="min-w-[36rem]" empty="Nothing stands out right now." />
    </>
  );
}
