// Builds public/seed/careers.json: what every player did in this league, season by season, from the
// weekly lineup files. Facts only (points, weeks, whose roster, champion or not); the all-time
// rankings are worked out in the browser (src/engine/careers.ts) so the live season can be added to
// them without rebuilding this file.
import type { CareerRow, Careers } from '../src/data/careers.ts';
import { playerKey } from '../src/data/drafts.ts';
import type { History, OwnerKey } from '../src/data/history.ts';
import type { Lineups, Spot } from '../src/data/lineups.ts';
import { buildLineups } from './lineups.ts';

const round = (n: number) => Math.round(n * 100) / 100;

// The roster that won it all: the champion's last week of lineups, or, for a season the export kept
// starters only, the end-of-season roster it carries instead.
function championRoster(L: Lineups, champ: OwnerKey | undefined): Set<number> {
  const out = new Set<number>();
  if (!champ) return out;
  const spots: Spot[] = L.final?.[champ]
    ? L.final[champ]!
    : (() => {
        const weeks = Object.keys(L.weeks).map(Number).sort((a, b) => b - a);
        for (const w of weeks) { const t = L.weeks[String(w)]?.[champ]; if (t) return [...t.s, ...t.b]; }
        return [];
      })();
  for (const x of spots) if (x[0] >= 0) out.add(x[0]);
  return out;
}

export function buildCareers(h: History, lineups?: Lineups[]): { careers: Careers; report: string[] } {
  const L = lineups ?? buildLineups(h);
  const players: [string, string][] = [];
  const pIdx = new Map<string, number>();
  const player = (name: string, pos: string) => {
    const p = pos === 'DEF' ? 'D/ST' : pos, k = playerKey(name, p);
    let i = pIdx.get(k);
    if (i === undefined) { i = players.length; players.push([name, p]); pIdx.set(k, i); }
    return i;
  };

  const rows: CareerRow[] = [];
  const report: string[] = [];
  const full: number[] = [];
  for (const l of [...L].sort((a, b) => a.year - b.year)) {
    const season = h.seasons.find((s) => s.year === l.year);
    const champ = season?.podium[0];
    const ring = championRoster(l, champ);
    const detailed = l.detail === 'full';
    if (detailed) full.push(l.year);
    // key = player index in this file + owner; one row per player per team per season.
    const agg = new Map<string, { p: number; owner: OwnerKey; start: number; weeks: number; bench: number; rost: number; ring: boolean }>();
    const add = (i: number, owner: OwnerKey, started: boolean, pts: number | null, onRoster: boolean) => {
      if (i < 0) return;
      const [name, pos] = l.players[i]!;
      const p = player(name, pos);
      const k = `${p}|${owner}`;
      const a = agg.get(k) ?? { p, owner, start: 0, weeks: 0, bench: 0, rost: 0, ring: false };
      if (started) { a.start += pts ?? 0; a.weeks++; } else a.bench += pts ?? 0;
      if (onRoster) a.rost++;
      if (ring.has(i)) a.ring = true;
      agg.set(k, a);
    };
    for (const [, teams] of Object.entries(l.weeks))
      for (const [owner, t] of Object.entries(teams)) {
        for (const x of t.s) add(x[0], owner as OwnerKey, true, x[2], true);
        for (const x of t.b) add(x[0], owner as OwnerKey, false, x[2], x[1] !== 'IR');
      }
    // A starters-only season lists the end-of-season roster too: it is how a champion's bench shows up.
    if (!detailed && l.final)
      for (const [owner, spots] of Object.entries(l.final))
        for (const x of spots) if (x[0] >= 0 && !agg.has(`${player(l.players[x[0]]![0], l.players[x[0]]![1])}|${owner}`)) add(x[0], owner as OwnerKey, false, null, false);

    for (const a of agg.values())
      rows.push([a.p, l.year, a.owner, round(a.start), a.weeks, detailed ? round(a.bench) : null, detailed ? a.rost : null, a.ring && a.owner === champ ? 1 : 0]);
    const rings = rows.filter((r) => r[1] === l.year && r[7] === 1).length;
    report.push(`${l.year}: ${agg.size} player-seasons, ${rings} on the champion's roster${champ ? ` (${champ})` : ' (no champion in history.json)'}${detailed ? '' : ', starters only'}`);
  }
  rows.sort((a, b) => a[1] - b[1] || a[0] - b[0] || a[2].localeCompare(b[2]));
  const through = Math.max(...L.map((l) => l.year));
  return { careers: { version: 1, through, full, players, rows }, report };
}

// One row per line keeps the file diffable.
export function formatCareers(c: Careers): string {
  return `{\n "version": 1,\n "through": ${c.through},\n "full": ${JSON.stringify(c.full)},\n "players": [\n${c.players.map((p) => `  ${JSON.stringify(p)}`).join(',\n')}\n ],\n "rows": [\n${c.rows.map((r) => `  ${JSON.stringify(r)}`).join(',\n')}\n ]\n}\n`;
}
