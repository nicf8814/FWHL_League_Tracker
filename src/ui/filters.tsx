import type { ReactNode } from 'react';

// Labelled dropdown filters in a grid: two across on a phone, one row on a wide screen. The line
// under them says in words what is being shown, with Reset when anything differs from the start.
export interface FilterField { id: string; label: string; value: string; options: [string, string][]; onChange: (v: string) => void }

export function Filters({ fields, summary, onReset, changed }: { fields: FilterField[]; summary: ReactNode; onReset: () => void; changed: boolean }) {
  return (
    <div className="grid gap-2 border-y border-rule py-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-2 md:grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))]">
        {fields.map((f) => (
          <label key={f.id} className="grid min-w-0 gap-1 text-xs font-semibold uppercase tracking-wider text-ink-3">
            {f.label}
            <select className="field min-w-0 text-sm font-medium normal-case tracking-normal text-ink" value={f.value} onChange={(e) => f.onChange(e.target.value)}>
              {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-ink-2" aria-live="polite">
        <span>{summary}</span>
        {changed && <button type="button" className="link text-sm" onClick={onReset}>Reset filters</button>}
      </div>
    </div>
  );
}
