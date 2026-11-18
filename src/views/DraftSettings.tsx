// Draft settings: how each owner bids in the mock auctions (personas from his recent drafts, adjustable
// here) and how many mock auctions the board runs. Saved in this browser; the board reruns on change.
import type { MockFit, Persona, PrepPos } from '../data/draftPrep.ts';
import { PREP_POS } from '../data/draftPrep.ts';
import { Section, Seg } from '../ui/components.tsx';
import { href } from '../app/router.ts';
import { DraftGate, Help, usePersonas } from './draftCommon.tsx';
import { useLeague } from '../data/store.tsx';

export default function DraftSettings() {
  return <DraftGate title="Draft settings">{(f) => <Settings personas={f.personas ?? []} years={f.personaYears ?? []} fit={f.mockDials} />}</DraftGate>;
}

function Slider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-1.5 pr-3" title={`${label}: 1.00 = league average`}>
      <input type="range" min={min} max={max} step={0.05} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: 72 }} className="shrink-0 accent-accent" aria-label={label} />
      <span className={`num w-9 text-right text-xs ${value > 1.04 ? 'text-gain' : value < 0.96 ? 'text-loss' : 'text-ink-3'}`}>{value.toFixed(2)}</span>
    </label>
  );
}

function Settings({ personas, years, fit }: { personas: Persona[]; years: number[]; fit?: MockFit }) {
  const P = usePersonas(personas);
  const me = useLeague().settings.myTeamId;
  const lean = (p: Persona, pos: PrepPos) => <Slider label={`${p.name} ${pos} lean`} value={p.lean[pos]} min={0.3} max={2} onChange={(v) => P.set(p.key, { lean: { [pos]: v } as Persona['lean'] })} />;
  return (
    <div className="grid gap-6">
      <Section title="Mock auctions" aside={<a className="link" href={href('draft')}>Back to the board</a>}>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Seg label="Mock auctions per update" value={String(P.runs)} options={[['100', '100'], ['200', '200'], ['500', '500']] as const} onChange={(v) => P.setRuns(Number(v))} />
          <span className="flex items-center gap-2 text-ink-3">How the mock auctions work <Help label="How the mock auctions work"><ul className="grid gap-1.5 text-sm text-ink-2">
            <li>The other 11 teams buy the open pool, after their keepers, this many times over. Teams nominate in turn the way this league does (top players early, then the middle, then cheap ones; usually a position the nominator doesn't need, sometimes a wild card), and the nominator opens at $1.</li>
            <li>Each owner bids the player's expected cost, adjusted by his persona below, plus some randomness. Nobody bids past his max bid (money left − $1 per other open spot), his position limits, or the most that player's slot has sold for. Once his starters at a position are covered he bids less there, much less past his own usual roster (his 2022-26 average, under Usual roster), and never past the most he has had at a position, so each roster comes out shaped like his real ones.</li>
            <li>The price is the second-highest bid plus $1, scaled so a player sells for about his expected cost on average. In the 2026 test run the mock prices missed real prices by about $6 on average, close to the board's own cost.</li>
            <li><span className="text-ink">Get %</span> on the board: how often nobody else would pay more than your bid (your planned bid, else his expected cost). A tie counts as half. <span className="text-ink">Plan odds</span>: how often every player you planned stays within your bid in the same auction.</li>
          </ul></Help></span>
        </div>
      </Section>
      {fit && (
        <Section title="Fitted to real auctions" aside={`Fit on ${fit.fitOn.join(', ')}, checked on ${fit.checkOn.join(', ')}`}>
          <p className="max-w-[75ch] text-sm text-ink-2">The mock's dials aren't hand-set: they were picked from {fit.combos} combinations by replaying the {fit.fitOn.join(', ')} auction (real board, keepers and owners) and keeping the closest match. Then checked on {fit.checkOn.join(', ')}, which the fit never saw. Rerun with <code>npm run data -- fitmock</code> after a draft is added.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead><tr className="text-left text-ink-3"><th className="py-1">On the {fit.checkOn.join(', ')} auction</th><th className="text-right">Starting dials</th><th className="text-right">Fitted dials</th></tr></thead>
              <tbody>
                {([['Price miss (auctioned players at $5+)', 'price', (v: number) => `$${v.toFixed(2)}`], ['Money left miss per team', 'left', (v: number) => `$${v.toFixed(2)}`], ['Roster shape miss (players per position per team)', 'shape', (v: number) => v.toFixed(2)], ['Real prices inside the mock\'s middle 80% (target 80%)', 'cover', (v: number) => `${Math.round(v * 100)}%`]] as const).map(([label, k, f]) => (
                  <tr key={k} className="border-t border-line"><td className="py-1">{label}</td><td className="num text-right text-ink-2">{f(fit.before[k])}</td><td className="num text-right font-semibold">{f(fit.score[k])}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-ink-3">Dials: bid randomness {fit.dials.noise}, interest past starters {fit.dials.deep}, past a usual roster {fit.dials.extra}, money pressure {fit.dials.pressure}, wild-card nominations {Math.round(fit.dials.wild * 100)}%. Real prices land inside the mock's range less often than they should: real auctions are more surprising than the mock, so read Get % as a guide, not a promise.</p>
        </Section>
      )}
      <Section title="Owner personas" aside={<span className="flex items-center gap-3">{years.length ? `From the ${years[0]}-${years.at(-1)} drafts` : ''}<button type="button" className="link" onClick={() => P.reset()}>Reset all</button></span>}>
        <p className="max-w-[75ch] text-sm text-ink-2">1.00 is the league average. Lean: his share of spend at the position against the league's. Overpay: what he paid over expected price. Stars: his priciest buy each draft. Favorite teams get about 12% more. Your changes are saved in this browser and rerun the board's mock auctions.</p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[74rem] text-sm">
            <thead><tr className="text-left text-ink-3"><th className="py-1">Owner</th>{PREP_POS.map((pos) => <th key={pos}>{pos}</th>)}<th>Overpay</th><th>Stars</th><th>Favorite teams</th><th title="His usual roster after the draft, keepers included (2022-26 average); the mock caps each position at the most he has had">Usual roster</th><th /></tr></thead>
            <tbody>
              {P.list.map((p) => (
                <tr key={p.key} className="border-t border-line">
                  <td className="whitespace-nowrap py-1.5 pr-3"><span className="font-medium">{p.name}</span> <span className="text-xs text-ink-3">{me === p.teamId ? 'you, not simulated' : `${p.drafts} drafts`}</span></td>
                  {PREP_POS.map((pos) => <td key={pos}>{lean(p, pos)}</td>)}
                  <td><Slider label={`${p.name} overpay`} value={p.overpay} min={0.7} max={1.3} onChange={(v) => P.set(p.key, { overpay: v })} /></td>
                  <td><Slider label={`${p.name} stars`} value={p.stars} min={0.6} max={1.5} onChange={(v) => P.set(p.key, { stars: v })} /></td>
                  <td><input defaultValue={p.fav.join(', ')} key={p.fav.join(',')} onBlur={(e) => P.set(p.key, { fav: e.target.value.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter(Boolean) })} placeholder="e.g. KC, GB" className="h-7 w-24 rounded border border-line bg-panel px-1.5 text-xs" aria-label={`${p.name} favorite NFL teams`} /></td>
                  <td className="num whitespace-nowrap text-xs text-ink-2">{p.shape ? (['QB', 'RB', 'WR', 'TE'] as const).map((pos) => `${p.shape![pos]} ${pos}`).join(' · ') : '–'}</td>
                  <td className="text-right">{P.edited(p.key) && <button type="button" className="link text-xs" onClick={() => P.reset(p.key)}>reset</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
