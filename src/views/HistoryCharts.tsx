// The History charts (Nov 18). Each leads its view; the tables they summarise sit behind
// "Show the numbers". Every chart picks its layout from its own width (useWidth), not the screen:
//   H1 FinishChart   every lifer's final place each season. Desktop: numbers in the cells.
//                    Phone: colour only, tap a row for the numbers.
//   H2 RivalBars     phone stand-in for the lifers grid: one manager against everyone.
//   H3 LuckChart     career luck. Desktop: running totals by season. Phone: one bar per manager
//                    with his luckiest and unluckiest season.
//   H4 ScoringChart  every regular-season score by year. Desktop: a box per season. Phone: a row per
//                    season, newest first.
// H7 (who started each all-time player) lives with the all-time players in HistoryManagers.tsx.
import { useMemo, useState } from 'react';
import type { OwnerKey } from '../data/history.ts';
import { LIFER_SEASONS, type Career, type Hist } from '../engine/history.ts';
import { finishGrid, luckLines, rivalRows, scoreSpread, shortName, type LuckLine, type Tier } from '../engine/historyCharts.ts';
import { Section, signed } from '../ui/components.tsx';
import { Key, NARROW, spread, useWidth } from '../ui/charts.tsx';

type Go = (patch: Record<string, string | null>) => void;
const rec = (w: number, l: number, t = 0) => `${w}-${l}${t ? `-${t}` : ''}`;
const yy = (y: number) => `’${String(y).slice(2)}`;

// ---------- H1 ----------
// Gold keeps dark text in both themes: light text on gold fails contrast.
const TIER: Record<Tier, string> = {
  title: 'bg-accent text-[#151a17] font-semibold',
  podium: 'bg-primary text-primary-ink font-semibold',
  playoffs: 'bg-primary-soft text-ink border border-rule',
  out: 'bg-sunk text-ink-3 border border-rule',
};
const TIER_WORD: Record<Tier, string> = { title: 'won the title', podium: 'podium', playoffs: 'made the playoffs', out: 'missed the playoffs' };
const nth = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

export function FinishChart({ H, all, go, me }: { H: Hist; all: Career[]; go: Go; me?: OwnerKey }) {
  const g = useMemo(() => finishGrid(H, all), [H, all]);
  const [ref, w] = useWidth<HTMLDivElement>();
  const narrow = w < NARROW;
  const [open, setOpen] = useState<OwnerKey | null>(null);
  const n = g.years.length;
  const cells = `repeat(${n}, minmax(0, 1fr))`;
  const cols = narrow ? `4.5rem ${cells}` : `9rem ${cells} 3.5rem`;
  return (
    <Section title="Every finish, every season" aside={`${g.years[0]}–${g.years.at(-1)} · ${LIFER_SEASONS}+ seasons`}>
      <Key items={[[TIER.title, 'Title'], [TIER.podium, '2nd–3rd'], [TIER.playoffs, 'Playoffs'], [TIER.out, 'Missed']]} />
      <div ref={ref} className="grid gap-y-1">
        <div className="grid items-end gap-x-0.5 text-[0.6875rem] font-semibold text-ink-3" style={{ gridTemplateColumns: cols }} aria-hidden="true">
          <span />
          {g.years.map((y) => <span key={y} className="text-center">{!narrow || y % 5 === 0 ? yy(y) : ''}</span>)}
        </div>
        {g.rows.map((r) => {
          const mine = r.owner === me;
          const isOpen = narrow && open === r.owner;
          const strip = r.cells.map((c) => (c.tier
            ? <span key={c.year} title={`${c.year}: ${nth(c.finish!)}`} className={`grid ${narrow ? 'h-5' : 'h-7'} place-items-center rounded-sm font-mono text-xs ${TIER[c.tier]}`}>{narrow ? '' : c.finish}</span>
            : <span key={c.year} className="grid h-5 place-items-center" aria-hidden="true"><span className="h-0.5 w-1.5 bg-rule" /></span>));
          const titles = r.titles.length ? `${r.titles.length} title${r.titles.length > 1 ? 's' : ''} (${r.titles.join(', ')})` : 'no titles yet';
          const summary = `${r.name}: ${titles}, playoffs in ${r.playoffs} of ${r.completed} seasons, luck ${signed(r.luck)}`;
          return (
            <div key={r.owner} className={isOpen ? 'grid gap-1 rounded bg-surface pb-2 outline outline-1 outline-rule' : ''}>
              <div className="grid items-center gap-x-0.5" style={{ gridTemplateColumns: cols }}>
                <button type="button" className={`link truncate pr-2 text-left text-sm no-underline hover:underline ${mine ? 'font-semibold text-ink' : 'text-ink-2'}`} title={`Open ${r.name}`} onClick={() => go({ owner: r.owner })}>
                  {narrow ? r.short : r.name}{r.active ? '' : ' ·'}
                </button>
                {narrow
                  ? <button type="button" className="grid min-h-8 items-center gap-x-0.5" style={{ gridColumn: '2 / -1', gridTemplateColumns: cells }} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} ${r.name}'s finishes`} onClick={() => setOpen(isOpen ? null : r.owner)}>{strip}</button>
                  : strip}
                {!narrow && <span className="pl-1 text-xs text-accent-ink" aria-label={titles}>{'★'.repeat(r.titles.length)}</span>}
              </div>
              {isOpen && (
                <div className="grid gap-1.5 px-1">
                  <div className="grid gap-x-0.5" style={{ gridTemplateColumns: cols }}>
                    <span className="text-[0.6875rem] text-ink-3">Finish</span>
                    {r.cells.map((c) => <span key={c.year} className={`text-center font-mono text-[0.6875rem] ${c.tier === 'title' ? 'font-semibold text-accent-ink' : c.finish ? 'text-ink' : 'text-ink-3'}`}>{c.finish ?? '–'}</span>)}
                  </div>
                  <p className="text-xs text-ink"><b className="font-semibold">{titles}</b> · playoffs {r.playoffs} of {r.completed} · luck {signed(r.luck)}</p>
                </div>
              )}
              <span className="sr-only">{summary}. {r.cells.filter((c) => c.tier).map((c) => `${c.year} ${nth(c.finish!)}, ${TIER_WORD[c.tier!]}`).join('; ')}.</span>
            </div>
          );
        })}
      </div>
      <p className="text-xs text-ink-3">Most titles first, then win %. A dot after a name: no longer in the league. {narrow ? 'Tap a row for the numbers, a name for that manager.' : 'Pick a name to open that manager.'}</p>
    </Section>
  );
}

