// Builds public/seed/history.json from the CSV exports in data/history/ (see docs/data-updates.md,
// "League history"). Throws with every problem found, so nothing is written from bad input.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { History, HistGame, HistOwner, HistSeason, HistTeam, OwnerKey } from '../src/data/history.ts';
import { parseCsv } from './updates.ts';

const SLEEPER_YEARS = [2024, 2025];

export const ownerKey = (name: string): OwnerKey => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

function table(dir: string, file: string): Record<string, string>[] {
  const [head, ...rows] = parseCsv(readFileSync(join(dir, file), 'utf8'));
  if (!head) throw new Error(`${file} is empty`);
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

export function buildHistory(dir = 'data/history'): History {
  const errors: string[] = [];
  const settings = table(dir, 'settings.csv');
  const standings = table(dir, 'standings.csv');
  const matchups = table(dir, 'matchups.csv');
  const champs = table(dir, 'championships.csv');
  const ownerRows = table(dir, 'owners.csv');
  const corrections = table(dir, 'corrections.csv');
  // aliases.csv: seasons where an export name belongs to someone else (from/to inclusive, to blank = on).
  const aliases = table(dir, 'aliases.csv');
  const who = (name: string, year: number): string => {
    const a = aliases.find((r) => r.owner === name && year >= Number(r.from) && (!r.to || year <= Number(r.to)));
    return a ? a.becomes! : name;
  };
  const yearOf = (r: Record<string, string>) => Number(r['Season Year']);
  for (const r of standings) r['Owner Name'] = who(r['Owner Name']!, yearOf(r));
  for (const r of matchups) { r['Home Owner'] = who(r['Home Owner']!, yearOf(r)); r['Away Owner'] = who(r['Away Owner']!, yearOf(r)); }
  for (const r of champs) for (const p of ['1st', '2nd', '3rd']) if (r[`${p} Place Owner`]) r[`${p} Place Owner`] = who(r[`${p} Place Owner`]!, yearOf(r));
  for (const r of corrections) { r.winner = who(r.winner!, Number(r.season)); r.loser = who(r.loser!, Number(r.season)); }

  const owners = new Map<OwnerKey, HistOwner>();
  const extra = new Map(ownerRows.map((r) => [r.owner!, r]));
  for (const r of standings) {
    const name = r['Owner Name']!;
    const key = ownerKey(name);
    if (owners.has(key)) continue;
    const o = extra.get(name);
    owners.set(key, {
      key,
      name: o?.display || name,
      teamId: o?.team2026 ? Number(o.team2026) : null,
      ...(o?.filler === 'yes' ? { filler: true as const } : {}),
      ...(o?.note ? { note: o.note } : {}),
    });
  }
  for (const name of extra.keys()) if (!owners.has(ownerKey(name))) errors.push(`owners.csv: ${name} is in no season`);

  const currentYear = Math.max(...settings.map((s) => Number(s['Season Year'])));
  const seasons: HistSeason[] = [];
  for (const s of settings) {
    const year = Number(s['Season Year']);
    if (year === currentYear) continue; // the live season comes from the league seed
    const regularWeeks = Number(s['Regular Season Weeks']);
    const rows = standings.filter((r) => Number(r['Season Year']) === year);
    const teams: HistTeam[] = rows.map((r) => ({
      owner: ownerKey(r['Owner Name']!),
      name: clean(r['Team Name']!),
      finish: r.Rank ? Number(r.Rank) : null,
      w: Number(r.Wins), l: Number(r.Losses), t: 0,
      pf: Number(r['Points For']), pa: Number(r['Points Against']),
    }));
    if (teams.length !== Number(s['Team Count'])) errors.push(`${year}: ${teams.length} teams in standings, settings say ${s['Team Count']}`);
    const fixes = corrections.filter((c) => Number(c.season) === year);
    const games: HistGame[] = [];
    for (const m of matchups.filter((r) => Number(r['Season Year']) === year)) {
      const [h, a] = [ownerKey(m['Home Owner']!), ownerKey(m['Away Owner']!)];
      const [hs, as] = [Number(m['Home Score']), Number(m['Away Score'])];
      if (h === a || (hs === 0 && as === 0)) continue; // bye or unplayed
      const week = Number(m['Week Number']);
      const fix = fixes.find((c) => Number(c.week) === week && [h, a].includes(ownerKey(c.winner!)) && [h, a].includes(ownerKey(c.loser!)));
      games.push(fix ? [week, h, a, hs, as, ownerKey(fix.winner!)] : [week, h, a, hs, as]);
    }
    // The regular season must reproduce the official records.
    for (const t of teams) {
      let w = 0, l = 0, tie = 0;
      for (const g of games) {
        if (g[0] > regularWeeks || (g[1] !== t.owner && g[2] !== t.owner)) continue;
        const mine = g[1] === t.owner ? g[3] : g[4], theirs = g[1] === t.owner ? g[4] : g[3];
        const won = g[5] ? g[5] === t.owner : mine > theirs;
        const lost = g[5] ? g[5] !== t.owner : mine < theirs;
        if (won) w++; else if (lost) l++; else tie++;
      }
      t.t = tie;
      if (w !== t.w || l !== t.l) errors.push(`${year} ${t.owner}: games give ${w}-${l}, standings say ${t.w}-${t.l} (add a row to corrections.csv if the official record is right)`);
    }
    const c = champs.find((r) => Number(r['Season Year']) === year);
    const podium = c ? ['1st', '2nd', '3rd'].map((p) => c[`${p} Place Owner`]).filter(Boolean).map((n) => ownerKey(n!)) : [];
    podium.forEach((o, i) => { if (teams.find((t) => t.owner === o)?.finish !== i + 1) errors.push(`${year}: podium place ${i + 1} (${o}) does not match the standings rank`); });
    seasons.push({
      year,
      platform: SLEEPER_YEARS.includes(year) ? 'Sleeper' : 'ESPN',
      regularWeeks,
      playoffTeams: Number(s['Playoff Team Count']),
      roster: s['Roster Positions']!,
      podium,
      teams,
      games,
      notes: fixes.map((f) => `Week ${f.week}: ${f.note}`),
    });
  }
  if (errors.length) throw new Error(`history inputs do not add up:\n- ${errors.join('\n- ')}`);
  const teamNames = Object.fromEntries(standings.filter((r) => Number(r['Season Year']) === currentYear).map((r) => [ownerKey(r['Owner Name']!), clean(r['Team Name']!)]));
  return { version: 1, owners: [...owners.values()], seasons, current: { year: currentYear, teamNames } };
}

// One game per line keeps the file diffable without being huge.
export function formatHistory(h: History): string {
  const { seasons, ...top } = h;
  const body = seasons.map((s) => {
    const { games, teams, ...meta } = s;
    const head = JSON.stringify(meta).slice(0, -1);
    return `  ${head},\n   "teams": [\n    ${teams.map((t) => JSON.stringify(t)).join(',\n    ')}\n   ],\n   "games": [\n    ${games.map((g) => JSON.stringify(g)).join(',\n    ')}\n   ]}`;
  });
  const owners = top.owners.map((o) => `  ${JSON.stringify(o)}`).join(',\n');
  return `{\n "version": ${top.version},\n "current": ${JSON.stringify(top.current)},\n "owners": [\n${owners}\n ],\n "seasons": [\n${body.join(',\n')}\n ]\n}\n`;
}
