// Builds public/seed/trades.json from the trade exports in data/history/trades/ (see
// docs/data-updates.md, "Trade history"). Grades every past-season trade with
// src/engine/tradeHistory.ts. The live season's trades stay on the Tracker page.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { History, OwnerKey } from '../src/data/history.ts';
import { playerKey } from '../src/data/drafts.ts';
import type { Lineups } from '../src/data/lineups.ts';
import type { HistTrade, Trades } from '../src/data/trades.ts';
import { buildDraftBook } from '../src/engine/drafts.ts';
import { gradeTrade, indexSeason, parseSlots, type SeasonInput } from '../src/engine/tradeHistory.ts';
import { buildDrafts } from './drafts.ts';
import { ownerKey } from './history.ts';
import { buildLineups } from './lineups.ts';
import { parseCsv } from './updates.ts';

interface EspnItem { player: string; position: string; from: { ownerName: string } | null; to: { ownerName: string } | null; dropped?: boolean }
interface EspnTrade { season: number; week: number; confidence: 'confirmed' | 'likely'; teams: { ownerName: string }[]; items: EspnItem[]; acceptedDate: string | null; processedDate: string | null }
interface SleeperPlayer { name: string; position: string }
interface SleeperTrade { week: number; status_updated: string; sides: { team: { display_name: string }; received: SleeperPlayer[]; faab_received: number; faab_sent: number }[] }

const table = (dir: string, file: string): Record<string, string>[] => {
  const [head, ...rows] = parseCsv(readFileSync(join(dir, file), 'utf8'));
  return rows.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
};

export interface TradesReport { seasons: string[]; unseen: string[] }

