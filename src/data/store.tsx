import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { buildIndex, deadlineInfo, type Index } from '../engine/league.ts';
import { buildBase, buildValues, type Base, type Values } from '../engine/model.ts';
import type { SimInput, SimResult } from '../engine/sim.ts';
import { simulateHistory, simulateOdds } from '../engine/simClient.ts';
import { localRepository, parseBackup, type BackupFile, type Repository } from './repository.ts';
import type { Dataset, SavedTrade, Settings } from './schema.ts';

// The only place components get league data from. Views call useLeague(); nothing imports storage.

interface League {
  idx: Index;
  base: Base;
  values: Values;
  valuesVersion: number;
  sim: SimResult | null;
  simInput: SimInput;
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => void;
  exportBackup: () => BackupFile;
  importBackup: (text: string) => Promise<{ ok: true } | { ok: false; errors: string[] }>;
  resetData: () => Promise<void>;
  replaceDataset: (ds: Dataset) => Promise<void>;
  savedTrades: SavedTrade[];
  setSavedTrades: (next: (list: SavedTrade[]) => SavedTrade[]) => void;
}

const Ctx = createContext<League | null>(null);

export function useLeague(): League {
  const v = useContext(Ctx);
  if (!v) throw new Error('useLeague() used outside <LeagueProvider>');
  return v;
}

// Debounce for value sliders: the UI updates now, the engine catches up when dragging pauses.
export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

// The deadline label and post-deadline mode (FEAT-11) flip on their own while the app is open.
export function useDeadline() {
  const { idx } = useLeague();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);
  return deadlineInfo(idx, now);
}

export function useSimHistory(): Record<number, Record<number, number>> | null {
  const { simInput, idx } = useLeague();
  const [h, setH] = useState<Record<number, Record<number, number>> | null>(null);
  useEffect(() => {
    let live = true;
    setH(null);
    simulateHistory(simInput, idx.scoresThrough).then((r) => live && setH(r), () => live && setH(null));
    return () => {
      live = false;
    };
  }, [simInput, idx.scoresThrough]);
  return h;
}

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; ds: Dataset };

export function LeagueProvider({ children, repo = localRepository }: { children: ReactNode; repo?: Repository }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [settings, setSettingsState] = useState<Settings>(() => repo.loadSettings(null));
  const [sim, setSim] = useState<SimResult | null>(null);
  const [savedTrades, setSaved] = useState<SavedTrade[]>([]);
  useEffect(() => {
    let live = true;
    repo.loadSavedTrades().then((l) => live && setSaved(l));
    return () => {
      live = false;
    };
  }, [repo]);
  const setSavedTrades = useCallback(
    (fn: (list: SavedTrade[]) => SavedTrade[]) =>
      setSaved((cur) => {
        const next = fn(cur);
        repo.saveSavedTrades(next).catch((e: unknown) => console.warn('Could not save trades on this device.', e));
        return next;
      }),
    [repo],
  );

  useEffect(() => {
    let live = true;
    repo.loadDataset().then(
      (ds) => {
        if (!live) return;
        setSettingsState(repo.loadSettings(new Set(ds.teams.map((t) => t.id))));
        setLoad({ state: 'ready', ds });
      },
      (e: unknown) => live && setLoad({ state: 'error', message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      live = false;
    };
  }, [repo]);

  const setSettings = useCallback(
    (patch: Partial<Settings>) =>
      setSettingsState((s) => {
        const next = { ...s, ...patch };
        repo.saveSettings(next);
        return next;
      }),
    [repo],
  );

  const ds = load.state === 'ready' ? load.ds : null;
  const idx = useMemo(() => (ds ? buildIndex(ds) : null), [ds]);
  const baseOpts = useMemo(() => ({ median: settings.rampMedian, returns: settings.returnWeeks }), [settings.rampMedian, settings.returnWeeks]);
  const base = useMemo(() => (idx ? buildBase(idx, settings.productionRamp, baseOpts) : null), [idx, settings.productionRamp, baseOpts]);
  const simInput = useMemo<SimInput | null>(() => {
    if (!base) return null;
    const { idx: ix } = base;
    // Rounded so float noise never busts the cache.
    const strength = Object.fromEntries(ix.teamIds.map((t) => [t, Math.round((base.strength[t] ?? 0) * 100) / 100]));
    return { teamIds: ix.teamIds, games: ix.games, strength, cfg: ix.ds.season.sim, top6Weeks: ix.ds.season.top6Weeks, seedsByRecord: ix.ds.season.seedsByRecord };
  }, [base]);

  useEffect(() => {
    if (!simInput) return;
    let live = true;
    simulateOdds(simInput).then(
      (r) => live && setSim(r),
      (e: unknown) => console.error('Playoff simulation failed', e),
    );
    return () => {
      live = false;
    };
  }, [simInput]);

  const valueSettings = useDebounced(settings, 150);
  const version = useRef(0);
  const values = useMemo(() => {
    if (!base) return null;
    version.current++;
    return buildValues(base, valueSettings, sim);
  }, [base, valueSettings, sim]);

  const exportBackup = useCallback((): BackupFile => {
    if (!ds) throw new Error('No data loaded yet.');
    return { kind: 'fwhl-backup', exportedAt: new Date().toISOString(), dataset: ds, settings, savedTrades };
  }, [ds, settings, savedTrades]);

  const importBackup = useCallback(
    async (text: string) => {
      const r = parseBackup(text);
      if (!r.ok) return r;
      await repo.saveDataset(r.dataset); // save first: a failed write must not leave the UI on unsaved data
      setSim(null);
      setLoad({ state: 'ready', ds: r.dataset });
      const teams = new Set(r.dataset.teams.map((t) => t.id));
      const next = r.settings ?? { ...settings, myTeamId: settings.myTeamId !== null && teams.has(settings.myTeamId) ? settings.myTeamId : null };
      repo.saveSettings(next);
      setSettingsState(next);
      if (r.savedTrades) setSavedTrades(() => r.savedTrades!);
      return { ok: true as const };
    },
    [repo, settings, setSavedTrades],
  );

  // In-app imports (FEAT-1): the caller has already validated ds. Saved before it's shown, like importBackup.
  const replaceDataset = useCallback(async (next: Dataset) => {
    await repo.saveDataset(next);
    setSim(null);
    setLoad({ state: 'ready', ds: next });
  }, [repo]);

  const resetData = useCallback(async () => {
    const fresh = await repo.resetDataset();
    setSim(null);
    setLoad({ state: 'ready', ds: fresh });
  }, [repo]);

  if (load.state === 'loading') return <Splash text="Loading league data…" />;
  if (load.state === 'error') return <Splash text={load.message} error />;
  if (!idx || !base || !values || !simInput) return <Splash text="Preparing…" />;
  return (
    <Ctx.Provider value={{ idx, base, values, valuesVersion: version.current, sim, simInput, settings, setSettings, exportBackup, importBackup, resetData, replaceDataset, savedTrades, setSavedTrades }}>
      {children}
    </Ctx.Provider>
  );
}

function Splash({ text, error }: { text: string; error?: boolean }) {
  return (
    <div className="grid min-h-dvh place-items-center bg-paper p-6 text-center">
      <div className="max-w-sm">
        <p className="font-display text-xl font-bold [font-stretch:80%]">FWHL</p>
        <p role={error ? 'alert' : 'status'} className={error ? 'mt-2 text-loss' : 'mt-2 text-ink-3'}>
          {text}
        </p>
        {error && (
          <button className="btn mt-4" onClick={() => location.reload()}>
            Try again
          </button>
        )}
      </div>
    </div>
  );
}
