// The live board's inputs, shared by the Draft pages: next year's stand-in board filled from this season
// (useLiveEdition) and the keepers with the viewer's switches (useKeepers).
import { useMemo, useState } from 'react';
import { playerKey } from '../data/drafts.ts';
import { PREP_POS, type DraftPrep as Prep, type KeeperRow, type PrepPos } from '../data/draftPrep.ts';
import { useLeague } from '../data/store.tsx';
import { SEASON_GAMES, standInBoard, type SeasonLine } from '../engine/draftPrep.ts';
import { keeperCalls, keeperSet } from '../engine/keepers.ts';
import { teamName } from '../engine/league.ts';

// Next year's board, filled from this season: points per game and games played (every week with
// points), the latest trade values, and injuries (games he can still play this season).
export function useLiveEdition(prep: Prep) {
  const { idx, base } = useLeague();
  return useMemo(() => {
    const si = prep.standIn!;
    const played = new Map<string, { pts: number; games: number }>();
    for (const [w, week] of idx.weeks) {
      if (w > idx.scoresThrough) continue;
      for (const [pid, pw] of week) {
        if (!pw.points || pw.points <= 0) continue;
        const g = played.get(pid) ?? { pts: 0, games: 0 };
        g.pts += pw.points; g.games++;
        played.set(pid, g);
      }
    }
    const lines: SeasonLine[] = [];
    for (const [pid, p] of idx.players) {
      if (!(PREP_POS as readonly string[]).includes(p.pos)) continue;
      const g = played.get(pid);
      const vals = [idx.chart.peaked.get(pid), idx.chart.menton.get(pid)].filter((v): v is number => v != null);
      if (!g && !vals.length) continue;
      const back = base.returnWeek(pid);
      let left = 0;
      for (let w = idx.scoresThrough + 1; w <= SEASON_GAMES; w++) if (back < SEASON_GAMES + 1 && w >= back) left++;
      lines.push({ name: p.name, pos: p.pos as PrepPos, team: p.nflTeam ?? '', ppg: g ? g.pts / g.games : null, games: g?.games ?? 0, share: Math.min(1, ((g?.games ?? 0) + left) / SEASON_GAMES), value: vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null });
    }
    const { board, rows } = standInBoard(si, lines);
    // Keeper guesses: each roster's best calls from the Keepers page (locked contracts first).
    const calls = keeperCalls(base);
    const keepers: KeeperRow[] = [];
    for (const [team, roster] of idx.roster) {
      for (const pid of keeperSet(calls, roster, idx.ds.season.keeper.slots)) {
        const p = idx.players.get(pid), c = calls.get(pid);
        if (p && c?.cost != null && (PREP_POS as readonly string[]).includes(p.pos)) keepers.push([p.name, p.pos as PrepPos, c.cost, teamName(idx, team)]);
      }
    }
    // Everyone with a keeper cost can be switched on.
    const candidates: KeeperRow[] = idx.ds.keepers.flatMap((k) => {
      const p = idx.players.get(k.playerId), team = idx.owner.get(k.playerId);
      return p && k.cost != null && team !== undefined && (PREP_POS as readonly string[]).includes(p.pos) ? [[p.name, p.pos as PrepPos, k.cost, teamName(idx, team)] as KeeperRow] : [];
    });
    return { prep: { ...prep, board }, rows, keepers, candidates };
  }, [prep, idx, base]);
}

const SWITCH_KEY = 'fwhl-draft-prep-keepers'; // per viewer: keeper switches by year { year: { name|pos: kept } }


type Switches = Record<string, Record<string, boolean>>;
// One shared empty set of switches: a fresh {} on every render made keepers (and everything priced from
// them) look new each time, so the Board reran its mock auctions in a loop while it sat open.
const NO_SWITCHES: Record<string, boolean> = {};
function readSwitches(): Switches {
  try { return JSON.parse(localStorage.getItem(SWITCH_KEY) ?? '{}') as Switches; } catch { return {}; }
}
function saveSwitches(s: Switches) {
  try { localStorage.setItem(SWITCH_KEY, JSON.stringify(s)); } catch { /* switches last for this visit */ }
}

export function useKeepers(year: number, defaultKeepers: KeeperRow[], candidates: KeeperRow[] = defaultKeepers) {
  const [switches, setSwitches] = useState<Switches>(readSwitches);
  const mine = switches[year] ?? NO_SWITCHES;
  const keepers = useMemo(() => {
    const on = new Set(defaultKeepers.map((k) => keyOf(k[0], k[1])));
    for (const [k, v] of Object.entries(mine)) if (v) on.add(k); else on.delete(k);
    return candidates.filter((k) => on.has(keyOf(k[0], k[1])));
  }, [defaultKeepers, candidates, mine]);
  const candidateKeys = useMemo(() => new Map(candidates.map((k) => [keyOf(k[0], k[1]), k])), [candidates]);
  const toggle = (key: string, on: boolean) => {
    const next = { ...switches, [year]: { ...mine, [key]: on } };
    setSwitches(next); saveSwitches(next);
  };
  const reset = () => { const next = { ...switches }; delete next[year]; setSwitches(next); saveSwitches(next); };
  const changed = Object.keys(mine).length;
  return { keepers, candidateKeys, toggle, reset, changed, mine };
}
const keyOf = (name: string, pos: string) => playerKey(name, pos);
