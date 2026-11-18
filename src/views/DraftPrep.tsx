// Draft prep (Nic's pre-draft board): cost, worth and edge for every player left after keepers.
// Loads public/seed/draft-prep.json once. Behind a password screen while Nic builds it.
// shortcut: password screen only, the data is public in the repo; revisit if Nic shares the tool or wants real privacy.
import { useEffect, useMemo, useState } from 'react';
import { draftPrepUrl, validateDraftPrep, type DraftPrep as Prep } from '../data/draftPrep.ts';
import { priceBoard, type PrepRow } from '../engine/draftPrep.ts';
import { Empty, fmt, PosMark, Section, signed, tone } from '../ui/components.tsx';
import { DataTable, TableBar, useTable, type Col, type FilterDef } from '../ui/table.tsx';

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

let file: Promise<Prep> | null = null;
const loadPrep = () => {
  file ??= fetch(draftPrepUrl(import.meta.env.BASE_URL), { cache: 'no-cache' })
    .then((r) => { if (!r.ok) throw new Error(`draft prep file: HTTP ${r.status}`); return r.json(); })
    .then((raw) => { const v = validateDraftPrep(raw); if (!v.ok) throw new Error(v.errors.join('; ')); return v.value; });
  file.catch(() => { file = null; });
  return file;
};

export default function DraftPrep() {
  const [open, setOpen] = useState(readUnlocked);
  if (!open) return <Section title="Draft prep"><Lock onOpen={() => setOpen(true)} /></Section>;
  return <Board />;
}

function Board() {
  const [prep, setPrep] = useState<Prep | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { loadPrep().then(setPrep, (e: Error) => setErr(e.message)); }, []);
  const board = useMemo(() => (prep ? priceBoard(prep) : null), [prep]);
  const rows = useMemo(() => (board ? board.rows.filter((r) => r.price > 0 || (r.vorp ?? 0) > 0 || r.keeper) : []), [board]);

  const filters = useMemo<FilterDef<PrepRow>[]>(() => [
    { id: 'pos', label: 'Position', options: [['ANY', 'Any position'], ['QB', 'QB'], ['RB', 'RB'], ['WR', 'WR'], ['TE', 'TE']], test: (r, v) => r.pos === v },
    { id: 'show', label: 'Shows', options: [['ANY', 'Everyone'], ['open', 'Up for auction'], ['kept', 'Keepers only']], test: (r, v) => (v === 'open' ? !r.keeper : !!r.keeper) },
  ], []);
  const search = useMemo(() => ({ placeholder: 'Player name', of: (r: PrepRow) => r.name }), []);
  const cols = useMemo<Col<PrepRow>[]>(() => [
    { id: 'name', label: 'Player', left: true, fixed: true, className: 'min-w-[11rem]', value: (r) => r.name, cell: (r) => <span className="flex items-center gap-2"><PosMark pos={r.pos} /><span>{r.name}</span>{r.keeper && <span className="text-xs text-ink-3">kept ${r.keeper[2]}</span>}</span> },
    { id: 'tier', label: 'Price tier', left: true, className: 'text-ink-2', value: (r) => `${r.pos}${r.rank} ${r.tier}` , cell: (r) => `${r.tier} (${r.pos}${r.rank})` },
    { id: 'cost', label: 'Cost', value: (r) => r.cost, cell: (r) => <b className="font-semibold">${fmt(r.cost, 0)}</b> },
    { id: 'band', label: 'Floor–ceiling', value: (r) => r.ceiling, cell: (r) => `$${r.floor}–${r.ceiling}` },
    { id: 'worth', label: 'Worth', value: (r) => r.worth, cell: (r) => `$${fmt(r.worth, 0)}` },
    { id: 'edge', label: 'Edge', value: (r) => (r.keeper ? null : r.edge), cell: (r) => (r.keeper ? '–' : <span className={tone(r.edge, 2)}>{signed(r.edge, 0)}</span>) },
    { id: 'vtier', label: 'Value tier', value: (r) => r.valueTier, cell: (r) => (r.valueTier == null ? '–' : `${r.pos} ${r.valueTier}`) },
    { id: 'proj', label: 'Proj pts', value: (r) => r.proj, cell: (r) => fmt(r.proj, 0) },
    { id: 'vorp', label: 'Over repl.', hidden: true, value: (r) => r.vorp, cell: (r) => fmt(r.vorp, 0) },
    { id: 'price', label: 'Consensus $', hidden: true, value: (r) => r.price, cell: (r) => `$${r.price}` },
    { id: 'team', label: 'NFL', left: true, hidden: true, value: (r) => r.team },
  ], []);
  const t = useTable('draft-prep', cols, rows, { id: 'cost', dir: -1 }, { filters, search, phone: ['cost', 'worth', 'edge'] });

  if (err) return <Empty>Couldn't load the draft prep file: {err}</Empty>;
  if (!prep || !board) return <Empty>Loading the board…</Empty>;
  const mkt = prep.fit.marketYears.map(([y]) => y).join(', ');
  return (
    <Section title={`${prep.year} draft board`} aside={`${prep.keepers.length} keepers, $${board.keeperSpend} kept`}>
      <p className="headline-sm">${board.moneyLeft.toLocaleString()} left for {board.openSlots} open spots</p>
      <ul className="grid max-w-[75ch] gap-1 text-sm text-ink-2">
        <li><span className="text-ink">Cost</span>: what he should sell for. Consensus price × what the league paid for his price tier ({mkt} auctions) × the money left after keepers. The window is the least and most his slot (RB1, RB2, ...) sold for in the {prep.fit.slotYears[0]}-{prep.fit.slotYears.at(-1)} drafts, and cost never goes over it.</li>
        <li><span className="text-ink">Worth</span>: what his projected points over the last starter are worth, $1 plus ${fmt(board.perVorp, 2)} a point, after shrinking projections the way past ones fell short ({Object.entries(prep.fit.shrink).map(([p, s]) => `${p} ×${s}`).join(', ')}).</li>
        <li><span className="text-ink">Edge</span>: worth − cost. Overpaying is what hurts: 2026 buys more than $10 over worth gave back about $26 each by Week 10.</li>
      </ul>
      <TableBar t={t} noun="players" file={`fwhl-draft-board-${prep.year}`} />
      <DataTable t={t} rowKey={(r) => String(r.i)} minWidth="min-w-[52rem]" empty="No player matches these filters." />
    </Section>
  );
}
