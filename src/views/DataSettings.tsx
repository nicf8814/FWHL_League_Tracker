import { useId, useRef, useState } from 'react';
import { DEFAULT_SETTINGS, type Settings } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { dataGaps, freshness } from '../engine/league.ts';
import { Section, Seg, TeamSelect } from '../ui/components.tsx';
import { getTheme, setTheme, type Theme } from '../ui/theme.ts';
import { useFull } from '../ui/detail.ts';
import { ImportChart } from './ImportChart.tsx';

export default function DataSettings() {
  const { idx, settings, setSettings } = useLeague();
  const full = useFull();
  const fresh = freshness(idx);
  const ds = idx.ds;
  return (
    <div className="grid max-w-4xl grid-cols-1 gap-10">
      <Section title="Your team">
        <div className="max-w-xs"><TeamSelect label="My team on this device" value={settings.myTeamId} allowEmpty="Not set" onChange={(t) => setSettings({ myTeamId: t })} /></div>
        <p className="text-sm text-ink-3">Stored in this browser only. Each league mate picks their own.</p>
        <ThemePicker />
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

      {full ? <>
        <ReturnWeeks />
        <Gaps />
        <EngineSettings settings={settings} onChange={setSettings} />
        <ImportChart />
      </> : <p className="text-sm text-ink-3">Switch to Full at the top for injury return weeks, data gaps, the value engine and chart import.</p>}
      <Backup />
      <p className="text-sm"><a className="link" href="#/method">How the values, odds and grades are worked out</a></p>
    </div>
  );
}

