import { useState, type ReactNode } from 'react';

// Sortable tables with a column chooser and CSV export (audit FEAT-7). Columns describe their own
// sort value and CSV text, so the table never sorts by formatted strings.

export interface Col<R> {
  id: string;
  label: string;
  value: (r: R) => number | string | null | undefined; // sort and CSV
  cell?: (r: R, i: number) => ReactNode;
  left?: boolean; // text column (left aligned, sorts A-Z first)
  hidden?: boolean; // off by default
  fixed?: boolean; // can't be hidden
  className?: string;
}

type Sort = { id: string; dir: 1 | -1 };
const read = <T,>(key: string, d: T): T => { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* blocked: this visit only */ } };

export function useTable<R>(key: string, cols: Col<R>[], rows: R[], initial: Sort) {
  const [sort, setSortState] = useState<Sort>(() => read(`fwhl.table.${key}.sort`, initial));
  const [hidden, setHiddenState] = useState<string[]>(() => read(`fwhl.table.${key}.hidden`, cols.filter((c) => c.hidden).map((c) => c.id)));
  const setSort = (s: Sort) => { setSortState(s); write(`fwhl.table.${key}.sort`, s); };
  const setHidden = (h: string[]) => { setHiddenState(h); write(`fwhl.table.${key}.hidden`, h); };
  const col = cols.find((c) => c.id === sort.id) ?? cols.find((c) => c.id === initial.id)!;
  const sorted = [...rows].sort((a, b) => {
    const x = col.value(a), y = col.value(b);
    if (x == null || x === '') return y == null || y === '' ? 0 : 1; // blanks last either way
    if (y == null || y === '') return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
  const visible = cols.filter((c) => c.fixed || !hidden.includes(c.id));
  const toggleSort = (c: Col<R>) => setSort(sort.id === c.id ? { id: c.id, dir: sort.dir === 1 ? -1 : 1 } : { id: c.id, dir: c.left ? 1 : -1 });
  return { sorted, visible, sort, toggleSort, hidden, setHidden, cols };
}

export function SortHeader<R>({ t, c }: { t: ReturnType<typeof useTable<R>>; c: Col<R> }) {
  const on = t.sort.id === c.id;
  return (
    <th className={`${c.left ? 'l' : ''} ${c.className ?? ''}`} aria-sort={on ? (t.sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`inline-flex min-h-8 items-center gap-1 ${c.left ? '' : 'flex-row-reverse'} ${on ? 'text-ink' : ''}`} onClick={() => t.toggleSort(c)}>
        {c.label}
        <span aria-hidden="true" className={`w-2 text-[0.7em] ${on ? '' : 'opacity-0'}`}>{t.sort.dir === 1 ? '▲' : '▼'}</span>
      </button>
    </th>
  );
}

export function TableTools<R>({ t, file }: { t: ReturnType<typeof useTable<R>>; file: string }) {
  const csv = () => {
    const esc = (v: unknown) => { const s = v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const text = [t.visible.map((c) => esc(c.label)).join(','), ...t.sorted.map((r) => t.visible.map((c) => esc(c.value(r))).join(','))].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = `${file}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  return (
    <div className="flex flex-wrap items-center gap-1">
      <details className="relative">
        <summary className="btn btn-quiet cursor-pointer list-none">Columns</summary>
        <fieldset className="absolute right-0 z-20 mt-1 grid w-56 gap-0.5 border border-rule-strong bg-surface p-3">
          <legend className="sr-only">Columns to show</legend>
          {t.cols.filter((c) => !c.fixed).map((c) => (
            <label key={c.id} className="flex min-h-9 items-center gap-2 text-sm">
              <input type="checkbox" checked={!t.hidden.includes(c.id)} onChange={(e) => t.setHidden(e.target.checked ? t.hidden.filter((h) => h !== c.id) : [...t.hidden, c.id])} />
              {c.label}
            </label>
          ))}
          <button type="button" className="btn btn-quiet mt-1 justify-self-start text-sm" onClick={() => t.setHidden(t.cols.filter((c) => c.hidden).map((c) => c.id))}>Reset columns</button>
        </fieldset>
      </details>
      <button type="button" className="btn btn-quiet" onClick={csv}>Export CSV</button>
    </div>
  );
}
