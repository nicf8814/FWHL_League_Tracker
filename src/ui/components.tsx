import { Component, useEffect, useId, useRef, type ReactNode } from 'react';
import type { PlayerId, Pos, TeamId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { teamName } from '../engine/league.ts';

// The whole component kit. Kept in one file on purpose: it is small, and every view reads it.

export const fmt = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '–' : v.toFixed(d));
export const signed = (v: number | null | undefined, d = 1) => (v == null || !Number.isFinite(v) ? '–' : `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(d)}`);
export const pct = (v: number | null | undefined) => (v == null ? '–' : `${Math.round(v * 100)}%`);
export const tone = (v: number, eps = 0.3) => (v > eps ? 'text-gain' : v < -eps ? 'text-loss' : 'text-ink-3');

// Manager monogram: a fixed hue per team id, so a team reads the same everywhere.
export function Mono({ team, size = 'md' }: { team: TeamId; size?: 'sm' | 'md' }) {
  const { idx } = useLeague();
  const name = teamName(idx, team);
  const hue = (team * 47) % 360;
  return (
    <span
      aria-hidden="true"
      className={`inline-grid shrink-0 place-items-center rounded-sm font-display font-bold text-[#f4f1e8] [font-stretch:75%] ${size === 'sm' ? 'size-5 text-xs' : 'size-7 text-sm'}`}
      style={{ background: `oklch(0.46 0.07 ${hue})` }}
    >
      {name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function TeamLabel({ team, mine }: { team: TeamId | undefined; mine?: boolean }) {
  const { idx, settings } = useLeague();
  if (team === undefined) return <span className="text-ink-3">Free agent</span>;
  const isMine = mine ?? settings.myTeamId === team;
  return (
    <span className="inline-flex items-center gap-2">
      <Mono team={team} size="sm" />
      <span>{teamName(idx, team)}</span>
      {isMine && <span className="tag text-accent-ink">Mine</span>}
    </span>
  );
}

export function TeamSelect({ value, onChange, label, exclude, allowEmpty }: { value: TeamId | null; onChange: (t: TeamId | null) => void; label: string; exclude?: TeamId | null; allowEmpty?: string }) {
  const { idx, settings } = useLeague();
  const id = useId();
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="text-sm text-ink-3">{label}</label>
      {/* UI-13: the team's monogram sits inside the native select, so it keeps the platform picker and its a11y */}
      <div className="relative">
        {value !== null && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2"><Mono team={value} /></span>}
        <select id={id} className={`field ${value !== null ? 'pl-12' : ''}`} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
          {allowEmpty !== undefined && <option value="">{allowEmpty}</option>}
          {idx.ds.teams.filter((t) => t.id !== exclude).map((t) => (
            <option key={t.id} value={t.id}>{t.name}{t.id === settings.myTeamId ? ' (mine)' : ''}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: readonly (readonly [T, string])[]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg w-max max-w-full overflow-x-auto" role="group" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}

export const POS_OPTIONS = [['ANY', 'Any'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']] as const satisfies readonly (readonly [Pos | 'ANY', string])[];

export function Status({ pid }: { pid: PlayerId }) {
  const { idx, base } = useLeague();
  const inj = idx.injury.get(pid);
  const stale = base.stale.get(pid);
  const r = base.returnWeek(pid);
  if (inj && (inj.status === 'OUT' || inj.status === 'IR'))
    return <span className="tag text-loss" title={inj.note}>{inj.status}{r >= 18 ? ' · season' : r > base.now ? ` · Wk ${r}` : ''}</span>;
  if (stale) return <span className="tag text-loss" title="Missed his last games; treated as out until he plays">Missed {stale}</span>;
  if (inj?.status === 'Q') return <span className="tag text-even" title={inj.note}>Q</span>;
  return null;
}

export function PlayerName({ pid, onOpen }: { pid: PlayerId; onOpen?: (p: PlayerId) => void }) {
  const { idx } = useLeague();
  const p = idx.players.get(pid);
  if (!p) return <span>{pid}</span>;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      {onOpen ? <button type="button" className="link -my-2.5 py-2.5" onClick={() => onOpen(pid)}>{p.name}</button> : <span>{p.name}</span>}
      <Status pid={pid} />
    </span>
  );
}

export function PosMark({ pos }: { pos: Pos }) {
  return <span className="num inline-block w-7 text-xs font-medium text-ink-3">{pos}</span>;
}

// Native <dialog>: focus trap, Escape and inert background come from the browser.
// Run fn once a sheet that owns a history entry has finished closing (its history.back() has landed),
// so a command that opens the next sheet isn't closed by the previous one's popstate.
export function afterSheetClose(fn: () => void) {
  let done = false;
  const run = () => { if (done) return; done = true; window.removeEventListener('popstate', run); fn(); };
  window.addEventListener('popstate', run);
  setTimeout(run, 250); // shortcut: fallback if no popstate comes (storage-less embeds); 250 ms covers a slow back()
}

export function Sheet({ open, onClose, title, children, ownHistory = true }: { open: boolean; onClose: () => void; title: string; children: ReactNode; ownHistory?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { d.showModal(); d.querySelector<HTMLElement>('[data-autofocus]')?.focus(); }
    if (!open && d.open) d.close();
  }, [open]);
  // LOGIC-8: an open sheet owns one history entry, so the back button or gesture closes it instead of leaving the page.
  useEffect(() => {
    if (!open || !ownHistory) return; // ownHistory=false: the page put the sheet in the URL itself
    history.pushState({ fwhlSheet: titleId }, '');
    let mine = true;
    const onPop = () => { mine = false; close.current(); };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      if (mine && (history.state as { fwhlSheet?: string } | null)?.fwhlSheet === titleId) history.back();
    };
  }, [open, ownHistory, titleId]);
  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="max-h-[88dvh] overflow-y-auto overscroll-contain">
        <header className="sticky top-0 z-10 flex items-center justify-between gap-4 border-b border-rule bg-surface px-5 py-3">
          <h2 id={titleId} className="text-lg">{title}</h2>
          <button type="button" className="btn btn-quiet" onClick={onClose}>Close</button>
        </header>
        <div className="p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">{open && children}</div>
      </div>
    </dialog>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="border border-dashed border-rule-strong px-4 py-6 text-center text-sm text-ink-3">{children}</p>;
}

export function Section({ title, aside, children, className = '' }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`grid grid-cols-1 gap-3 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink pb-1.5">
        <h2 className="text-lg">{title}</h2>
        {aside && <div className="text-sm text-ink-3">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode; label: string }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error(`${this.props.label} crashed`, error);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div role="alert" className="grid gap-3 border border-loss bg-loss-soft p-5">
        <h2 className="text-lg">{this.props.label} hit an error</h2>
        <p className="text-sm text-ink-2">{this.state.error.message}</p>
        <div><button className="btn" onClick={() => this.setState({ error: null })}>Try again</button></div>
      </div>
    );
  }
}
