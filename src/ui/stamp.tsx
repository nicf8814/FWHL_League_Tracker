// Grades are stamped, not pilled: a square ink mark, tilted a few degrees (audit UI-9).
export function Stamp({ grade, size = 'md' }: { grade: string; size?: 'sm' | 'md' | 'lg' }) {
  // Filled ink (Nov 11, item G): green for A/B, gold for C, red for D/F; the letter carries the meaning.
  const c = grade[0] === 'A' || grade[0] === 'B' ? 'bg-gain text-paper' : grade[0] === 'C' ? 'bg-accent text-[#151a17]' : 'bg-loss text-paper';
  const s = size === 'lg' ? 'size-14 text-2xl' : size === 'sm' ? 'size-8 text-sm' : 'size-11 text-xl';
  return (
    <span aria-label={`Grade ${grade}`} className={`stamp inline-grid shrink-0 place-items-center font-display font-extrabold leading-none [font-stretch:75%] ${s} ${c} -rotate-3`}>
      {grade}
    </span>
  );
}
