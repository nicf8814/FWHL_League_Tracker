// Shared by the Draft pages (Board, Settings): the password screen, the draft prep file loader, the (i)
// help card and the persona settings (per viewer, in this browser).
// shortcut: password screen only, the data is public in the repo; revisit if Nic shares the tool or wants real privacy.
import { useEffect, useId, useState, type ReactNode } from 'react';
import { draftPrepUrl, validateDraftPrep, type DraftPrepFile, type Persona } from '../data/draftPrep.ts';
import { Empty, Section } from '../ui/components.tsx';

const PASS_HASH = '55174404f557a8209cd5aacf3c54e1a4e2b7bc5b9eaa8254dd570c67d9733685'; // SHA-256 of the password (docs/draft-prep/design.md, Access)
const UNLOCK_KEY = 'fwhl-draft-prep-unlocked';
async function sha256(text: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function readUnlocked() {
  try { return localStorage.getItem(UNLOCK_KEY) === PASS_HASH; } catch { return false; }
}

function Lock({ onOpen }: { onOpen: () => void }) {
  const [text, setText] = useState('');
  const [wrong, setWrong] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if ((await sha256(text)) !== PASS_HASH) { setWrong(true); return; }
    try { localStorage.setItem(UNLOCK_KEY, PASS_HASH); } catch { /* still opens for this visit */ }
    onOpen();
  };
  return (
    <form onSubmit={submit} className="grid max-w-sm gap-3">
      <p className="text-ink-2">This page is private for now.</p>
      <label className="grid gap-1 text-sm">Password
        <input type="password" autoComplete="current-password" value={text} onChange={(e) => { setText(e.target.value); setWrong(false); }} className="h-10 rounded border border-line bg-panel px-3" />
      </label>
      {wrong && <p className="text-sm text-loss">That isn't it.</p>}
      <button type="submit" className="h-10 rounded bg-accent px-4 font-semibold text-white">Open</button>
    </form>
  );
}

let file: Promise<DraftPrepFile> | null = null;
export const loadPrep = () => {
  file ??= fetch(draftPrepUrl(import.meta.env.BASE_URL), { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`draft prep file: HTTP ${r.status}`); return r.json(); })
    .then((raw) => { const v = validateDraftPrep(raw); if (!v.ok) throw new Error(v.errors.join('; ')); return v.value; });
  file.catch(() => { file = null; });
  return file;
};

// An (i) button with the explanation in a card (same pattern as the History page's value help).
export function Help({ label, children }: { label: string; children: ReactNode }) {
  const id = useId().replace(/:/g, '');
  return (
    <>
      <button type="button" popoverTarget={id} className="inline-grid size-7 shrink-0 place-items-center rounded-full border border-rule-strong align-middle font-mono text-xs text-ink-2 hover:bg-sunk" aria-label={label} title={label}>i</button>
      <div id={id} popover="auto" className="popcard" role="dialog" aria-label={label}>
        <p className="mb-2 font-display text-lg font-bold [font-stretch:85%]">{label}</p>
        {children}
      </div>
    </>
  );
}


// The page behind the password, with the draft prep file loaded.
export function DraftGate({ title, children }: { title: string; children: (f: DraftPrepFile) => ReactNode }) {
  const [open, setOpen] = useState(readUnlocked);
  const [f, setF] = useState<DraftPrepFile | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (open) loadPrep().then(setF, (e: Error) => setErr(e.message)); }, [open]);
  if (!open) return <Section title={title}><Lock onOpen={() => setOpen(true)} /></Section>;
  if (err) return <Empty>Couldn't load the draft prep file: {err}</Empty>;
  if (!f) return <Empty>Loading the board…</Empty>;
  return <>{children(f)}</>;
}

// Persona settings: the history-based personas with Nic's changes on top, and the number of mock drafts.
const PERSONA_KEY = 'fwhl-draft-personas'; // { runs, edits: { ownerKey: Partial<Persona> } }
interface PersonaPrefs { runs: number; edits: Record<string, Partial<Persona>> }
const readPrefs = (): PersonaPrefs => { try { return { runs: 100, edits: {}, ...(JSON.parse(localStorage.getItem(PERSONA_KEY) ?? '{}') as Partial<PersonaPrefs>) }; } catch { return { runs: 100, edits: {} }; } };
const prefSubs = new Set<() => void>();
export function usePersonas(defaults: Persona[] = []) {
  const [prefs, setPrefs] = useState<PersonaPrefs>(readPrefs);
  useEffect(() => { const f = () => setPrefs(readPrefs()); prefSubs.add(f); return () => { prefSubs.delete(f); }; }, []);
  const put = (f: (p: PersonaPrefs) => PersonaPrefs) => setPrefs((prev) => {
    const next = f(prev);
    try { localStorage.setItem(PERSONA_KEY, JSON.stringify(next)); } catch { /* lasts for this visit */ }
    queueMicrotask(() => prefSubs.forEach((s) => s()));
    return next;
  });
  const list = defaults.map((p) => { const e = prefs.edits[p.key] ?? {}; return { ...p, ...e, lean: { ...p.lean, ...(e.lean ?? {}) } }; });
  return {
    list,
    runs: prefs.runs,
    edited: (key: string) => !!prefs.edits[key],
    set: (key: string, patch: Partial<Persona>) => put((p) => { const cur = p.edits[key] ?? {}; return { ...p, edits: { ...p.edits, [key]: { ...cur, ...patch, lean: { ...(cur.lean ?? {}), ...(patch.lean ?? {}) } as Persona['lean'] } } }; }),
    reset: (key?: string) => put((p) => { if (!key) return { ...p, edits: {} }; const { [key]: _, ...rest } = p.edits; return { ...p, edits: rest }; }),
    setRuns: (runs: number) => put((p) => ({ ...p, runs })),
  };
}