// ---------- H2 on a phone ----------
export function RivalBars({ H, lifers, go, me }: { H: Hist; lifers: Career[]; go: Go; me?: OwnerKey }) {
  const [who, setWho] = useState<OwnerKey>(me && lifers.some((c) => c.owner === me) ? me : lifers[0]!.owner);
  const rows = useMemo(() => rivalRows(H, who, lifers), [H, who, lifers]);
  const w = rows.reduce((a, r) => a + r.w, 0), l = rows.reduce((a, r) => a + r.l, 0), t = rows.reduce((a, r) => a + r.t, 0);
  const best = rows[0], worst = rows.at(-1);
  return (
    <Section title="Head to head" aside="Pick a manager">
      {/* Chips that keep their full name and scroll sideways, instead of a segmented control that squeezes them. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="Manager">
        {[...lifers].sort((x, y) => Number(y.owner === me) - Number(x.owner === me)).map((c) => (
          <button key={c.owner} type="button" aria-pressed={c.owner === who} onClick={() => setWho(c.owner)}
            className={`min-h-9 shrink-0 rounded-full border px-3.5 text-sm ${c.owner === who ? 'border-primary bg-primary font-semibold text-primary-ink' : 'border-rule bg-surface text-ink'}`}>
            {shortName(H, c.owner)}
          </button>
        ))}
      </div>
      <p className="text-sm text-ink-2">
        <b className="font-semibold text-ink">{shortName(H, who)}: {rec(w, l, t)}</b> against the other lifers.
        {best && worst && best !== worst ? <> Best against {best.short} ({rec(best.w, best.l, best.t)}), worst against {worst.short} ({rec(worst.w, worst.l, worst.t)}).</> : null}
      </p>
      <div className="flex justify-center gap-10 text-[0.6875rem] font-semibold" aria-hidden="true"><span className="text-loss">← trails</span><span className="text-gain">leads →</span></div>
      <ul className="grid gap-1">
        {rows.map((r) => {
          const d = Math.max(-0.4, Math.min(0.4, r.pct - 0.5)) / 0.4 * 50; // ±40 points of win % fills half the bar
          return (
            <li key={r.owner}>
              <button type="button" className="grid min-h-11 w-full grid-cols-[4.5rem_1fr_3.5rem] items-center gap-2 rounded bg-surface px-2.5 text-left" onClick={() => go({ vs: `${who}~${r.owner}` })} aria-label={`${shortName(H, who)} vs ${r.name}: ${rec(r.w, r.l, r.t)}. Open the series.`}>
                <span className="truncate text-sm">{r.short}</span>
                <span className="relative h-3" aria-hidden="true">
                  <span className="absolute inset-y-[-4px] left-1/2 w-px bg-ink-3" />
                  <span className={`absolute inset-y-0 rounded-sm ${d >= 0 ? 'bg-gain' : 'bg-loss'}`} style={d >= 0 ? { left: '50%', width: `${Math.max(1, d)}%` } : { right: '50%', width: `${-d}%` }} />
                </span>
                <span className="num text-right text-sm font-medium">{rec(r.w, r.l, r.t)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-ink-3">Regular season and playoffs. Tap a row for the series; the full grid is under the numbers.</p>
    </Section>
  );
}

// ---------- H3 ----------
export function LuckChart({ H, cs, go, me }: { H: Hist; cs: Career[]; go: Go; me?: OwnerKey }) {
  const lines = useMemo(() => luckLines(H, cs), [H, cs]);
  const [ref, w] = useWidth<HTMLDivElement>();
  const narrow = w < NARROW;
  return (
    <Section title="Career luck" aside={narrow ? 'Luckiest first' : 'Running total, wins above what the scores earned'}>
      <div ref={ref}>{lines.length ? (narrow ? <LuckRows lines={lines} go={go} me={me} /> : <LuckLines lines={lines} w={w} me={me} />) : null}</div>
    </Section>
  );
}

function LuckRows({ lines, go, me }: { lines: LuckLine[]; go: Go; me?: OwnerKey }) {
  const max = Math.max(1, ...lines.map((l) => Math.abs(l.total)));
  const sg = (v: number) => signed(v);
  return (
    <ul className="grid gap-1">
      <li className="flex justify-center gap-10 pb-1 text-[0.6875rem] font-semibold" aria-hidden="true"><span className="text-loss">← unlucky</span><span className="text-gain">lucky →</span></li>
      {lines.map((l) => {
        const d = (Math.abs(l.total) / max) * 50;
        return (
          <li key={l.owner}>
            <button type="button" className={`grid w-full gap-1 rounded px-2.5 py-1.5 text-left ${l.owner === me ? 'bg-primary-soft' : 'bg-surface'}`} onClick={() => go({ owner: l.owner })} aria-label={`${l.name}: career luck ${sg(l.total)} wins. Best season ${l.best.year} ${sg(l.best.v)}, worst ${l.worst.year} ${sg(l.worst.v)}. Open his page.`}>
              <span className="grid grid-cols-[4rem_1fr_3rem] items-center gap-2">
                <span className={`truncate text-sm ${l.owner === me ? 'font-semibold' : 'font-medium'}`}>{l.short}</span>
                <span className="relative h-3" aria-hidden="true">
                  <span className="absolute inset-y-[-4px] left-1/2 w-px bg-ink-3" />
                  <span className={`absolute inset-y-0 rounded-sm ${l.total >= 0 ? 'bg-gain' : 'bg-loss'}`} style={l.total >= 0 ? { left: '50%', width: `${Math.max(1, d)}%` } : { right: '50%', width: `${d}%` }} />
                </span>
                <span className={`num text-right text-sm font-semibold ${l.total >= 0 ? 'text-gain' : 'text-loss'}`}>{sg(l.total)}</span>
              </span>
              <span className="text-xs text-ink-3">{l.seasons} seasons · best {l.best.year} {sg(l.best.v)} · worst {l.worst.year} {sg(l.worst.v)}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function LuckLines({ lines, w, me }: { lines: LuckLine[]; w: number; me?: OwnerKey }) {
  const W = Math.max(NARROW, w), Ht = 360, L = 40, R = 120, T = 12, B = 28;
  const years = lines.flatMap((l) => l.path.map((p) => p.year));
  const y0 = Math.min(...years), y1 = Math.max(...years);
  const vals = lines.flatMap((l) => l.path.map((p) => p.total));
  const lo = Math.floor(Math.min(-4, ...vals) / 4) * 4, hi = Math.ceil(Math.max(4, ...vals) / 4) * 4;
  const x = (y: number) => L + ((y - y0) / Math.max(1, y1 - y0)) * (W - L - R);
  const y = (v: number) => T + ((hi - v) / (hi - lo)) * (Ht - T - B);
  // Colour the viewer, the luckiest and the unluckiest; everyone else stays grey.
  const top = lines[0]!.owner, bottom = lines.at(-1)!.owner;
  const hl = new Map<OwnerKey, string>([[top, 'stroke-pos-wr'], [bottom, 'stroke-loss']]);
  if (me) hl.set(me, 'stroke-primary');
  const fillOf = (c: string) => c.replace('stroke-', 'fill-');
  const ticks: number[] = []; for (let v = lo; v <= hi; v += 4) ticks.push(v);
  const labels = spread(lines.filter((l) => hl.has(l.owner)).map((l) => ({ y: y(l.total) + 4, l, c: hl.get(l.owner)! })));
  const order = [...lines].sort((a, b) => Number(hl.has(a.owner)) - Number(hl.has(b.owner)));
  return (
    <div className="grid gap-2">
      <svg width={W} height={Ht} viewBox={`0 0 ${W} ${Ht}`} className="max-w-full" role="img" aria-label={`Career luck by season. Luckiest ${lines[0]!.name} ${signed(lines[0]!.total)}, unluckiest ${lines.at(-1)!.name} ${signed(lines.at(-1)!.total)}.`}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className={v === 0 ? 'stroke-ink-3' : 'stroke-rule'} strokeWidth={1} />
            <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-ink-3 text-[11px]">{v > 0 ? `+${v}` : v}</text>
          </g>
        ))}
        {years.filter((v, i, a) => a.indexOf(v) === i && (v - y0) % 2 === 0).map((v) => <text key={v} x={x(v)} y={Ht - 8} textAnchor="middle" className="fill-ink-3 text-[11px]">{v}</text>)}
        {order.map((l) => {
          const c = hl.get(l.owner);
          return (
            <g key={l.owner}>
              <polyline points={l.path.map((p) => `${x(p.year).toFixed(1)},${y(p.total).toFixed(1)}`).join(' ')} fill="none" className={c ?? 'stroke-rule-strong'} strokeWidth={c ? 3 : 1.5} strokeLinejoin="round" strokeLinecap="round"><title>{`${l.name}: ${signed(l.total)}`}</title></polyline>
              {c && <circle cx={x(l.path.at(-1)!.year)} cy={y(l.total)} r={4} className={fillOf(c)} />}
            </g>
          );
        })}
        {labels.map(({ y: ly, l, c }) => <text key={l.owner} x={W - R + 10} y={ly} className={`${fillOf(c)} text-[12px] font-semibold`}>{l.short} {signed(l.total)}</text>)}
      </svg>
      <p className="text-xs text-ink-3">In colour: {me ? 'you, ' : ''}the luckiest and the unluckiest career. Hover a line for its name.</p>
    </div>
  );
}

// ---------- H4 ----------
export function ScoringChart({ H, go }: { H: Hist; go: Go }) {
  const s = useMemo(() => scoreSpread(H), [H]);
  const [ref, w] = useWidth<HTMLDivElement>();
  const narrow = w < NARROW;
  if (!s.length) return null;
  const hi = Math.ceil(Math.max(...s.map((r) => r.high.pts)) / 50) * 50;
  const top = s.reduce((a, r) => (r.high.pts > a.high.pts ? r : a));
  const sleeper = s.filter((r) => r.platform === 'Sleeper');
  const before = s.filter((r) => r.platform !== 'Sleeper' && sleeper[0] && r.year < sleeper[0].year).at(-1);
  return (
    <Section title="Scoring by season" aside={narrow ? 'Newest first' : 'Every regular-season team score'}>
      {before && sleeper[0] && <p className="text-sm text-ink-2">The move to Sleeper in {sleeper[0].year} lifted the typical score from {Math.round(before.med)} to {Math.round(sleeper[0].med)}, which is why the records compare each score to its season's average.</p>}
      <Key items={[['bg-primary-soft border border-primary', 'Middle half'], ['bg-accent rounded-full', 'Season high'], ...(sleeper.length ? [['bg-even-soft', 'Sleeper years'] as [string, string]] : [])]} />
      <div ref={ref}>
        {narrow ? (
          <ul className="grid">
            {[...s].reverse().map((r) => {
              const p = (v: number) => `${(v / hi) * 100}%`;
              return (
                <li key={r.year}>
                  <button type="button" className={`grid min-h-7 w-full grid-cols-[3rem_1fr_2.25rem] items-center gap-2 px-1 text-left ${r.platform === 'Sleeper' ? 'bg-even-soft' : ''}`} onClick={() => go({ season: String(r.year), view: 'standings' })} aria-label={`${r.year}${r.live ? ' so far' : ''}: median ${Math.round(r.med)}, middle half ${Math.round(r.p25)} to ${Math.round(r.p75)}, high ${r.high.pts.toFixed(1)}. Open the season.`}>
                    <span className="num text-xs text-ink-2">{r.year}{r.live ? '*' : ''}</span>
                    <span className="relative h-4" aria-hidden="true">
                      <span className="absolute top-1/2 h-px bg-ink-3" style={{ left: p(r.p10), width: `calc(${p(r.p90)} - ${p(r.p10)})` }} />
                      <span className={`absolute inset-y-0.5 rounded-sm border border-primary ${r.live ? 'bg-rule-strong' : 'bg-primary-soft'}`} style={{ left: p(r.p25), width: `calc(${p(r.p75)} - ${p(r.p25)})` }} />
                      <span className="absolute inset-y-0 w-0.5 bg-primary" style={{ left: p(r.med) }} />
                      <span className="absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent" style={{ left: p(r.high.pts) }} />
                    </span>
                    <span className="num text-right text-xs font-medium">{Math.round(r.med)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : <ScoreBoxes s={s} w={w} hi={hi} H={H} top={top} />}
      </div>
      <p className="text-xs text-ink-3">The box is the middle half of the scores, the whiskers the middle 80%, the bar the median.{s.some((r) => r.live) ? ' *So far this season.' : ''}{narrow ? ' Tap a season to open it.' : ''}</p>
    </Section>
  );
}

function ScoreBoxes({ s, w, hi, H, top }: { s: ReturnType<typeof scoreSpread>; w: number; hi: number; H: Hist; top: ReturnType<typeof scoreSpread>[number] }) {
  const W = Math.max(NARROW, w), Ht = 340, L = 40, R = 12, T = 14, B = 26;
  const band = (W - L - R) / s.length;
  const x = (i: number) => L + (i + 0.5) * band;
  const y = (v: number) => T + ((hi - v) / hi) * (Ht - T - B);
  const ticks: number[] = []; for (let v = 0; v <= hi; v += 50) ticks.push(v);
  const bw = Math.min(22, band * 0.6);
  const ti = s.indexOf(top);
  return (
    <svg width={W} height={Ht} viewBox={`0 0 ${W} ${Ht}`} className="max-w-full" role="img" aria-label={`Weekly scores by season. Highest: ${shortName(H, top.high.owner)} ${top.high.pts.toFixed(1)} in ${top.year}.`}>
      {s.map((r, i) => r.platform === 'Sleeper' && <rect key={`b${r.year}`} x={x(i) - band / 2} y={T} width={band} height={Ht - T - B} className="fill-even-soft" />)}
      {ticks.map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="stroke-rule" />
          <text x={L - 8} y={y(v) + 4} textAnchor="end" className="fill-ink-3 text-[11px]">{v}</text>
        </g>
      ))}
      {s.map((r, i) => (
        <g key={r.year}>
          <title>{`${r.year}${r.live ? ' so far' : ''}: median ${Math.round(r.med)}, middle half ${Math.round(r.p25)}–${Math.round(r.p75)}, high ${r.high.pts.toFixed(1)} (${shortName(H, r.high.owner)})`}</title>
          <line x1={x(i)} x2={x(i)} y1={y(r.p10)} y2={y(r.p90)} className="stroke-ink-3" strokeWidth={1.5} />
          <rect x={x(i) - bw / 2} y={y(r.p75)} width={bw} height={y(r.p25) - y(r.p75)} rx={2} className={`stroke-primary ${r.live ? 'fill-rule-strong' : 'fill-primary-soft'}`} strokeWidth={1.5} />
          <line x1={x(i) - bw / 2} x2={x(i) + bw / 2} y1={y(r.med)} y2={y(r.med)} className="stroke-primary" strokeWidth={2.5} />
          <circle cx={x(i)} cy={y(r.high.pts)} r={3} className="fill-accent" />
          <text x={x(i)} y={Ht - 8} textAnchor="middle" className="fill-ink-3 text-[11px]">{yy(r.year)}{r.live ? '*' : ''}</text>
        </g>
      ))}
      <text x={x(ti) - 8} y={y(top.high.pts) + 4} textAnchor="end" className="fill-ink text-[11px] font-semibold">{shortName(H, top.high.owner)} {Math.round(top.high.pts)}, {top.year}</text>
    </svg>
  );
}
