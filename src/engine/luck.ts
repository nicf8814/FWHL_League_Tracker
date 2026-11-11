import type { TeamId } from '../data/schema.ts';
import { rank6 } from './sim.ts';

// Schedule luck from the all-play method. Each week a team is compared with every other score:
// beating 8 of 11 is worth 8/11 of an expected win, whoever it actually played.
// Luck = actual wins - expected wins. Ties count half, in both the record and the comparison.
// Top 6 weeks have no opponent to be lucky against, so expected equals the actual result there.
// Takes plain game rows so the league history can run the same math on past seasons.
export interface Luck {
  games: number;
  wins: number; // actual, ties as half
  xw: number; // expected wins
  luck: number; // wins - xw
  allPlay: { w: number; l: number; t: number }; // record against every team, every week
}

// Same shape as GameRow, with any team key (past seasons key teams by owner).
export type Row<K> = readonly [week: number, home: K, away: K, homePts: number | null, awayPts: number | null, final: boolean];

export function luck<K = TeamId>(teamIds: readonly K[], games: readonly Row<K>[], top6Weeks: readonly number[] = []): Map<K, Luck> {
  const out = new Map<K, Luck>(teamIds.map((i) => [i, { games: 0, wins: 0, xw: 0, luck: 0, allPlay: { w: 0, l: 0, t: 0 } }]));
  const weeks = new Map<number, { team: K; pts: number; opp: number }[]>();
  for (const [w, h, a, hs, as, fin] of games) {
    if (!fin || hs === null || as === null || !out.has(h) || !out.has(a)) continue;
    const arr = weeks.get(w) ?? [];
    arr.push({ team: h, pts: hs, opp: as }, { team: a, pts: as, opp: hs });
    weeks.set(w, arr);
  }
  for (const [w, rows] of weeks) {
    if (rows.length < 2) continue;
    const top6 = top6Weeks.includes(w);
    for (const r of rows) {
      const L = out.get(r.team)!;
      const others = rows.filter((x) => x !== r).map((x) => x.pts);
      const beat = others.filter((x) => x < r.pts).length;
      const tied = others.filter((x) => x === r.pts).length;
      L.allPlay.w += beat; L.allPlay.t += tied; L.allPlay.l += others.length - beat - tied;
      const res = top6 ? ({ W: 1, T: 0.5, L: 0 } as const)[rank6(r.pts, others)] : r.pts > r.opp ? 1 : r.pts === r.opp ? 0.5 : 0;
      L.games++;
      L.wins += res;
      L.xw += top6 ? res : (beat + tied / 2) / others.length;
    }
  }
  for (const L of out.values()) L.luck = L.wins - L.xw;
  return out;
}
