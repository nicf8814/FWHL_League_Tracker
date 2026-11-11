import type { Dataset, Settings } from './schema.ts';
import { coerceSettings, validateDataset } from './validate.ts';

// Data-access layer (audit DATA-4). The UI only ever talks to a Repository through the store hooks.
// Today: the bundled seed file + IndexedDB on this device. Later: an HTTP adapter with the same four
// methods, and nothing above this file changes.
export interface Repository {
  loadDataset(): Promise<Dataset>;
  saveDataset(ds: Dataset): Promise<void>;
  resetDataset(): Promise<Dataset>;
  loadSettings(teamIds: ReadonlySet<number> | null): Settings;
  saveSettings(s: Settings): void;
}

const SEED_URL = `${import.meta.env.BASE_URL}seed/fwhl-2026.json`;
const DB = 'fwhl';
const STORE = 'kv';
const DATASET_KEY = 'dataset';
const SETTINGS_KEY = 'fwhl.settings.v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB unavailable'));
  });
}

async function idb<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result as T);
      tx.onerror = tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write failed'));
    });
  } finally {
    db.close();
  }
}

async function fetchSeed(): Promise<Dataset> {
  const res = await fetch(SEED_URL);
  if (!res.ok) throw new Error(`Could not load the league seed file (${res.status}).`);
  const v = validateDataset(await res.json());
  if (!v.ok) throw new Error(`The seed file is invalid: ${v.errors[0]}`);
  return v.value;
}

export const localRepository: Repository = {
  async loadDataset() {
    try {
      const stored = await idb<unknown>('readonly', (s) => s.get(DATASET_KEY));
      if (stored !== undefined) {
        const v = validateDataset(stored);
        if (v.ok) return v.value;
        console.warn('Stored dataset failed validation, falling back to the seed.', v.errors);
      }
    } catch (e) {
      // Private mode or blocked storage: the app still runs from the seed, it just can't keep imports.
      console.warn('IndexedDB read failed; using the seed file.', e);
    }
    return fetchSeed();
  },
  async saveDataset(ds) {
    await idb('readwrite', (s) => s.put(ds, DATASET_KEY));
  },
  async resetDataset() {
    try {
      await idb('readwrite', (s) => s.delete(DATASET_KEY));
    } catch (e) {
      console.warn('IndexedDB delete failed.', e);
    }
    return fetchSeed();
  },
  loadSettings(teamIds) {
    try {
      return coerceSettings(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? 'null'), teamIds);
    } catch {
      return coerceSettings(null, teamIds);
    }
  },
  saveSettings(s) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch {
      // Storage full or blocked: settings stay in memory for this visit.
    }
  },
};

// Backup file = dataset + this device's settings, so nothing is ever trapped in one browser.
export interface BackupFile {
  kind: 'fwhl-backup';
  exportedAt: string;
  dataset: Dataset;
  settings: Settings;
}

export function parseBackup(text: string): Result {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['That file is not valid JSON.'] };
  }
  // Accept a full backup or a bare dataset (what the refresh tasks produce).
  const isBackup = typeof json === 'object' && json !== null && (json as { kind?: unknown }).kind === 'fwhl-backup';
  const v = validateDataset(isBackup ? (json as BackupFile).dataset : json);
  if (!v.ok) return v;
  const teams = new Set(v.value.teams.map((t) => t.id));
  // A bare dataset keeps this device's settings (settings: null).
  return { ok: true, dataset: v.value, settings: isBackup ? coerceSettings((json as BackupFile).settings, teams) : null };
}
type Result = { ok: true; dataset: Dataset; settings: Settings | null } | { ok: false; errors: string[] };
