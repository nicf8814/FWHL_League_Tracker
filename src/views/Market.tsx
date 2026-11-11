import { useMemo } from 'react';
import type { PlayerId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { chartAvgAt, chartHistory, teamName } from '../engine/league.ts';
import { tradeToQuery } from '../engine/trade.ts';
import { href } from '../app/router.ts';
import { Empty, fmt, PlayerName, PosMark, Section } from '../ui/components.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

// Buy & sell: where the market (charts) and the scoring model disagree, plus chart momentum and injury returns.
const EDGE = 8; // value points of model vs market before it's worth a look

type Row = { p: PlayerId; edge: number; reasons: string[]; score: number };

export default function Market() {
  const { idx, values: V, base, settings } = useLeague();
  const me = settings.myTeamId;
  const open = usePlayerSheet();
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

  const table = (rows: Row[], kind: 'buy' | 'sell') => rows.length ? (
    <ul className="grid">
      {rows.map(({ p, reasons }) => {
        const o = idx.owner.get(p)!;
        return (
          <li key={p} className="grid gap-1 border-b border-rule py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <span className="flex items-center gap-2"><PosMark pos={idx.players.get(p)!.pos} /><PlayerName pid={p} onOpen={open} /><span className="text-sm text-ink-3">{teamName(idx, o)}</span></span>
              <span className="num text-sm">value {fmt(V.bv(p), 0)}</span>
            </div>
            <ul className="flex flex-wrap gap-1.5 text-xs">{reasons.map((x) => <li key={x} className="tag text-ink-2">{x}</li>)}</ul>
            {kind === 'buy' && me !== null && <a className="link justify-self-start py-1 text-sm" href={href('analyzer', tradeToQuery({ a: me, b: o, aGives: [], bGives: [p] }))}>Build a trade for him</a>}
          </li>
        );
      })}
    </ul>
  ) : <Empty>Nothing stands out right now.</Empty>;

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start">
      <Section title="Buy" aside="On other rosters">
        <p className="text-sm text-ink-2">Scoring better than the charts price him, sliding on the charts, or about to come back from injury.</p>
        {table(buy, 'buy')}
      </Section>
      <Section title="Sell" aside={me === null ? 'Whole league' : `On ${teamName(idx, me)}`}>
        <p className="text-sm text-ink-2">Priced above what he scores, or rising on the charts: worth more in a trade than in your lineup.</p>
        {table(sell, 'sell')}
      </Section>
      <p className="text-sm text-ink-3 lg:col-span-2">Scoring and charts have to be {EDGE} or more value apart to show.</p>
    </div>
  );
}