// Old app: hand-set return weeks. Each one overrides the data's estimate on this device, reruns the
// season sim and moves values; clear it to go back to the data.
function ReturnWeeks() {
  const { idx, base, settings, setSettings } = useLeague();
  const now = idx.currentWeek;
  const listed = [...new Set([...idx.injury.keys(), ...base.stale.keys(), ...Object.keys(settings.returnWeeks)])]
    .filter((p) => idx.owner.has(p) && (idx.injury.get(p)?.status !== 'Q' || settings.returnWeeks[p] !== undefined))
    .sort((a, b) => (idx.owner.get(a)! - idx.owner.get(b)!) || a.localeCompare(b));
  const set = (p: string, v: string) => {
    const next = { ...settings.returnWeeks };
    if (v === '') delete next[p]; else next[p] = Number(v);
    setSettings({ returnWeeks: next });
  };
  const weeks = Array.from({ length: 18 - now }, (_, i) => now + 1 + i).filter((w) => w < 18);
  return (
    <Section title="Injury return weeks" aside={Object.keys(settings.returnWeeks).length ? `${Object.keys(settings.returnWeeks).length} set by you` : 'From the data'}>
      <p className="max-w-[70ch] text-sm text-ink-2">Out, IR and missed-games players on rosters. Pick a week to override the estimate on this device; it changes availability, values and playoff odds.</p>
      {!listed.length ? <p className="text-sm text-ink-3">Nobody is out.</p> : (
        <ul className="grid">
          {listed.map((p) => {
            const mine = settings.returnWeeks[p];
            return (
              <li key={p} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-rule py-2 text-sm">
                <span className="min-w-0"><b className="font-medium">{idx.players.get(p)?.name}</b> <span className="text-ink-3">· {idx.teams.get(idx.owner.get(p)!)?.name} · {idx.injury.get(p)?.note || (base.stale.has(p) ? 'missed recent games' : idx.injury.get(p)?.status)}</span></span>
                <label className="flex items-center gap-2">
                  <span className="sr-only">Return week for {idx.players.get(p)?.name}</span>
                  {mine !== undefined && <span className="size-2 rounded-full bg-accent" aria-hidden="true" />}
                  <select className="field w-auto py-1" value={mine ?? ''} onChange={(e) => set(p, e.target.value)}>
                    <option value="">Data estimate{base.returnWeek(p) && mine === undefined ? ` (Wk ${base.returnWeek(p) >= 18 ? 'season' : base.returnWeek(p)})` : ''}</option>
                    <option value={now}>Playing now</option>
                    {weeks.map((w) => <option key={w} value={w}>Week {w}</option>)}
                    <option value={18}>Out for season</option>
                  </select>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Gaps() {
  const { idx } = useLeague();
  const gaps = dataGaps(idx);
  return (
    <Section title="Data gaps" aside={gaps.length ? `${gaps.length} to know about` : 'None'}>
      {!gaps.length ? <p className="text-sm text-ink-2">Nothing missing.</p> : (
        <ul className="grid">
          {gaps.map((g) => (
            <li key={g.what} className="grid gap-0.5 border-b border-rule py-2 text-sm">
              <span className="flex justify-between gap-3"><b className="font-medium">{g.what}</b><span className="num shrink-0 text-ink-3">{g.total > 1 ? `${g.count} of ${g.total}` : ''}</span></span>
              <span className="text-ink-2">{g.fix}</span>
              {g.names && g.names.length <= 40 && g.names.length < g.total && <details><summary className="cursor-pointer text-ink-3">Show who</summary><p className="text-ink-2">{g.names.join(', ')}</p></details>}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

function ThemePicker() {
  const [t, setT] = useState<Theme>(getTheme);
  return (
    <div className="grid grid-cols-1 gap-1">
      <span className="text-sm text-ink-3">Theme</span>
      <Seg label="Theme" value={t} options={[['system', 'Match device'], ['light', 'Light'], ['dark', 'Dark']] as const} onChange={(v) => { setTheme(v); setT(v); }} />
    </div>
  );
}

// FEAT-13: presets, a reset for this section, and a mark on anything changed from the default.
const PRESETS: [string, string, Partial<Settings>][] = [
  ['default', 'Default', {}],
  ['market', 'What managers pay', { marketShare: 85 }],
  ['scoring', 'What scores', { marketShare: 25 }],
];
const ENGINE_KEYS = ['marketShare', 'chartWeights', 'injuryStrength', 'useNews', 'productionRamp', 'rampMedian', 'handcuff'] as const;
const engineOf = (s: Settings) => JSON.stringify(ENGINE_KEYS.map((k) => s[k]));

function EngineSettings({ settings: s, onChange }: { settings: Settings; onChange: (p: Partial<Settings>) => void }) {
  const cw = s.chartWeights, D = DEFAULT_SETTINGS, dw = D.chartWeights;
  const defaults = Object.fromEntries(ENGINE_KEYS.map((k) => [k, D[k]])) as Partial<Settings>;
  const preset = PRESETS.find(([, , p]) => engineOf({ ...s, ...defaults, ...p }) === engineOf(s))?.[0] ?? 'custom';
  return (
    <Section title="Value engine" aside={<button type="button" className="btn btn-quiet" disabled={preset === 'default'} onClick={() => onChange(defaults)}>Reset this section</button>}>
      <p className="max-w-[70ch] text-sm text-ink-2">Trade value blends what league mates will accept (the charts) with what actually scores (ESPN projections in your scoring, blended with season production). Changes apply as you drag; the playoff simulation doesn't rerun for these. A gold mark means a setting differs from the default.</p>
      <div className="grid grid-cols-1 gap-1">
        <span className="text-sm text-ink-3">Preset{preset === 'custom' ? ' (custom)' : ''}</span>
        <Seg label="Preset" value={preset} options={PRESETS.map(([id, label]) => [id, label] as const)} onChange={(id) => onChange({ ...defaults, ...PRESETS.find((p) => p[0] === id)![2] })} />
      </div>
      <div className="grid gap-x-10 gap-y-5 md:grid-cols-2">
        <Range label="Market vs scoring" value={s.marketShare} def={D.marketShare} min={0} max={100} step={5} display={`${s.marketShare} / ${100 - s.marketShare}`} onChange={(v) => onChange({ marketShare: v })} />
        <Range label="Injury discount strength" value={Math.round(s.injuryStrength * 100)} def={D.injuryStrength * 100} min={0} max={100} step={5} display={`${Math.round(s.injuryStrength * 100)}%`} onChange={(v) => onChange({ injuryStrength: v / 100 })} />
        <Range label="Peaked weight" value={cw.peaked} def={dw.peaked} min={0} max={100} step={5} display={String(cw.peaked)} onChange={(v) => onChange({ chartWeights: { ...cw, peaked: v } })} />
        <Range label="Menton weight" value={cw.menton} def={dw.menton} min={0} max={100} step={5} display={String(cw.menton)} onChange={(v) => onChange({ chartWeights: { ...cw, menton: v } })} />
      </div>
      {cw.peaked + cw.menton === 0 && <p role="alert" className="text-sm text-loss">All chart weights are 0, so the market side is empty and values come from scoring only.</p>}
      <div className="grid gap-2">
        <Check label="Production ramp: blend each player's season average into his projection as games are played" checked={s.productionRamp} changed={s.productionRamp !== D.productionRamp} onChange={(v) => onChange({ productionRamp: v })} />
        <Check label="Ramp toward each player's median game instead of his average (needs 3+ games), so one big game or dud doesn't move him" checked={s.rampMedian} changed={s.rampMedian !== D.rampMedian} onChange={(v) => onChange({ rampMedian: v })} />
        <Check label="Handcuff insurance: a backup RB counts for the team that also holds his starter (McCaffrey to Black, Walker to E. Johnson)" checked={s.handcuff} changed={s.handcuff !== D.handcuff} onChange={(v) => onChange({ handcuff: v })} />
        <Check label="Apply role and news adjustments" checked={s.useNews} changed={s.useNews !== D.useNews} onChange={(v) => onChange({ useNews: v })} />
      </div>
    </Section>
  );
}

const Changed = () => <><span className="ml-1.5 inline-block size-2 rounded-full bg-accent align-middle" aria-hidden="true" /><span className="sr-only"> (changed from default)</span></>;

function Range({ label, value, def, min, max, step, display, onChange }: { label: string; value: number; def: number; min: number; max: number; step: number; display: string; onChange: (v: number) => void }) {
  const id = useId();
  const changed = Math.abs(value - def) > 1e-9;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-sm text-ink-3">{label}{changed && <Changed />}</label>
        <span className="flex items-baseline gap-2">
          {changed && <button type="button" className="link text-xs text-ink-3" onClick={() => onChange(def)} aria-label={`Reset ${label} to ${def}`}>Reset</button>}
          <span className="num text-sm">{display}</span>
        </span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
}

function Check({ label, checked, changed, onChange }: { label: string; checked: boolean; changed?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-start gap-3 pt-2.5 text-sm">
      <input type="checkbox" className="mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}{changed && <Changed />}</span>
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
