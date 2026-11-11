import { useId, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { freshness } from '../engine/league.ts';
import { Section, TeamSelect } from '../ui/components.tsx';
import { ImportChart } from './ImportChart.tsx';

export default function DataSettings() {
  const { idx, settings, setSettings } = useLeague();
  const fresh = freshness(idx);
  const ds = idx.ds;
  return (
    <div className="grid max-w-4xl grid-cols-1 gap-10">
      <Section title="Your team">
        <div className="max-w-xs"><TeamSelect label="My team on this device" value={settings.myTeamId} allowEmpty="Not set" onChange={(t) => setSettings({ myTeamId: t })} /></div>
        <p className="text-sm text-ink-3">Stored in this browser only. Each league mate picks their own.</p>
      </Section>

      <Section title="Data sources" aside={`Week ${idx.currentWeek} · scores through Week ${idx.scoresThrough}`}>
        <div className="overflow-x-auto">
          <table className="tbl">
            <thead><tr><th className="l">Source</th><th className="l">As of</th><th className="l">Age</th></tr></thead>
            <tbody>
              {fresh.map((f) => (
                <tr key={f.id}>
                  <td className="l">{f.label}</td>
                  <td className="l n">{f.asOf}</td>
                  <td className={`l ${f.stale ? 'font-medium text-even' : 'text-ink-3'}`}>{f.age}{f.stale ? ' · refresh before trusting values' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="num text-xs text-ink-3">
          {ds.players.length} players · {ds.rosters.length} roster spots · {ds.games.length} games · {ds.playerWeeks.length} player-weeks · {ds.transactions.length} trades and vetoes · schema v{ds.schemaVersion}
        </p>
      </Section>

      <EngineSettings settings={settings} onChange={setSettings} />
      <ImportChart />
      <Backup />
    </div>
  );
}

function EngineSettings({ settings: s, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const cw = s.chartWeights;
  return (
    <Section title="Value engine" aside={<button type="button" className="btn btn-quiet" onClick={() => onChange({ ...DEFAULT_SETTINGS, myTeamId: s.myTeamId })}>Reset to defaults</button>}>
      <p className="max-w-[70ch] text-sm text-ink-2">Trade value blends what league mates will accept (the charts) with what actually scores (ESPN projections in your scoring, blended with season production). Changes apply as you drag; the playoff simulation doesn't rerun for these.</p>
      <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
        <Range label="Market vs scoring" value={s.marketShare} min={0} max={100} step={5} display={`${s.marketShare} / ${100 - s.marketShare}`} onChange={(v) => onChange({ marketShare: v })} />
        <Range label="Injury discount strength" value={Math.round(s.injuryStrength * 100)} min={0} max={100} step={5} display={`${Math.round(s.injuryStrength * 100)}%`} onChange={(v) => onChange({ injuryStrength: v / 100 })} />
        <Range label="Peaked weight" value={cw.peaked} min={0} max={100} step={5} display={String(cw.peaked)} onChange={(v) => onChange({ chartWeights: { ...cw, peaked: v } })} />
        <Range label="Menton weight" value={cw.menton} min={0} max={100} step={5} display={String(cw.menton)} onChange={(v) => onChange({ chartWeights: { ...cw, menton: v } })} />
        <Range label="FantasyPros weight" value={cw.fantasypros} min={0} max={100} step={5} display={String(cw.fantasypros)} onChange={(v) => onChange({ chartWeights: { ...cw, fantasypros: v } })} />
      </div>
      {cw.peaked + cw.menton + cw.fantasypros === 0 && <p role="alert" className="text-sm text-loss">All chart weights are 0, so the market side is empty and values come from scoring only.</p>}
      <div className="grid gap-2">
        <Check label="Production ramp: blend each player's season average into his projection as games are played" checked={s.productionRamp} onChange={(v) => onChange({ productionRamp: v })} />
        <Check label="Apply role and news adjustments" checked={s.useNews} onChange={(v) => onChange({ useNews: v })} />
      </div>
    </Section>
  );
}

function Range({ label, value, min, max, step, display, onChange }: { label: string; value: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void }) {
  const id = useId();
  return (
    <div>
      <div className="flex items-baseline justify-between"><label htmlFor={id} className="text-sm text-ink-3">{label}</label><span className="num text-sm">{display}</span></div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-start gap-3 pt-2.5 text-sm">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

function Backup() {
  const { exportBackup, importBackup, resetData, idx } = useLeague();
  const file = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'error'; text: string; list?: string[] } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const download = () => {
    const blob = new Blob([JSON.stringify(exportBackup())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `fwhl-backup-${idx.ds.meta.season}-wk${idx.currentWeek}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg({ kind: 'ok', text: 'Backup downloaded.' });
  };
  const onFile = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 20 * 1024 * 1024) { setMsg({ kind: 'error', text: 'That file is over 20 MB, which is far bigger than a league backup.' }); return; }
    try {
      const r = await importBackup(await f.text());
      setMsg(r.ok ? { kind: 'ok', text: `Imported ${f.name}.` } : { kind: 'error', text: `Nothing was changed. ${f.name} has problems:`, list: r.errors });
    } catch (e) {
      setMsg({ kind: 'error', text: `Import failed and nothing was changed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      if (file.current) file.current.value = '';
    }
  };
  const reset = async () => {
    if (!confirmReset) { setConfirmReset(true); return; }
    setConfirmReset(false);
    try { await resetData(); setMsg({ kind: 'ok', text: 'League data reset to the bundled 2026 data.' }); }
    catch (e) { setMsg({ kind: 'error', text: `Reset failed: ${e instanceof Error ? e.message : String(e)}` }); }
  };

  return (
    <Section title="Backup and restore">
      <p className="max-w-[70ch] text-sm text-ink-2">Everything lives in this browser. A backup holds the league data, your settings and your saved trades: export one to keep a copy or move to another device. Import takes a backup or a refreshed league data file; it is checked first, and nothing changes if it fails.</p>
      <div className="flex flex-wrap gap-3">
        <button type="button" className="btn btn-primary" onClick={download}>Export backup</button>
        <button type="button" className="btn" onClick={() => file.current?.click()}>Import JSON</button>
        <input ref={file} type="file" accept="application/json,.json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => onFile(e.target.files?.[0])} />
        <button type="button" className={`btn ${confirmReset ? 'border-loss text-loss' : ''}`} onClick={reset} onBlur={() => setConfirmReset(false)}>
          {confirmReset ? 'Tap again to reset' : 'Reset to bundled data'}
        </button>
      </div>
      {msg && (
        <div role={msg.kind === 'error' ? 'alert' : 'status'} className={`border px-4 py-2 text-sm ${msg.kind === 'error' ? 'border-loss bg-loss-soft' : 'border-gain bg-gain-soft'}`}>
          {msg.text}
          {msg.list && <ul className="mt-1 list-inside list-disc">{msg.list.map((e) => <li key={e}>{e}</li>)}</ul>}
        </div>
      )}
    </Section>
  );
}
