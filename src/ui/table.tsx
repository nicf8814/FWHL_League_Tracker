import { useMemo, useState, type ReactNode } from 'react';

// One data table for the whole app (audit FEAT-7, Nov 12 item 6): sort any column, narrow the rows
// with dropdown filters and a search box, rank what is left 1..X, put the view back to where it
// started, and export exactly what is on screen as CSV. Columns describe their own sort value and
// CSV text, so the table never sorts or exports formatted strings.

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

// A dropdown that narrows the rows. The first option is the starting point and is never "a filter".
export interface FilterDef<R> {
  id: string;
  label: string;
  options: [string, string][]; // [value, label]; options[0] is the default ("all")
  test: (r: R, value: string) => boolean;
}

export interface Sort { id: string; dir: 1 | -1 }

const read = <T,>(key: string, d: T): T => { try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : d; } catch { return d; } };
const write = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* blocked: this visit only */ } };

export interface TableOpts<R> {
  filters?: FilterDef<R>[];
  search?: { label?: string; placeholder?: string; of: (r: R) => string }; // free-text match
  shown?: string[]; // ids visible by default (others start hidden)
}

export function useTable<R>(key: string, cols: Col<R>[], rows: R[], initial: Sort, opts: TableOpts<R> | string[] = {}) {
  // shortcut: the old signature passed the default column list directly; both work while views migrate.
  const o: TableOpts<R> = Array.isArray(opts) ? { shown: opts } : opts;
  const filters = useMemo(() => o.filters ?? [], [o.filters]);
  const defaults = () => (o.shown ? cols.filter((c) => !c.fixed && !o.shown!.includes(c.id)) : cols.filter((c) => c.hidden)).map((c) => c.id);
  // v2 key: the column views (Nov 11) start everyone on Simple instead of the old 14 columns.
  const saved = (k: string) => ({ sort: read<Sort>(`fwhl.table.${k}.sort`, initial), hidden: read<string[]>(`fwhl.table.${k}.hidden.v2`, defaults()) });
  // One state object so a table that swaps key (Simple vs Full) picks up that key's saved choices.
  const [kept, setKept] = useState(() => ({ key, ...saved(key) }));
  if (kept.key !== key) setKept({ key, ...saved(key) });
  const { sort, hidden } = kept;
  const setSortState = (s: Sort) => setKept((p) => ({ ...p, sort: s }));
  const setHiddenState = (h: string[]) => setKept((p) => ({ ...p, hidden: h }));
  // Filters are a per-visit choice, not a saved preference: a table always opens on its full set of rows.
  const start = useMemo(() => Object.fromEntries(filters.map((f) => [f.id, f.options[0]![0]])) as Record<string, string>, [filters]);
  const [picked, setPicked] = useState<Record<string, string>>(start);
  const [search, setSearch] = useState('');

  const setSort = (s: Sort) => { setSortState(s); write(`fwhl.table.${key}.sort`, s); };
  const setHidden = (h: string[]) => { setHiddenState(h); write(`fwhl.table.${key}.hidden.v2`, h); };
  const setFilter = (id: string, v: string) => setPicked((p) => ({ ...p, [id]: v }));

  const col = cols.find((c) => c.id === sort.id) ?? cols.find((c) => c.id === initial.id) ?? cols[0]!;
  const term = search.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    for (const f of filters) { const v = picked[f.id] ?? start[f.id]!; if (v !== f.options[0]![0] && !f.test(r, v)) return false; }
    return !term || !o.search || o.search.of(r).toLowerCase().includes(term);
  });
  const sorted = [...filtered].sort((a, b) => {
    const x = col.value(a), y = col.value(b);
    if (x == null || x === '') return y == null || y === '' ? 0 : 1; // blanks last either way
    if (y == null || y === '') return -1;
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
  const visible = cols.filter((c) => c.fixed || !hidden.includes(c.id));
  const toggleSort = (c: Col<R>) => setSort(sort.id === c.id ? { id: c.id, dir: sort.dir === 1 ? -1 : 1 } : { id: c.id, dir: c.left ? 1 : -1 });

  // "Back to the start": the sort, the columns, every filter and the search box at once.
  const filtersChanged = filters.some((f) => (picked[f.id] ?? start[f.id]) !== f.options[0]![0]) || term !== '';
  const changed = filtersChanged || sort.id !== initial.id || sort.dir !== initial.dir || hidden.join() !== defaults().join();
  const reset = () => { setPicked(start); setSearch(''); setSort(initial); setHidden(defaults()); };

  return {
    sorted, all: rows, filtered, visible, sort, toggleSort, hidden, setHidden, cols, defaults,
    filters, picked, setFilter, search, setSearch, searchable: o.search, reset, changed, filtersChanged, total: rows.length,
  };
}

export type Table<R> = ReturnType<typeof useTable<R>>;

export function SortHeader<R>({ t, c }: { t: Table<R>; c: Col<R> }) {
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

export function toCsv<R>(t: Table<R>): string {
  const esc = (v: unknown) => { const s = v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [['#', ...t.visible.map((c) => c.label)].map(esc).join(','), ...t.sorted.map((r, i) => [i + 1, ...t.visible.map((c) => c.value(r))].map(esc).join(','))].join('\n');
}

export function download(name: string, text: string, type = 'text/csv') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function TableTools<R>({ t, file }: { t: Table<R>; file: string }) {
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
          <button type="button" className="btn btn-quiet mt-1 justify-self-start text-sm" onClick={() => t.setHidden(t.defaults())}>Reset columns</button>
        </fieldset>
      </details>
      <button type="button" className="btn btn-quiet" onClick={() => download(`${file}.csv`, toCsv(t))}>Export CSV</button>
    </div>
  );
}

// The controls above a table: a filter dropdown each, an optional search box, then the row count,
// the column chooser, export and Reset. Reset only appears once something differs from the start.
export function TableBar<R>({ t, file, noun = 'rows', children }: { t: Table<R>; file?: string; noun?: string; children?: ReactNode }) {
  return (
    <div className="grid gap-2 border-y border-rule py-3">
      {(t.filters.length > 0 || t.searchable || children) && (
        <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
          {t.filters.map((f) => (
            <label key={f.id} className="grid min-w-0 gap-1 text-xs font-semibold uppercase tracking-wider text-ink-3">
              {f.label}
              <select className="field min-w-0 text-sm font-medium normal-case tracking-normal text-ink" value={t.picked[f.id] ?? f.options[0]![0]} onChange={(e) => t.setFilter(f.id, e.target.value)}>
                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
          ))}
          {t.searchable && (
            <label className="grid min-w-0 gap-1 text-xs font-semibold uppercase tracking-wider text-ink-3">
              {t.searchable.label ?? 'Search'}
              <input className="field min-w-0 text-sm font-medium normal-case tracking-normal text-ink" type="search" value={t.search} onChange={(e) => t.setSearch(e.target.value)} placeholder={t.searchable.placeholder ?? ''} />
            </label>
          )}
          {children}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2">
        <span className="num" role="status">{t.sorted.length === t.total ? `${t.total} ${noun}` : `${t.sorted.length} of ${t.total} ${noun}`}</span>
        {t.changed && <button type="button" className="link text-sm" onClick={t.reset}>Reset</button>}
        <span className="ml-auto flex items-center gap-1">{file && <TableTools t={t} file={file} />}</span>
      </div>
    </div>
  );
}

// The table itself, ranked 1..X down the first column so the numbering always matches what the
// filters and the sort left on screen.
export function DataTable<R>({ t, rowKey, rowClass, stickyId, limit, minWidth, rank = true, empty = 'Nothing matches these filters.' }: {
  t: Table<R>;
  rowKey: (r: R, i: number) => string;
  rowClass?: (r: R) => string;
  stickyId?: string; // column that stays put when the table scrolls sideways
  limit?: number;
  minWidth?: string;
  rank?: boolean;
  empty?: ReactNode;
}) {
  const rows = limit === undefined ? t.sorted : t.sorted.slice(0, limit);
  if (!t.sorted.length) return <p className="border border-dashed border-rule-strong px-4 py-6 text-center text-sm text-ink-3">{empty}</p>;
  return (
    <div className="-mx-4 overflow-x-auto md:mx-0">
      <table className={`tbl ${minWidth ?? ''}`}>
        <thead>
          <tr>
            {rank && <th className="l w-10">#</th>}
            {t.visible.map((c) => <SortHeader key={c.id} t={t} c={c} />)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const cls = rowClass?.(r) ?? '';
            return (
              <tr key={rowKey(r, i)} className={cls}>
                {rank && <td className="l n text-ink-3">{i + 1}</td>}
                {t.visible.map((c) => (
                  <td key={c.id} className={`${c.left ? 'l' : 'n'} ${c.id === stickyId ? `stick ${bang(cls)}` : ''} ${c.className ?? ''}`}>
                    {c.cell ? c.cell(r, i) : fmtCell(c.value(r))}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// A sticky cell sits over the scrolling rows, so a row's own background has to win there.
const bang = (cls: string) => cls.split(/\s+/).filter(Boolean).map((c) => (c.startsWith('!') ? c : `!${c}`)).join(' ');

const fmtCell = (v: number | string | null | undefined) => (v == null || v === '' ? '–' : typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(1)) : v);