export function buildTrades(h: History, dir = 'data/history', lineups?: Lineups[]): { trades: Trades; report: TradesReport } {
  const errors: string[] = [];
  const espn = JSON.parse(readFileSync(join(dir, 'trades/espn-2018-2026.json'), 'utf8')) as { seasons: { season: number; trades: EspnTrade[] }[] };
  const sleeper = JSON.parse(readFileSync(join(dir, 'trades/sleeper-2024-2025.json'), 'utf8')) as { seasons: { season: string; trades: SleeperTrade[] }[] };
  const accounts = table(dir, 'accounts.csv');
  const L = lineups ?? buildLineups(h, join(dir, 'rosters'));
  const book = buildDraftBook(buildDrafts(h, dir, L).drafts);
  const account = (platform: string, y: number, name: string): OwnerKey => {
    const a = accounts.find((r) => r.platform === platform && r.account === name && (!r.season || Number(r.season) === y));
    return ownerKey(a ? a.owner! : name);
  };

  const players: [string, string][] = [];
  const pIdx = new Map<string, number>();
  const player = (name: string, pos: string) => { const p = pos === 'DEF' ? 'D/ST' : pos, k = playerKey(name, p); let i = pIdx.get(k); if (i === undefined) { i = players.length; players.push([name, p]); pIdx.set(k, i); } return k; };

  // One season's inputs for the grader, built once.
  const seasons = new Map<number, { S: SeasonInput; W: ReturnType<typeof indexSeason> }>();
  const season = (y: number) => {
    if (seasons.has(y)) return seasons.get(y)!;
    const s = h.seasons.find((x) => x.year === y)!, l = L.find((x) => x.year === y)!;
    const S: SeasonInput = {
      year: y, L: l, key: playerKey, slots: parseSlots(s.roster), playoffTeams: s.playoffTeams,
      games: s.games.filter((g) => g[0] <= s.regularWeeks).map(([week, home, away, hs, as]) => ({ week, home, away, hs, as })),
      lastWeek: Math.max(...s.games.map((g) => g[0])),
      finish: new Map(s.teams.map((t) => [t.owner, t.finish])),
    };
    const v = { S, W: indexSeason(S) };
    seasons.set(y, v);
    return v;
  };
  const nextKeepers = (y: number) => {
    const ps = book.byYear.get(y + 1);
    if (!ps) return null;
    return { final: y + 1 < h.current.year, kept: (o: OwnerKey, k: string) => { const x = ps.find((q) => q.keeper && q.owner === o && playerKey(q.name, q.pos) === k); return x ? { price: x.price, value: x.value } : null; } };
  };

  type Raw = { year: number; week: number; source: HistTrade['source']; confidence: HistTrade['confidence']; date: string | null; sides: [{ owner: OwnerKey; gets: string[]; faab: number }, { owner: OwnerKey; gets: string[]; faab: number }]; dropped: [OwnerKey, string][] };
  const raw: Raw[] = [];
  const inSeason = (y: number) => new Set(h.seasons.find((s) => s.year === y)?.teams.map((t) => t.owner) ?? []);
  for (const s of espn.seasons) {
    if (s.season >= h.current.year) continue; // the live season is on the Tracker page
    const ok = inSeason(s.season);
    for (const t of s.trades) {
      const owners = t.teams.map((x) => account('espn', s.season, x.ownerName));
      if (owners.length !== 2) { errors.push(`${s.season} Week ${t.week}: a trade between ${owners.length} teams`); continue; }
      for (const [i, o] of owners.entries()) if (!ok.has(o)) errors.push(`${s.season} ESPN owner "${t.teams[i]!.ownerName}" is not in the season (add it to accounts.csv)`);
      const gets = (o: OwnerKey) => t.items.filter((x) => !x.dropped && x.to && account('espn', s.season, x.to.ownerName) === o).map((x) => player(x.player, x.position));
      raw.push({ year: s.season, week: t.week, source: 'ESPN', confidence: t.confidence, date: t.processedDate ?? t.acceptedDate, sides: [{ owner: owners[0]!, gets: gets(owners[0]!), faab: 0 }, { owner: owners[1]!, gets: gets(owners[1]!), faab: 0 }],
        dropped: t.items.filter((x) => x.dropped && x.from).map((x) => [account('espn', s.season, x.from!.ownerName), player(x.player, x.position)]) });
    }
  }
  for (const s of sleeper.seasons) {
    const y = Number(s.season), ok = inSeason(y);
    for (const t of s.trades) {
      const sides = t.sides.map((x) => ({ owner: account('sleeper', y, x.team.display_name), gets: x.received.map((p) => player(p.name, p.position)), faab: x.faab_received - x.faab_sent }));
      for (const [i, x] of sides.entries()) if (!ok.has(x.owner)) errors.push(`${y} Sleeper account "${t.sides[i]!.team.display_name}" is not in the season (add it to accounts.csv)`);
      if (sides.length !== 2) { errors.push(`${y} Week ${t.week}: a trade between ${sides.length} teams`); continue; }
      raw.push({ year: y, week: t.week, source: 'Sleeper', confidence: 'confirmed', date: t.status_updated, sides: [sides[0]!, sides[1]!], dropped: [] });
    }
  }
  if (errors.length) throw new Error(`trade inputs do not add up:\n- ${errors.join('\n- ')}`);

  raw.sort((a, b) => a.year - b.year || a.week - b.week);
  const unseen: string[] = [];
  const trades: HistTrade[] = raw.map((r, i) => {
    const { S, W } = season(r.year);
    const g = gradeTrade(S, W, { week: r.week, sides: [{ owner: r.sides[0].owner, gets: r.sides[0].gets }, { owner: r.sides[1].owner, gets: r.sides[1].gets }] }, nextKeepers(r.year), (k) => pIdx.get(k)!);
    for (const sd of r.sides) for (const k of sd.gets) if (![...W.values()].some((wk) => wk.at.get(k)?.owner === sd.owner)) unseen.push(`${r.year} Week ${r.week}: ${players[pIdx.get(k)!]![0]} never shows on ${sd.owner}'s roster`);
    return {
      id: `${r.year}-${String(r.week).padStart(2, '0')}-${i}`, year: r.year, week: r.week, eff: g.eff, source: r.source, confidence: r.confidence, date: r.date,
      sides: [{ ...g.sides[0]!, faab: r.sides[0].faab }, { ...g.sides[1]!, faab: r.sides[1].faab }],
      dropped: r.dropped.map(([o, k]) => [o, pIdx.get(k)!] as [OwnerKey, number]),
    };
  });
  const years = [...new Set(trades.map((t) => t.year))];
  const report = years.map((y) => { const ts = trades.filter((t) => t.year === y); return `${y}: ${ts.length} trades (${ts.filter((t) => t.confidence === 'likely').length} likely), ${ts.filter((t) => t.sides[0].grade === null).length} not graded`; });
  return { trades: { version: 1, players, trades }, report: { seasons: report, unseen } };
}

// One trade per line keeps the file diffable.
export function formatTrades(t: Trades): string {
  return `{\n "version": 1,\n "players": [\n${t.players.map((p) => `  ${JSON.stringify(p)}`).join(',\n')}\n ],\n "trades": [\n${t.trades.map((x) => `  ${JSON.stringify(x)}`).join(',\n')}\n ]\n}\n`;
}
