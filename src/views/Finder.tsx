import { useEffect, useId, useMemo, useState } from 'react';
import type { PlayerId, Pos, TeamId } from '../data/schema.ts';
import { useDebounced, useLeague } from '../data/store.tsx';
import { finderKey, hasInput, type FinderQuery, type Offer, type TeamOffers } from '../engine/finder.ts';
import { findTradesAsync } from '../engine/finderClient.ts';
import { teamName } from '../engine/league.ts';
import { tradeToQuery } from '../engine/trade.ts';
import { href } from '../app/router.ts';
import { Empty, fmt, Mono, PlayerName, POS_OPTIONS, PosMark, Seg, signed, TeamSelect, tone } from '../ui/components.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

// Results are cached by the full query + values version (audit PERF-2). Opening a team, showing more
// offers and scrolling are view state only and never rerun the search.
const RESULTS = new Map<string, TeamOffers[]>();
const MAX_CACHED = 24;

type Tag = 'sell' | 'open' | 'keep';

export default function Finder() {
  const { idx, values: V, valuesVersion, settings } = useLeague();
  const [team, setTeam] = useState<TeamId>(settings.myTeamId ?? idx.teamIds[0]!);
  const [pos, setPos] = useState<Pos | 'ANY'>('ANY');
  const [tags, setTags] = useState<Record<PlayerId, Tag>>({});
  const [want, setWant] = useState<PlayerId[]>([]);
  const [gap, setGap] = useState(3);
  const [maxLoss, setMaxLoss] = useState(1);
  const [partner, setPartner] = useState<TeamId | 'all'>('all');
  const [sort, setSort] = useState<'me' | 'winwin'>('me');
  const [open, setOpen] = useState<Set<TeamId>>(new Set());
  const [more, setMore] = useState<Set<TeamId>>(new Set());

  const q: FinderQuery = useDebounced(
    useMemo(
      () => ({
        team, pos, want, gap, maxLoss, partner, sort,
        sell: Object.keys(tags).filter((k) => tags[k] === 'sell'),
        keep: Object.keys(tags).filter((k) => tags[k] === 'keep'),
      }),
      [team, pos, tags, want, gap, maxLoss, partner, sort],
    ),
    200,
  );
  const key = finderKey(q, valuesVersion);
  const [result, setResult] = useState<{ key: string; data: TeamOffers[]; error?: string } | null>(null);
  const busy = hasInput(q) && result?.key !== key;

  useEffect(() => {
    if (!hasInput(q)) return;
    const hit = RESULTS.get(key);
    if (hit) { setResult({ key, data: hit }); return; }
    let live = true; // a newer search makes this one's answer stale
    findTradesAsync({ ds: idx.ds, version: valuesVersion, ramp: V.base.ramp, settings: V.settings, sim: V.sim, q, V }).then(
      (data) => {
        RESULTS.set(key, data);
        if (RESULTS.size > MAX_CACHED) RESULTS.delete(RESULTS.keys().next().value!);
        if (live) setResult({ key, data });
      },
      (e: unknown) => live && setResult({ key, data: [], error: e instanceof Error ? e.message : String(e) }),
    );
    return () => { live = false; };
  }, [key]); // key encodes q and the values version, so V and q are current here

  const changeTeam = (t: TeamId | null) => {
    if (t === null) return;
    setTeam(t); setTags({}); setWant((w) => w.filter((p) => idx.owner.get(p) !== t)); setOpen(new Set()); setMore(new Set());
    if (partner === t) setPartner('all');
  };
  const toggle = (set: Set<TeamId>, t: TeamId) => { const n = new Set(set); n.has(t) ? n.delete(t) : n.add(t); return n; };
  const data = result?.key === key ? result.data : result?.data ?? [];
  const sells = Object.values(tags).filter((t) => t === 'sell').length, keeps = Object.values(tags).filter((t) => t === 'keep').length;

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[22rem_minmax(0,1fr)] lg:items-start xl:grid-cols-[24rem_minmax(0,1fr)]">
      <aside className="grid gap-5 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-2">
        <TeamSelect label="Find trades for" value={team} onChange={changeTeam} />
        <div className="grid gap-1">
          <span className="text-sm text-ink-3">Position you need</span>
          <Seg label="Position you need" value={pos} options={POS_OPTIONS} onChange={setPos} />
        </div>
        <details className="group border-y border-rule py-2" open={typeof window !== 'undefined' && window.matchMedia?.('(min-width: 64rem)').matches}>
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between text-sm">
            <span className="font-medium">Tag {teamName(idx, team)}'s players</span>
            <span className="num text-ink-3">{sells} sell · {keeps} keep</span>
          </summary>
          <TagList team={team} tags={tags} onTag={(p, t) => setTags((s) => ({ ...s, [p]: t }))} />
        </details>
        <WantPicker team={team} want={want} onChange={setWant} />
        <fieldset className="grid gap-4 border-t border-rule pt-4">
          <legend className="sr-only">Finder settings</legend>
          <Slider label="Who wins on paper" min={-10} max={10} step={1} value={gap} onChange={setGap}
            display={gap >= 10 ? 'Partner by 10+' : gap <= -10 ? 'You by 10+' : gap === 0 ? 'Even' : gap > 0 ? `Partner by ${gap}` : `You by ${-gap}`}
            hint="Offers where the other manager feels he's winning tend to get accepted. Shows offers within 2.5 of this." />
          <Slider label="Weekly loss allowed" min={0} max={4} step={0.1} value={maxLoss} onChange={setMaxLoss} display={maxLoss ? `−${maxLoss.toFixed(1)} pts` : 'None'} hint="Your lineup can lose up to this many pts/wk." />
          <TeamSelect label="Trade with" value={partner === 'all' ? null : partner} exclude={team} allowEmpty="All teams" onChange={(t) => setPartner(t ?? 'all')} />
          <div className="grid gap-1">
            <span className="text-sm text-ink-3">Rank offers by</span>
            <Seg label="Rank offers by" value={sort} options={[['me', 'Most for me'], ['winwin', 'Win-win']] as const} onChange={setSort} />
          </div>
        </fieldset>
      </aside>

      <section aria-label="Offers" aria-busy={busy} className="grid content-start gap-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-ink pb-1.5">
          <h2 className="text-lg">Offers</h2>
          <p className="text-sm text-ink-3" role="status">
            {!hasInput(q) ? '' : busy ? 'Finding trades…' : `${data.reduce((s, g) => s + g.count, 0)} fair offers from ${data.length} team${data.length === 1 ? '' : 's'}`}
          </p>
        </div>
        {!hasInput(q) ? (
          <Empty>Pick the position you need, tag players to sell, or add a player you want.</Empty>
        ) : !busy && result?.error ? (
          <p role="alert" className="text-loss">The search failed: {result.error}. Change a setting to try again.</p>
        ) : !busy && !data.length ? (
          <Empty>No fair offers at these settings. Try moving "Who wins on paper" or allowing a small weekly loss.</Empty>
        ) : (
          <ol className={`grid transition-opacity duration-[var(--dur-hover)] ${busy ? 'opacity-50' : ''}`}>
            {data.map((g) => (
              <TeamGroup key={g.team} g={g} from={team} open={open.has(g.team)} showAll={more.has(g.team)}
                onToggle={() => setOpen((s) => toggle(s, g.team))} onMore={() => setMore((s) => toggle(s, g.team))} />
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange, display, hint }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void; display: string; hint: string }) {
  const id = useId();
  return (
    <div className="grid gap-0.5">
      <div className="flex items-baseline justify-between"><label htmlFor={id} className="text-sm text-ink-3">{label}</label><span className="num text-sm">{display}</span></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <p className="text-xs text-ink-3">{hint}</p>
    </div>
  );
}

function TagList({ team, tags, onTag }: { team: TeamId; tags: Record<PlayerId, Tag>; onTag: (p: PlayerId, t: Tag) => void }) {
  const { idx, values: V } = useLeague();
  const open = usePlayerSheet();
  const roster = [...(idx.roster.get(team) ?? [])].sort((a, b) => V.bv(b) - V.bv(a));
  return (
    <ul className="mt-2 grid">
      {roster.map((p) => {
        const t = tags[p] ?? 'open';
        return (
          <li key={p} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b border-rule py-1">
            <PosMark pos={idx.players.get(p)!.pos} />
            <span className="min-w-0 text-sm"><PlayerName pid={p} onOpen={open} /></span>
            <div className="seg [&>button]:min-h-9 [&>button]:min-w-0 [&>button]:px-2 [&>button]:text-xs" role="group" aria-label={`Tag ${idx.players.get(p)?.name}`}>
              {(['sell', 'open', 'keep'] as const).map((x) => (
                <button key={x} type="button" aria-pressed={t === x} onClick={() => onTag(p, x)}
                  className={t === x && x === 'sell' ? '!bg-gain !text-paper' : t === x && x === 'keep' ? '!bg-loss !text-paper' : ''}>
                  {x === 'sell' ? 'Sell' : x === 'keep' ? 'Keep' : 'Open'}
                </button>
              ))}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function WantPicker({ team, want, onChange }: { team: TeamId; want: PlayerId[]; onChange: (w: PlayerId[]) => void }) {
  const { idx, values: V } = useLeague();
  const [q, setQ] = useState('');
  const id = useId();
  const term = q.trim().toLowerCase();
  const hits = term.length < 2 ? [] : [...idx.owner.keys()].filter((p) => idx.owner.get(p) !== team && !want.includes(p) && idx.players.get(p)!.name.toLowerCase().includes(term)).sort((a, b) => V.bv(b) - V.bv(a)).slice(0, 6);
  return (
    <div className="grid gap-2">
      <label htmlFor={id} className="text-sm text-ink-3">Players you want</label>
      {want.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {want.map((p) => (
            <li key={p}>
              <button type="button" className="btn min-h-9 px-2 text-xs" onClick={() => onChange(want.filter((x) => x !== p))} aria-label={`Remove ${idx.players.get(p)?.name}`}>
                {idx.players.get(p)?.name} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <input id={id} className="field" type="search" placeholder="Search a rostered player" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {hits.length > 0 && (
        <ul className="grid border border-rule bg-surface" aria-label="Matching players">
          {hits.map((p) => (
            <li key={p}>
              <button type="button" className="rowbtn flex min-h-11 w-full items-center justify-between gap-3 border-b border-rule px-3 text-left text-sm last:border-b-0" onClick={() => { onChange([...want, p]); setQ(''); }}>
                <span>{idx.players.get(p)?.name} <span className="text-ink-3">· {teamName(idx, idx.owner.get(p))}</span></span>
                <span className="num">{fmt(V.bv(p), 0)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TeamGroup({ g, from, open, showAll, onToggle, onMore }: { g: TeamOffers; from: TeamId; open: boolean; showAll: boolean; onToggle: () => void; onMore: () => void }) {
  const { idx } = useLeague();
  const best = g.offers[0]!;
  const shown = showAll ? g.offers : g.offers.slice(0, 3);
  const bodyId = useId();
  return (
    <li className="border-b border-rule">
      <button type="button" className="rowbtn grid min-h-14 w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-2 text-left" aria-expanded={open} aria-controls={bodyId} onClick={onToggle}>
        <Mono team={g.team} />
        <span className="min-w-0">
          <span className="block font-medium">{teamName(idx, g.team)}</span>
          <span className="block text-xs text-ink-3">{g.count} offer{g.count === 1 ? '' : 's'}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className={`num font-semibold ${tone(best.myGain)}`}>{signed(best.myGain)}<span className="text-xs font-normal text-ink-3"> best</span></span>
          <span aria-hidden="true" className={`text-ink-3 transition-transform duration-[var(--dur-hover)] ${open ? 'rotate-180' : ''}`}>▾</span>
        </span>
      </button>
      {open && (
        <div id={bodyId} className="grid gap-0 pb-3 pl-2 md:pl-11">
          {shown.map((o) => <OfferRow key={o.give.join() + o.get.join()} o={o} partner={g.team} from={from} />)}
          {g.offers.length > 3 && <button type="button" className="btn btn-quiet justify-self-start" onClick={onMore}>{showAll ? 'Show fewer' : `Show ${g.offers.length - 3} more`}</button>}
        </div>
      )}
    </li>
  );
}

function OfferRow({ o, partner, from }: { o: Offer; partner: TeamId; from: TeamId }) {
  const { idx, values: V } = useLeague();
  const open = usePlayerSheet();
  const list = (ks: PlayerId[]) => (
    <ul className="grid">
      {ks.map((p) => (
        <li key={p} className="flex items-baseline justify-between gap-3 text-sm">
          <span className="min-w-0"><PlayerName pid={p} onOpen={open} /></span>
          <span className="num text-ink-3">{fmt(V.bv(p), 0)}</span>
        </li>
      ))}
    </ul>
  );
  return (
    <article className="grid gap-2 border-t border-rule py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4">
        <p className={`num text-lg font-semibold ${tone(o.myGain)}`}>{signed(o.myGain)} pts/wk</p>
        <p className="text-xs text-ink-3">{teamName(idx, partner)} sees <span className="num">{signed(o.edge)}</span> · his lineup <span className={`num ${tone(o.theirGain)}`}>{signed(o.theirGain)}</span></p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><p className="text-xs text-ink-3">{teamName(idx, from)} sends</p>{list(o.give)}</div>
        <div><p className="text-xs text-ink-3">{teamName(idx, partner)} sends</p>{list(o.get)}</div>
      </div>
      <a className="link -my-1 justify-self-start py-3 text-sm" href={href('analyzer', tradeToQuery({ a: from, b: partner, aGives: o.give, bGives: o.get }))}>Open in analyzer</a>
    </article>
  );
}
