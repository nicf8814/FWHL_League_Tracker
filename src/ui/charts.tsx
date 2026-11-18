// Chart plumbing shared by the History charts (Nov 18).
//   useWidth  the width a chart actually has, so it picks its phone or desktop layout from its own
//             box (a narrow panel on a laptop gets the phone layout too), not from the screen.
//   Reveal    the table behind a chart. Closed in Simple, open in Full (the same per-device switch
//             as the rest of the site), and only rendered once opened.
// Charts draw with the theme tokens (fill-gain, stroke-rule, ...), so dark mode follows on its own.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFull } from './detail.ts';

export const NARROW = 600; // px of chart width below which a chart switches to its phone layout

const useIso = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [w, setW] = useState(() => (typeof window === 'undefined' ? 1024 : Math.min(window.innerWidth, 1280)));
  useIso(() => {
    const el = ref.current;
    if (!el) return;
    setW(el.clientWidth);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => { if (e) setW(Math.round(e.contentRect.width)); });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

export function Reveal({ children, label = 'Show the numbers' }: { children: ReactNode; label?: string }) {
  const full = useFull();
  const [open, setOpen] = useState(full);
  useEffect(() => setOpen(full), [full]);
  return (
    <div className="grid grid-cols-1 gap-4">
      <button type="button" className="btn w-full sm:w-max" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className={open ? 'rotate-180' : ''}><path d="M3 5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
        {open ? 'Hide the numbers' : label}
      </button>
      {open && children}
    </div>
  );
}

// A small key under a chart: swatch + label.
export function Key({ items }: { items: [className: string, label: string][] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2" aria-hidden="true">
      {items.map(([c, l]) => <li key={l} className="inline-flex items-center gap-1.5"><span className={`inline-block size-3 rounded-sm ${c}`} />{l}</li>)}
    </ul>
  );
}

// Spread labels down so none overlaps the one above (y in px, sorted top to bottom).
export function spread<T extends { y: number }>(items: T[], gap = 14): T[] {
  const out = [...items].sort((a, b) => a.y - b.y).map((x) => ({ ...x }));
  for (let i = 1; i < out.length; i++) if (out[i]!.y < out[i - 1]!.y + gap) out[i]!.y = out[i - 1]!.y + gap;
  return out;
}
