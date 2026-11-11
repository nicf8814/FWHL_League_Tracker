import { POSITIONS, type Dataset, type Injury, type Player, type PlayerId, type Pos, type Source, type TeamId, type Transaction } from '../src/data/schema.ts';
import { buildIndex } from '../src/engine/league.ts';

// Pure updates applied to the league dataset by the weekly tasks (see docs/data-updates.md).
// Each takes the dataset and an input object, changes the dataset in place and returns a report.
// They throw (and the CLI writes nothing) when a sanity check fails.

export interface PlayerRef {
  espnId?: number | null;
  name: string;
  pos: Pos;
  nflTeam?: string | null;
}

export interface Report {
  changes: string[];
  created: string[]; // players added to the dataset
  espnIdsAdded: number; // existing players that got their ESPN id this run
  unmatched: string[]; // names that matched no player and were skipped
  warnings: string[];
}

export const newReport = (): Report => ({ changes: [], created: [], espnIdsAdded: 0, unmatched: [], warnings: [] });

// Same key the old analyzer used, kept so chart and FantasyPros names keep matching.
export const slug = (name: string) => name.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/[^a-z]/g, '');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const arizonaToday = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Phoenix' }).format(d);
const shortDate = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${Number(iso.slice(8, 10))}`;
const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const isPos = (x: unknown): x is Pos => (POSITIONS as readonly unknown[]).includes(x);

export function setSource(ds: Dataset, id: string, patch: Omit<Partial<Source>, 'id'>, label: string) {
  const s = ds.meta.sources.find((x) => x.id === id);
  if (s) Object.assign(s, patch);
  else ds.meta.sources.push({ id, label, asOf: '', ...patch });
}

// Finds a player by ESPN id, then by name (and position). Fills in a missing ESPN id when it can,
// and never fails when there is none: a ref without espnId just matches by name as before.
export class Players {
  private byEspn = new Map<number, Player>();
  private bySlug = new Map<string, Player[]>();
  private next: number;
  private ds: Dataset;
  private report: Report;
  constructor(ds: Dataset, report: Report) {
    this.ds = ds;
    this.report = report;
    for (const p of ds.players) this.index(p);
    this.next = Math.max(0, ...ds.players.map((p) => Number(p.id.slice(3)) || 0)) + 1;
  }
  private index(p: Player) {
    if (p.espnId != null) this.byEspn.set(p.espnId, p);
    for (const a of new Set([...p.aliases, slug(p.name)])) this.bySlug.set(a, [...(this.bySlug.get(a) ?? []).filter((x) => x !== p), p]);
  }
  resolve(ref: PlayerRef, create: boolean): PlayerId | null {
    if (!ref || typeof ref.name !== 'string' || !ref.name.trim()) { this.report.warnings.push(`Skipped a player with no name: ${JSON.stringify(ref)}`); return null; }
    const espnId = Number.isInteger(ref.espnId) ? (ref.espnId as number) : null;
    if (espnId !== null) {
      const hit = this.byEspn.get(espnId);
      if (hit) { this.touch(hit, ref); return hit.id; }
    }
    const s = slug(ref.name);
    let cands = (this.bySlug.get(s) ?? []).filter((p) => !isPos(ref.pos) || p.pos === ref.pos);
    // A player who already has a different ESPN id is someone else with the same name.
    if (espnId !== null) cands = cands.filter((p) => p.espnId == null || p.espnId === espnId);
    if (cands.length > 1 && ref.nflTeam) cands = cands.filter((p) => p.nflTeam === ref.nflTeam).concat(cands.filter((p) => p.nflTeam !== ref.nflTeam));
    if (cands.length > 1) this.report.warnings.push(`"${ref.name}" matches ${cands.length} players; used ${cands[0]!.id}.`);
    const hit = cands[0];
    if (hit) {
      if (espnId !== null && hit.espnId == null) { hit.espnId = espnId; this.byEspn.set(espnId, hit); this.report.espnIdsAdded++; }
      this.touch(hit, ref);
      return hit.id;
    }
    if (!create || !isPos(ref.pos)) { this.report.unmatched.push(`${ref.name}${ref.pos ? ` (${ref.pos})` : ''}`); return null; }
    const p: Player = { id: `pl-${String(this.next++).padStart(4, '0')}`, name: ref.name.trim(), pos: ref.pos, nflTeam: ref.nflTeam ?? null, bye: null, espnId, aliases: [s] };
    this.ds.players.push(p);
    this.index(p);
    this.report.created.push(`${p.name} (${p.pos}, ${p.id})`);
    return p.id;
  }
  private touch(p: Player, ref: PlayerRef) {
    if (ref.nflTeam && ref.nflTeam !== p.nflTeam) p.nflTeam = ref.nflTeam;
    const s = slug(ref.name);
    if (!p.aliases.includes(s)) { p.aliases.push(s); this.index(p); }
  }
}

const teamIds = (ds: Dataset) => new Set(ds.teams.map((t) => t.id));
const ownerMap = (ds: Dataset) => new Map(ds.rosters.map((r) => [r.playerId, r]));

export interface TxIn {
  id: string;
  type: 'trade' | 'veto';
  date: string;
  week: number;
  effectiveWeek: number;
  legs: { player: PlayerRef; from: TeamId; to: TeamId }[];
}

// Chart value when the trade is logged: Peaked and Menton averaged at the latest chart week on or before it.
function chartValueNow(ds: Dataset, id: PlayerId, week: number): number | null {
  const weeks = [...new Set(ds.valuations.map((v) => v.week))].filter((w) => w <= week);
  if (!weeks.length) return null;
  const wk = Math.max(...weeks);
  const vals = ds.valuations.filter((v) => v.playerId === id && v.week === wk && (v.source === 'peaked' || v.source === 'menton')).map((v) => v.value);
  return vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10 : null;
}

function addTransactions(ds: Dataset, list: TxIn[] | undefined, P: Players, rep: Report) {
  if (!list) return;
  const have = new Set(ds.transactions.map((t) => t.id));
  const teams = teamIds(ds);
  for (const t of list) {
    if (!t?.id || have.has(t.id)) continue; // never edit an existing transaction
    if (t.type !== 'trade' && t.type !== 'veto') { rep.warnings.push(`Transaction ${t.id}: unknown type ${String(t.type)}, skipped.`); continue; }
    const ros = (id: PlayerId | null) => (t.type === 'trade' && id ? ds.playerStats.find((s) => s.playerId === id)?.projRestOfSeason ?? null : null);
    const legs = (t.legs ?? []).map((l) => { const id = P.resolve(l.player, true); return { playerId: id, fromTeamId: l.from, toTeamId: l.to, rosAtTrade: ros(id), valueAtTrade: t.type === 'trade' && id ? chartValueNow(ds, id, t.week) : null }; });
    const sides = new Set(legs.map((l) => l.fromTeamId));
    if (legs.some((l) => !l.playerId || !teams.has(l.fromTeamId) || !teams.has(l.toTeamId)) || sides.size !== 2) {
      rep.warnings.push(`Transaction ${t.id}: needs two known teams each sending a known player; skipped.`);
      continue;
    }
    const tx: Transaction = { id: t.id, type: t.type, date: t.date, week: t.week, effectiveWeek: t.effectiveWeek, legs: legs as Transaction['legs'] };
    ds.transactions.push(tx);
    have.add(t.id);
    rep.changes.push(`New ${t.type}: ${tx.id} (Week ${t.week})`);
  }
}

// ---------- Task 1: weekly results ----------
export interface ResultsIn {
  week: number;
  games: [number, TeamId, TeamId, number | null, number | null, 'final' | 'scheduled'][];
  rows: { player: PlayerRef; teamId: TeamId | null; slot: 'start' | 'bench' | 'ir' | 'fa'; points: number | null; projection: number | null; opponent: string | null }[];
  season: { player: PlayerRef; seasonPoints: number | null; seasonAvg: number | null; posRank: string | null }[];
  transactions?: TxIn[];
}

export function applyResults(ds: Dataset, inp: ResultsIn, today: string): Report {
  const rep = newReport();
  const L = inp.week;
  if (!Number.isInteger(L) || L < 1) throw new Error('results: "week" must be the last completed week.');
  const teams = teamIds(ds);
  if (!Array.isArray(inp.games) || inp.games.length < ds.games.length) throw new Error(`results: expected the full schedule (${ds.games.length} games), got ${inp.games?.length ?? 0}.`);
  const games = inp.games.map(([week, homeId, awayId, homePts, awayPts, status]) => {
    if (!teams.has(homeId) || !teams.has(awayId)) throw new Error(`results: unknown team in Week ${week} game ${homeId}-${awayId}.`);
    const final = status === 'final';
    return { week, homeId, awayId, homePts: final ? homePts : null, awayPts: final ? awayPts : null, status: final ? ('final' as const) : ('scheduled' as const) };
  });
  const weekL = games.filter((g) => g.week === L);
  if (!weekL.length || weekL.some((g) => g.status !== 'final')) throw new Error(`results: Week ${L} is not final in the schedule.`);
  // Sanity: each team's started players add up to its score.
  for (const g of weekL)
    for (const [team, score] of [[g.homeId, g.homePts], [g.awayId, g.awayPts]] as const) {
      const sum = inp.rows.filter((r) => r.teamId === team && r.slot === 'start').reduce((s, r) => s + (r.points ?? 0), 0);
      if (Math.abs(sum - (score ?? 0)) > 0.1) throw new Error(`results: team ${team} starters add to ${r2(sum)} but scored ${score} in Week ${L}.`);
    }
  ds.games = games;
  const P = new Players(ds, rep);
  const old = new Map(ds.playerWeeks.filter((w) => w.week === L).map((w) => [w.playerId, w]));
  const rows = inp.rows.flatMap((r) => {
    const id = P.resolve(r.player, true);
    if (!id) return [];
    const o = old.get(id);
    return [{ playerId: id, week: L, teamId: r.teamId, slot: r.slot, points: r.points, projection: r.projection ?? o?.projection ?? null, opponent: r.opponent ?? o?.opponent ?? null, opponentRank: o?.opponentRank ?? null, rosteredPct: o?.rosteredPct ?? null, startedPct: o?.startedPct ?? null }];
  });
  ds.playerWeeks = ds.playerWeeks.filter((w) => w.week !== L).concat(rows);
  rep.changes.push(`Week ${L}: ${rows.length} player rows, ${weekL.length} final games`);
  let n = 0;
  for (const s of inp.season ?? []) {
    const id = P.resolve(s.player, true);
    if (!id) continue;
    let st = ds.playerStats.find((x) => x.playerId === id);
    if (!st) { st = { playerId: id, projPerWeek: null, projRestOfSeason: null, projRegularRest: null, seasonPoints: null, seasonAvg: null, posRank: null, availability: 'rostered' }; ds.playerStats.push(st); }
    st.seasonPoints = s.seasonPoints; st.seasonAvg = s.seasonAvg; st.posRank = s.posRank; n++;
  }
  rep.changes.push(`Season stats for ${n} players`);
  addTransactions(ds, inp.transactions, P, rep);
  // A backfill of an earlier week (DATA-10) must not move "scores through" backwards.
  const through = ds.meta.sources.find((x) => x.id === 'scores')?.throughWeek ?? 0;
  if (L >= through) setSource(ds, 'scores', { asOf: today, throughWeek: L }, 'ESPN weekly scores');
  else rep.changes.push(`Backfill: Week ${L} is before the latest (Week ${through}); scores-through left at Week ${through}`);
  return rep;
}

// ---------- Task 2: projections ----------
export interface ProjectionsIn {
  week: number; // current week C
  started: boolean; // has any Week C game kicked off?
  players: { player: PlayerRef; bye?: number | null; ros: number | null; weekly?: Record<string, number>; opponents?: Record<string, string>; oprk?: number | null; rosteredPct?: number | null; startedPct?: number | null; availability?: 'rostered' | 'waivers' | 'free_agent' }[];
}

export function applyProjections(ds: Dataset, inp: ProjectionsIn, today: string, force = false): Report {
  const rep = newReport();
  const C = inp.week;
  if (!Number.isInteger(C) || C < 1 || C > 18) throw new Error('projections: "week" must be the current week.');
  const first = inp.started ? C + 1 : C;
  const regEnd = ds.season.regularSeasonWeeks;
  const final = buildIndex(ds).scoresThrough;
  const own = ownerMap(ds);
  const P = new Players(ds, rep);
  const rostered = new Set(ds.rosters.map((r) => r.playerId));
  let missing = 0, swung = 0, compared = 0, n = 0;
  const seen = new Set<PlayerId>();
  for (const e of inp.players ?? []) {
    const id = P.resolve(e.player, true);
    if (!id) continue;
    seen.add(id);
    const pl = ds.players.find((p) => p.id === id)!;
    if (Number.isInteger(e.bye)) pl.bye = e.bye as number;
    if (e.ros == null) { if (rostered.has(id)) missing++; continue; }
    const bye = pl.bye;
    const games = (to: number) => { let k = 0; for (let w = first; w <= to; w++) if (w !== bye) k++; return k; };
    const left = games(18), regLeft = games(regEnd);
    const wk = e.ros > 0 && left > 0 ? r2(e.ros / left) : 0;
    let st = ds.playerStats.find((x) => x.playerId === id);
    if (!st) { st = { playerId: id, projPerWeek: null, projRestOfSeason: null, projRegularRest: null, seasonPoints: null, seasonAvg: null, posRank: null, availability: 'rostered' }; ds.playerStats.push(st); }
    if (rostered.has(id) && st.projPerWeek && st.projPerWeek > 0) { compared++; if (Math.abs(wk - st.projPerWeek) / st.projPerWeek > 0.5) swung++; }
    st.projRestOfSeason = r1(e.ros); st.projPerWeek = wk; st.projRegularRest = r1(wk * regLeft);
    st.availability = e.availability ?? (rostered.has(id) ? 'rostered' : st.availability === 'rostered' ? 'waivers' : st.availability);
    n++;
    // Weekly projections for weeks not played yet, kept as player-week rows with no points.
    for (const [wk2, proj] of Object.entries(e.weekly ?? {})) {
      const w = Number(wk2);
      if (!Number.isInteger(w) || w < first || w <= final || w > 18 || typeof proj !== 'number') continue;
      let row = ds.playerWeeks.find((x) => x.playerId === id && x.week === w);
      if (!row) {
        const r = own.get(id);
        row = { playerId: id, week: w, teamId: r?.teamId ?? null, slot: r ? (r.slot === 'ir' ? 'ir' : 'bench') : 'fa', points: null, projection: null, opponent: null, opponentRank: null, rosteredPct: null, startedPct: null };
        ds.playerWeeks.push(row);
      }
      row.projection = r1(proj);
      row.opponent = e.opponents?.[wk2] ?? row.opponent;
      if (w === C) {
        row.opponentRank = e.oprk ?? row.opponentRank;
        row.rosteredPct = e.rosteredPct ?? row.rosteredPct;
        row.startedPct = e.startedPct ?? row.startedPct;
      }
    }
  }
  const nRost = rostered.size;
  const notSeen = [...rostered].filter((p) => !seen.has(p)).length;
  if (!force && (missing + notSeen) / nRost > 0.1) throw new Error(`projections: ${missing + notSeen} of ${nRost} rostered players have no projection (over 10%).`);
  if (!force && compared && swung / compared > 0.15) throw new Error(`projections: ${swung} of ${compared} rostered players moved over 50% (over 15%). Rerun with --force if that is real.`);
  rep.changes.push(`Projections for ${n} players from Week ${first}; ${missing + notSeen} rostered without one; ${swung} big movers`);
  setSource(ds, 'espn', { asOf: today }, 'ESPN rosters, injuries and projections');
  return rep;
}

// ---------- Task 3: rosters, injuries, transactions ----------
export interface RostersIn {
  teams: { teamId: TeamId; players: { player: PlayerRef; slot: 'active' | 'ir'; injury: 'Q' | 'OUT' | 'IR' | null; note?: string }[] }[];
  transactions?: TxIn[];
}

export function applyRosters(ds: Dataset, inp: RostersIn, today: string, force = false): Report {
  const rep = newReport();
  const teams = teamIds(ds);
  if (!Array.isArray(inp.teams) || inp.teams.length !== teams.size) throw new Error(`rosters: expected ${teams.size} teams, got ${inp.teams?.length ?? 0}.`);
  for (const t of inp.teams) {
    if (!teams.has(t.teamId)) throw new Error(`rosters: unknown team ${t.teamId}.`);
    if (!t.players?.length) throw new Error(`rosters: team ${t.teamId} has an empty roster.`);
  }
  const P = new Players(ds, rep);
  const before = ownerMap(ds);
  const next = inp.teams.flatMap((t) => t.players.flatMap((p) => { const id = P.resolve(p.player, true); return id ? [{ teamId: t.teamId, playerId: id, slot: p.slot === 'ir' ? ('ir' as const) : ('active' as const), inj: p }] : []; }));
  const dupes = next.filter((r, i) => next.findIndex((x) => x.playerId === r.playerId) !== i);
  if (dupes.length) throw new Error(`rosters: ${dupes.length} players appear on two rosters.`);
  const moved = next.filter((r) => before.get(r.playerId)?.teamId !== r.teamId).length;
  if (!force && moved / next.length > 0.25) throw new Error(`rosters: ${moved} of ${next.length} players changed teams (over 25%).`);
  const after = new Set(next.map((r) => r.playerId));
  for (const r of next) if (!before.has(r.playerId)) rep.changes.push(`Added: ${ds.players.find((p) => p.id === r.playerId)!.name} to team ${r.teamId}`);
  for (const [pid, r] of before) if (!after.has(pid)) rep.changes.push(`Dropped: ${ds.players.find((p) => p.id === pid)?.name} from team ${r.teamId}`);
  for (const r of next) { const b = before.get(r.playerId); if (b && b.teamId !== r.teamId) rep.changes.push(`Moved: ${ds.players.find((p) => p.id === r.playerId)!.name} ${b.teamId} -> ${r.teamId}`); }
  ds.rosters = next.map(({ teamId, playerId, slot }) => ({ teamId, playerId, slot }));
  // Availability follows the roster.
  for (const st of ds.playerStats) {
    if (after.has(st.playerId)) st.availability = 'rostered';
    else if (before.has(st.playerId)) st.availability = 'waivers';
  }
  // Injuries for rostered players: keep the start date while the status holds, note what changed.
  const inj = new Map(ds.injuries.map((i) => [i.playerId, i]));
  const label = { Q: 'Questionable', OUT: 'OUT', IR: 'IR' } as const;
  for (const r of next) {
    const old = inj.get(r.playerId), s = r.inj.injury;
    const name = ds.players.find((p) => p.id === r.playerId)!.name;
    if (!s) { if (old) { inj.delete(r.playerId); rep.changes.push(`${name}: no longer ${old.status}`); } continue; }
    if (!['Q', 'OUT', 'IR'].includes(s)) { rep.warnings.push(`${name}: unknown injury status ${s}, left as is.`); continue; }
    if (old && old.status === s) { if (r.inj.note) old.note = r.inj.note; continue; }
    const entry: Injury = {
      playerId: r.playerId, status: s,
      note: r.inj.note ?? `${label[s]}, ESPN ${shortDate(today)}${old ? ` (was ${label[old.status]})` : ''}`,
      since: s === 'IR' ? today : s === 'OUT' && old?.status === 'IR' ? old.since : null,
      returnWeek: old?.returnWeek ?? null,
    };
    inj.set(r.playerId, entry);
    rep.changes.push(`${name}: ${old ? label[old.status] : 'healthy'} -> ${label[s]}`);
  }
  ds.injuries = [...inj.values()];
  addTransactions(ds, inp.transactions, P, rep);
  setSource(ds, 'espn', { asOf: today }, 'ESPN rosters, injuries and projections');
  return rep;
}

// ---------- Task 4: FantasyPros usage ----------
export interface UsageIn {
  asOf: string; // "Week 9"
  players: ({ player: PlayerRef } & Omit<NonNullable<Dataset['usage']>[number], 'playerId' | 'pos'>)[];
}

export function applyUsage(ds: Dataset, inp: UsageIn): Report {
  const rep = newReport();
  if (!Array.isArray(inp.players) || inp.players.length < 100) throw new Error(`usage: expected 100+ players, got ${inp.players?.length ?? 0}.`);
  const P = new Players(ds, rep);
  const out: NonNullable<Dataset['usage']> = [];
  for (const { player, ...u } of inp.players) {
    const id = P.resolve(player, false);
    if (!id) continue;
    out.push({ playerId: id, pos: ds.players.find((p) => p.id === id)!.pos, ...u });
  }
  ds.usage = out;
  rep.changes.push(`Usage for ${out.length} players`);
  setSource(ds, 'fpstats', { asOf: inp.asOf }, 'FantasyPros stats (volume vs production)');
  return rep;
}

// ---------- Weekly charts (from Nic's chart images) ----------
export interface ChartRow { name: string; value: number; pos?: Pos }

export function applyChart(ds: Dataset, source: 'peaked' | 'menton', week: number, rows: ChartRow[]): Report {
  const rep = newReport();
  if (source !== 'peaked' && source !== 'menton') throw new Error('chart: source must be peaked or menton.');
  if (!Number.isInteger(week) || week < 1 || week > 18) throw new Error('chart: week must be 1-18.');
  const good = rows.filter((r) => r.name && Number.isFinite(r.value) && r.value >= 0);
  if (good.length < 50) throw new Error(`chart: only ${good.length} readable rows (need 50+). Check the extraction.`);
  const max = Math.max(...good.map((r) => r.value));
  if (!(max > 0)) throw new Error('chart: every value is 0.');
  const P = new Players(ds, rep);
  const vals = new Map<PlayerId, number>();
  for (const r of good) {
    const id = P.resolve({ name: r.name, pos: r.pos as Pos }, !!r.pos);
    if (id) vals.set(id, Math.max(vals.get(id) ?? 0, r2((r.value / max) * 100)));
  }
  if (vals.size < 50) throw new Error(`chart: only ${vals.size} names matched players (need 50+). Unmatched: ${rep.unmatched.slice(0, 15).join(', ')}`);
  ds.valuations = ds.valuations.filter((v) => !(v.source === source && v.week === week)).concat([...vals].map(([playerId, value]) => ({ source, week, playerId, value })));
  const cur = ds.meta.sources.find((s) => s.id === source)?.week ?? 0;
  if (week >= cur) setSource(ds, source, { asOf: `Week ${week}`, week }, source === 'peaked' ? 'Peaked in High Skool trade chart' : 'Kyle Menton trade chart');
  rep.changes.push(`${source} Week ${week}: ${vals.size} players (top value ${max} = 100)`);
  return rep;
}

// CSV with columns name,value,pos (header optional), in the chart's order.
export function chartRowsFromCsv(text: string): ChartRow[] {
  const rows = parseCsv(text);
  const body = rows[0] && !Number.isFinite(Number(rows[0][1])) ? rows.slice(1) : rows;
  return body.map(([name = '', value = '', pos]) => ({ name: name.trim(), value: Number(value), ...(pos?.trim() ? { pos: pos.trim().toUpperCase() as Pos } : {}) }));
}

// ---------- FantasyPros rest-of-season ranks ----------
export interface RankRow { name: string; pos: Pos; rank: number }

export function applyRanks(ds: Dataset, rows: RankRow[], asOf: string): Report {
  const rep = newReport();
  const good = rows.filter((r) => r.name && isPos(r.pos) && Number.isInteger(r.rank) && r.rank > 0);
  if (good.length < 100) throw new Error(`ranks: only ${good.length} readable rows (need 100+).`);
  const P = new Players(ds, rep);
  const out = new Map<PlayerId, number>();
  for (const r of good) { const id = P.resolve(r, false); if (id && !out.has(id)) out.set(id, r.rank); }
  ds.rankings = ds.rankings.filter((r) => r.source !== 'fantasypros').concat([...out].map(([playerId, rank]) => ({ source: 'fantasypros', playerId, rank })));
  setSource(ds, 'fantasypros', { asOf }, 'FantasyPros rest-of-season ranks (half PPR)');
  rep.changes.push(`FantasyPros ranks for ${out.size} players`);
  return rep;
}

// CSV with columns name,pos,rank (header optional).
export function rankRowsFromCsv(text: string): RankRow[] {
  const rows = parseCsv(text);
  const body = rows[0] && !Number.isFinite(Number(rows[0][2])) ? rows.slice(1) : rows;
  return body.map(([name = '', pos = '', rank = '']) => ({ name: name.trim(), pos: pos.trim().toUpperCase() as Pos, rank: Number(rank) }));
}

// ---------- file format ----------
// One record per line so a refresh shows up in git as a readable diff.
const ORDER = ['schemaVersion', 'meta', 'season', 'teams', 'players', 'rosters', 'games', 'playerWeeks', 'playerStats', 'valuations', 'rankings', 'injuries', 'news', 'keepers', 'transactions', 'usage'] as const;
export function formatDataset(ds: Dataset): string {
  const parts = ORDER.filter((k) => ds[k] !== undefined).map((k) => {
    const v = ds[k];
    const body = Array.isArray(v) ? (v.length ? `[\n${v.map((x) => JSON.stringify(x)).join(',\n')}\n]` : '[]') : JSON.stringify(v);
    return `${JSON.stringify(k)}: ${body}`;
  });
  return `{\n${parts.join(',\n')}\n}\n`;
}

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { cells.push(cur.trim()); cur = ''; }
      else cur += c;
    }
    cells.push(cur.trim());
    out.push(cells);
  }
  return out;
}
