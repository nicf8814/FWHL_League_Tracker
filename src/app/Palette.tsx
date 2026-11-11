import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { PlayerId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { teamName } from '../engine/league.ts';
import { afterSheetClose, Sheet } from '../ui/components.tsx';
import { usePlayerSheet } from '../views/PlayerSheet.tsx';
import { href, type Route } from './router.ts';

// Command palette (audit FEAT-5) and keyboard shortcuts (FEAT-6). Ctrl/⌘ K or / opens the palette,
// ? opens the cheat sheet, g then a letter jumps to a page.

export const GO_KEYS: Partial<Record<Route, string>> = { finder: 'f', analyzer: 'a', tracker: 'r', market: 'b', waivers: 'w', keepers: 'k', standings: 's', players: 'p', teams: 't', data: 'd', method: 'h' };
export type Command = { id: string; label: string; hint?: string; group: 'Pages' | 'Players' | 'Teams' | 'Actions'; run: () => void; keys?: string };
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[^a-z0-9 ]/g, '');
const typing = (t: EventTarget | null) => !!(t as HTMLElement | null)?.closest?.('input:not([type=checkbox]):not([type=radio]),textarea,select,[contenteditable=true]');

export function Shortcuts({ nav, extra }: { nav: { route: Route; label: string }[]; extra: Command[] }) {
  const { idx, settings } = useLeague();
  const openPlayer = usePlayerSheet();
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const go = (r: Route, q?: string) => { location.hash = href(r, q); };

  const commands = useMemo<Command[]>(() => {
    const mine = settings.myTeamId;
    const pages: Command[] = nav.map((n) => ({ id: `p-${n.route}`, label: n.label, group: 'Pages', run: () => go(n.route), keys: GO_KEYS[n.route] ? `g ${GO_KEYS[n.route]}` : undefined }));
    const teams: Command[] = idx.teamIds.flatMap((t) => [
      { id: `t-${t}`, label: teamName(idx, t), hint: 'Team page', group: 'Teams' as const, run: () => go('teams', `team=${t}`) },
      ...(mine !== null && t !== mine ? [{ id: `x-${t}`, label: `Trade with ${teamName(idx, t)}`, hint: 'Analyzer', group: 'Actions' as const, run: () => go('analyzer', `a=${mine}&b=${t}`) }] : []),
    ]);
    const rostered = new Set(idx.owner.keys());
    const players: Command[] = [...idx.players.values()]
      .filter((p) => rostered.has(p.id) || idx.stats.has(p.id))
      .map((p) => ({ id: `pl-${p.id}`, label: p.name, hint: `${p.pos} · ${teamName(idx, idx.owner.get(p.id))}`, group: 'Players' as const, run: () => openPlayer(p.id as PlayerId) }));
    return [...pages, ...extra, { id: 'help', label: 'Keyboard shortcuts', group: 'Actions', run: () => setHelp(true), keys: '?' }, ...teams, ...players];
  }, [idx, settings.myTeamId, nav, extra, openPlayer]);

  useEffect(() => {
    let gAt = 0;
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((v) => !v); return; }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || document.querySelector('dialog[open]')) return;
      if (e.key === '/') { e.preventDefault(); setPalette(true); }
      else if (e.key === '?') { e.preventDefault(); setHelp(true); }
      else if (e.key === 'g') gAt = Date.now();
      else if (Date.now() - gAt < 1200) {
        const r = (Object.keys(GO_KEYS) as Route[]).find((k) => GO_KEYS[k] === e.key && nav.some((n) => n.route === k));
        gAt = 0;
        if (r) { e.preventDefault(); go(r); }
      }
    };
    window.addEventListener('keydown', on);
    return () => window.removeEventListener('keydown', on);
  }, [nav]);

  return (
    <>
      <Sheet open={palette} onClose={() => setPalette(false)} title="Go to">
        <PaletteBody commands={commands} onDone={() => setPalette(false)} />
      </Sheet>
      <Sheet open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts">
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          {[
            ['Ctrl/⌘ K or /', 'Go to a page, player, team or action'],
            ...nav.filter((n) => GO_KEYS[n.route]).map((n) => [`g ${GO_KEYS[n.route]}`, n.label]),
            ['Ctrl/⌘ Z', 'Undo a change in the analyzer'],
            ['Ctrl/⌘ Shift Z', 'Redo'],
            ['Esc or back', 'Close a sheet'],
            ['?', 'This list'],
          ].map(([k, v]) => <div key={k} className="contents"><dt><kbd className="num border border-rule-strong bg-paper px-1.5 py-0.5 text-xs">{k}</kbd></dt><dd>{v}</dd></div>)}
        </dl>
      </Sheet>
    </>
  );
}

function PaletteBody({ commands, onDone }: { commands: Command[]; onDone: () => void }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const list = useId();
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return commands.filter((c) => c.group === 'Pages' || c.group === 'Actions').slice(0, 14);
    const score = (c: Command) => { const l = norm(c.label); return l.startsWith(n) ? 0 : l.split(' ').some((w) => w.startsWith(n)) ? 1 : l.includes(n) ? 2 : 9; };
    return commands.map((c) => [score(c), c] as const).filter(([s]) => s < 9).sort((a, b) => a[0] - b[0]).slice(0, 14).map(([, c]) => c);
  }, [q, commands]);
  const pick = (c: Command | undefined) => { if (!c) return; afterSheetClose(c.run); onDone(); };
  const cur = Math.min(at, Math.max(0, hits.length - 1));
  return (
    <div className="grid gap-3">
      <input
        ref={input}
        data-autofocus
        className="field"
        role="combobox"
        aria-expanded="true"
        aria-controls={list}
        aria-activedescendant={hits[cur] ? `${list}-${hits[cur].id}` : undefined}
        aria-label="Search pages, players, teams and actions"
        placeholder="Search pages, players, teams…"
        value={q}
        onChange={(e) => { setQ(e.target.value); setAt(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((cur + 1) % Math.max(1, hits.length)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((cur - 1 + hits.length) % Math.max(1, hits.length)); }
          else if (e.key === 'Enter') { e.preventDefault(); pick(hits[cur]); }
        }}
      />
      <ul id={list} role="listbox" aria-label="Results" className="grid">
        {hits.map((c, i) => (
          <li key={c.id} id={`${list}-${c.id}`} role="option" aria-selected={i === cur} onMouseMove={() => setAt(i)} onClick={() => pick(c)}
            className={`flex min-h-11 cursor-pointer items-center justify-between gap-3 border-b border-rule px-2 ${i === cur ? 'bg-sunk' : ''}`}>
            <span className="min-w-0 truncate">{c.label}{c.hint && <span className="ml-2 text-sm text-ink-3">{c.hint}</span>}</span>
            <span className="shrink-0 text-xs text-ink-3">{c.keys ? <kbd className="num">{c.keys}</kbd> : c.group}</span>
          </li>
        ))}
        {!hits.length && <li className="py-3 text-sm text-ink-3">Nothing matches "{q}".</li>}
      </ul>
    </div>
  );
}
