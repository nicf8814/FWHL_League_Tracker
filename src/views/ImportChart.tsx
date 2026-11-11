import { useId, useState } from 'react';
import type { Dataset } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { validateDataset } from '../data/validate.ts';
import { Section, Seg } from '../ui/components.tsx';
import { applyChart, applyRanks, arizonaToday, chartRowsFromCsv, rankRowsFromCsv, type Report } from '../../scripts/updates.ts';

// In-app chart and FantasyPros import (audit FEAT-1). Same code as `npm run data -- chart|ranks`, run on a
// copy first so the preview is exactly what Apply will do. It changes the data on this device only; the
// shared file still goes through the command line (docs/data-updates.md).

type Kind = 'peaked' | 'menton' | 'fantasypros';
type Preview = { ds: Dataset; rep: Report } | { error: string };

function run(base: Dataset, kind: Kind, week: number, text: string): Preview {
  const ds: Dataset = structuredClone(base);
  try {
    const rep = kind === 'fantasypros' ? applyRanks(ds, rankRowsFromCsv(text), arizonaToday()) : applyChart(ds, kind, week, chartRowsFromCsv(text));
    ds.meta.exportedAt = new Date().toISOString(); // newer than the deployed file, so this device keeps it until the next refresh
    const v = validateDataset(JSON.parse(JSON.stringify(ds)));
    return v.ok ? { ds: v.value, rep } : { error: `The import would leave the data invalid: ${v.errors[0]}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function ImportChart() {
  const { idx, replaceDataset } = useLeague();
  const [kind, setKind] = useState<Kind>('peaked');
  const [week, setWeek] = useState(idx.currentWeek);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState('');
  const ids = { week: useId(), csv: useId(), file: useId() };
  const reset = () => { setPreview(null); setDone(''); };
  const existing = kind !== 'fantasypros' && idx.ds.valuations.some((v) => v.source === kind && v.week === week);
  const apply = async () => {
    if (!preview || 'error' in preview) return;
    await replaceDataset(preview.ds);
    setDone(`Applied: ${preview.rep.changes.join('; ')}.`);
    setPreview(null);
    setText('');
  };

  return (
    <Section title="Import a chart">
      <p className="max-w-[70ch] text-sm text-ink-2">
        Paste or pick a CSV. Trade charts use <code className="num">name,value,pos</code> in the chart's order; FantasyPros uses <code className="num">name,pos,rank</code>. You'll see what matches before anything changes. This updates the data on this device only.
      </p>
      <div className="flex flex-wrap items-end gap-4">
        <Seg label="Chart" value={kind} options={[['peaked', 'Peaked'], ['menton', 'Menton'], ['fantasypros', 'FantasyPros']] as const} onChange={(k) => { setKind(k); reset(); }} />
        {kind !== 'fantasypros' && (
          <div className="grid gap-1">
            <label htmlFor={ids.week} className="text-sm text-ink-3">Week</label>
            <input id={ids.week} type="number" min={1} max={18} className="field w-24" value={week} onChange={(e) => { setWeek(Math.min(18, Math.max(1, Number(e.target.value) || 1))); reset(); }} />
          </div>
        )}
        <div className="grid gap-1">
          <label htmlFor={ids.file} className="text-sm text-ink-3">CSV file</label>
          <input id={ids.file} type="file" accept=".csv,text/csv,text/plain" className="text-sm" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(f.size > 2e6 ? '' : await f.text()); reset(); } e.target.value = ''; }} />
        </div>
      </div>
      <div className="grid gap-1">
        <label htmlFor={ids.csv} className="text-sm text-ink-3">Or paste it</label>
        <textarea id={ids.csv} rows={5} className="field num min-h-28 text-xs" placeholder={kind === 'fantasypros' ? 'name,pos,rank\nBijan Robinson,RB,1' : 'name,value,pos\nJa\'Marr Chase,100,WR'} value={text} onChange={(e) => { setText(e.target.value); reset(); }} />
      </div>
      {existing && <p className="text-sm text-even">{kind === 'peaked' ? 'Peaked' : 'Menton'} Week {week} is already loaded; applying replaces it.</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={!text.trim()} onClick={() => { setDone(''); setPreview(run(idx.ds, kind, week, text)); }}>Preview</button>
        <button type="button" className="btn btn-primary" disabled={!preview || 'error' in preview} onClick={apply}>Apply</button>
      </div>
      <div role="status" aria-live="polite" className="text-sm">
        {done && <p className="text-gain">{done}</p>}
        {preview && 'error' in preview && <p className="text-loss">{preview.error}</p>}
        {preview && !('error' in preview) && (
          <div className="grid gap-1 border-l-[3px] border-accent bg-surface px-4 py-2">
            {preview.rep.changes.map((c) => <p key={c}>{c}</p>)}
            {preview.rep.created.length > 0 && <p>New players: {preview.rep.created.join(', ')}</p>}
            {preview.rep.unmatched.length > 0 && <p className="text-even">Skipped (no match and no position): {preview.rep.unmatched.join(', ')}. Fix the spelling or add a position to keep them.</p>}
            {preview.rep.warnings.map((w) => <p key={w} className="text-even">{w}</p>)}
          </div>
        )}
      </div>
    </Section>
  );
}
