// Export (Nov 12, item 5): pick the data you want and get it as CSV. Every table in the app also
// exports what is on screen; this page is for whole datasets, including the history files the live
// pages never load. Nothing leaves the browser: the files are built here and handed to the browser's
// own download.
import { useMemo, useState } from 'react';
import { careersUrl, validateCareers, type Careers } from '../data/careers.ts';
import { draftsUrl, validateDrafts, type Drafts } from '../data/drafts.ts';
import { validateHistory, type History as HistoryFile } from '../data/history.ts';
import { tradesUrl, validateTrades, type Trades } from '../data/trades.ts';
import { useLeague } from '../data/store.tsx';
import { buildCareerBook, ringRosters } from '../engine/careers.ts';
import { buildDraftBook, posRank } from '../engine/drafts.ts';
import { buildHist, careers as ownerCareers, ownerName } from '../engine/history.ts';
import { keeperBets, keeperCareers } from '../engine/keeperSkill.ts';
import { keeperCalls } from '../engine/keepers.ts';
import { standings, teamName } from '../engine/league.ts';
import { lineup } from '../engine/model.ts';
import { historyLines, liveLines, traderCareers } from '../engine/traders.ts';
import { download } from '../ui/table.tsx';
import { Section } from '../ui/components.tsx';

type Cell = string | number | null | undefined;
const esc = (v: Cell) => { const s = v == null ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const csv = (head: string[], rows: Cell[][]) => [head.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');

interface Set_ { id: string; label: string; note: string; group: string; build: () => Promise<{ head: string[]; rows: Cell[][] }> }

const grab = async <T,>(url: string, check: (raw: unknown) => { ok: true; value: T } | { ok: false; errors: string[] }, what: string): Promise<T> => {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`could not load the ${what} (status ${r.status})`);
  const v = check(await r.json());
  if (!v.ok) throw new Error(`the ${what} file is invalid: ${v.errors[0]}`);
  return v.value;
};

export default function ExportData() {
  const { idx, values: V, base, sim, exportBackup } = useLeague();
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const year = idx.ds.meta.season;
  const stamp = `wk${idx.scoresThrough}`;

  const sets = useMemo<Set_[]>(() => {
    const now = 'This season';
    const past = 'League history';
    const hist = () => grab<HistoryFile>(`${import.meta.env.BASE_URL}seed/history.json`, validateHistory, 'league history');
    const ownerOf = async () => {
      const h = await hist();
      const byTeam = new Map(h.owners.filter((o) => o.teamId !== null && !o.filler).map((o) => [o.teamId!, o.key]));
      return { h, H: buildHist(h, idx), owner: (t: number) => byTeam.get(t) };
    };
    return [
      {
        id: 'players', label: 'Players', note: `Every valued player this season with points, projections, values and keeper cost`, group: now,
        build: async () => ({
          head: ['Player', 'Pos', 'NFL', 'Owner', 'Total pts', 'Avg', 'Pts/wk', 'ROS proj', 'Value', 'Market', 'Model', 'Peaked', 'Menton', 'Above repl.', 'Keeper cost', 'Bye', 'ESPN rank'],
          rows: [...idx.players.values()].map((p) => {
            const s = idx.stats.get(p.id), b = V.blend(p.id), k = idx.keeper.get(p.id);
            return [p.name, p.pos, p.nflTeam, idx.owner.has(p.id) ? teamName(idx, idx.owner.get(p.id)) : 'FA', s?.seasonPoints, s?.seasonAvg, base.proj.get(p.id), s?.projRestOfSeason, b.v, b.market, b.model, V.chart(p.id, 'peaked'), V.chart(p.id, 'menton'), V.aboveReplacement(p.id), k ? k.cost ?? 'cannot keep' : null, p.bye, s?.posRank];
          }),
        }),
      },
      {
        id: 'rosters', label: 'Rosters', note: 'Every team\'s roster with role, points per week and value', group: now,
        build: async () => {
          const rows: Cell[][] = [];
          for (const t of idx.ds.teams) {
            const roster = idx.roster.get(t.id) ?? [];
            const starters = new Set(lineup(base, roster.filter((p) => !base.isOut(p)), () => 1).slots.map((x) => x.pid));
            for (const p of roster) {
              const pl = idx.players.get(p);
              rows.push([t.name, pl?.name, pl?.pos, idx.irSlot.has(p) ? 'IR slot' : starters.has(p) ? 'Starter' : 'Bench', base.proj.get(p), idx.stats.get(p)?.seasonPoints, V.bv(p)]);
            }
          }
          return { head: ['Team', 'Player', 'Pos', 'Role', 'Pts/wk', 'Total pts', 'Value'], rows };
        },
      },
      {
        id: 'standings', label: 'Standings', note: 'Records, points for and against, efficiency and playoff odds', group: now,
        build: async () => ({
          head: ['Seed', 'Team', 'W', 'L', 'T', 'PF', 'PA', 'Max PF', 'Efficiency', 'Playoff odds'],
          rows: standings(idx).map((r) => [r.seed, teamName(idx, r.teamId), r.w, r.l, r.t, r.pf, r.pa, r.maxPf, r.efficiency, sim?.odds[r.teamId] ?? null]),
        }),
      },
      {
        id: 'games', label: 'Schedule and results', note: 'Every game this season, played or not', group: now,
        build: async () => ({ head: ['Week', 'Home', 'Away', 'Home pts', 'Away pts', 'Status'], rows: idx.ds.games.map((g) => [g.week, teamName(idx, g.homeId), teamName(idx, g.awayId), g.homePts, g.awayPts, g.status]) }),
      },
      {
        id: 'weeks', label: 'Weekly player lines', note: 'Every player, every week: slot, points, projection and opponent', group: now,
        build: async () => ({
          head: ['Week', 'Player', 'Pos', 'Team', 'Slot', 'Points', 'Projection', 'Opponent', 'Rostered %', 'Started %'],
          rows: idx.ds.playerWeeks.map((w) => { const p = idx.players.get(w.playerId); return [w.week, p?.name, p?.pos, w.teamId === null ? 'FA' : teamName(idx, w.teamId), w.slot, w.points, w.projection, w.opponent, w.rosteredPct, w.startedPct]; }),
        }),
      },
      {
        id: 'keepers', label: 'Keeper calls', note: `${year + 1} keeper costs against what the rank has gone for at auction`, group: now,
        build: async () => {
          const calls = keeperCalls(base);
          return {
            head: ['Player', 'Pos', 'Owner', 'Keeper cost', 'Worth', 'Surplus', 'Pts/wk', 'Pos rank', 'Above repl.', 'Call', 'Contract note'],
            rows: [...calls.values()].map((c) => { const p = idx.players.get(c.pid); return [p?.name, p?.pos, teamName(idx, idx.owner.get(c.pid)), c.cost, c.worth, c.surplus, c.ppw, c.rank, c.par, c.label, c.note]; }),
          };
        },
      },
      {
        id: 'tx', label: 'Trades this season', note: 'Every leg of every trade and veto', group: now,
        build: async () => ({
          head: ['Trade', 'Type', 'Date', 'Week', 'Effective week', 'Player', 'Pos', 'From', 'To', 'Value at trade', 'ROS at trade'],
          rows: idx.ds.transactions.flatMap((t) => t.legs.map((l) => { const p = idx.players.get(l.playerId); return [t.id, t.type, t.date, t.week, t.effectiveWeek, p?.name, p?.pos, teamName(idx, l.fromTeamId), teamName(idx, l.toTeamId), l.valueAtTrade ?? null, l.rosAtTrade ?? null]; })),
        }),
      },
      {
        id: 'seasons', label: 'Seasons and final standings', note: 'Every team of every season since 2010', group: past,
        build: async () => {
          const { H } = await ownerOf();
          return {
            head: ['Season', 'Platform', 'Finish', 'Manager', 'Team', 'W', 'L', 'T', 'PF', 'PA', 'xW', 'Luck', 'Points index'],
            rows: H.seasons.flatMap((s) => s.rows.map((r) => [s.year, s.platform, r.finish, ownerName(H, r.owner), r.team, r.w, r.l, r.t, r.pf, r.pa, r.xw, r.luck, r.index])),
          };
        },
      },
      {
        id: 'owners', label: 'Manager careers', note: 'Every manager\'s all-time record, titles and luck', group: past,
        build: async () => {
          const { H } = await ownerOf();
          return {
            head: ['Manager', 'Seasons', 'W', 'L', 'T', 'PF', 'PA', 'Titles', 'Title seasons', 'Runner-ups', 'Thirds', 'Playoffs', 'Completed', 'Luck', 'Points index', 'Lifer', 'Active'],
            rows: ownerCareers(H).map((c) => {
              const pf = c.seasons.reduce((a, s) => a + s.pf, 0), pa = c.seasons.reduce((a, s) => a + s.pa, 0);
              return [c.name, c.seasons.length, c.w, c.l, c.t, pf, pa, c.titles.length, c.titles.join(' '), c.runnerUps.length, c.thirds.length, c.playoffs, c.completed, c.luck, c.index, c.lifer ? 'yes' : 'no', c.active ? 'yes' : 'no'];
            }),
          };
        },
      },
      {
        id: 'matchups', label: 'Every matchup', note: 'Every game played in the league since 2010', group: past,
        build: async () => {
          const { H } = await ownerOf();
          return {
            head: ['Season', 'Week', 'Kind', 'Home', 'Home pts', 'Away', 'Away pts', 'Winner'],
            rows: H.seasons.flatMap((s) => s.games.map((g) => [s.year, g.week, g.kind, ownerName(H, g.home), g.hs, ownerName(H, g.away), g.as, g.winner ? ownerName(H, g.winner) : 'tie'])),
          };
        },
      },
      {
        id: 'alltime', label: 'All-time players', note: 'Every career since 2010: starter points, starts and titles', group: past,
        build: async () => {
          const [c, { H, owner }] = await Promise.all([grab<Careers>(careersUrl(import.meta.env.BASE_URL), validateCareers, 'all-time players'), ownerOf()]);
          const book = buildCareerBook(c, H.seasons.some((s) => s.live) ? { idx, owner } : undefined);
          return {
            head: ['Player', 'Pos', 'Starter pts', 'Starts', 'Pts/start', 'Seasons', 'First', 'Last', 'Titles', 'Title seasons', 'Best season pts', 'Best season', 'Bench pts (2018 on)', 'Weeks rostered (2018 on)', 'Managers'],
            rows: book.players.map((p) => [p.name, p.pos, p.startPts, p.weeks, p.ppw, p.years.length, p.first, p.last, p.rings, p.ringYears.join(' '), p.best?.pts, p.best?.year, p.benchPts, p.rosterWeeks, p.owners.map((o) => ownerName(H, o)).join(', ')]),
          };
        },
      },
      {
        id: 'rings', label: 'Championship rosters', note: 'Who was on each title-winning roster', group: past,
        build: async () => {
          const [c, { H, owner }] = await Promise.all([grab<Careers>(careersUrl(import.meta.env.BASE_URL), validateCareers, 'all-time players'), ownerOf()]);
          const book = buildCareerBook(c, H.seasons.some((s) => s.live) ? { idx, owner } : undefined);
          return {
            head: ['Season', 'Champion', 'Player', 'Pos', 'Starter pts that season', 'Starts that season'],
            rows: ringRosters(book).flatMap((r) => r.players.map((p) => { const s = p.seasons.find((x) => x.year === r.year && x.ring); return [r.year, ownerName(H, r.owner), p.name, p.pos, s?.startPts, s?.weeks]; })),
          };
        },
      },
      {
        id: 'picks', label: 'Draft picks', note: 'Every auction pick since 2010 with hindsight worth and value', group: past,
        build: async () => {
          const [d, { H, owner }] = await Promise.all([grab<Drafts>(draftsUrl(import.meta.env.BASE_URL), validateDrafts, 'draft history'), ownerOf()]);
          const live = H.seasons.find((s) => s.live)?.year;
          const book = buildDraftBook(d, live ? { year: live, idx, teamOwner: owner } : undefined);
          return {
            head: ['Season', 'Manager', 'Player', 'Pos', 'Price', 'Keeper', 'Round', 'Overall', 'Projected pts', 'Season pts', 'Pos rank', 'Worth', 'Value'],
            rows: book.picks.map((p) => [p.year, ownerName(H, p.owner), p.name, p.pos, p.price, p.keeper ? 'yes' : 'no', p.round, p.overall, p.proj, p.pts, posRank(book, p), p.worth, p.value]),
          };
        },
      },
      {
        id: 'tradesides', label: 'Trade sides', note: 'Both sides of every trade since 2018, graded', group: past,
        build: async () => {
          const [T, { H, owner }] = await Promise.all([grab<Trades>(tradesUrl(import.meta.env.BASE_URL), validateTrades, 'trade history'), ownerOf()]);
          const lines = [...historyLines(T), ...(H.seasons.some((s) => s.live) ? liveLines(V, owner) : [])];
          return {
            head: ['Season', 'Week', 'Manager', 'Partner', 'Grade', 'Score', 'Got', 'Gave', 'Points got', 'Points gave', 'Points gained', 'Above repl./wk', 'Weeks', 'Chart value', 'Keeper value'],
            rows: lines.map((l) => [l.year, l.week, ownerName(H, l.owner), ownerName(H, l.partner), l.grade, l.score, l.got.join(', '), l.gave.join(', '), l.rawGot, l.rawGave, l.rawGot === null || l.rawGave === null ? null : l.rawGot - l.rawGave, l.parWk, l.weeks, l.value, l.keep]),
          };
        },
      },
      {
        id: 'traders', label: 'Trading careers', note: 'Each manager\'s trades: grade, value and points gained', group: past,
        build: async () => {
          const [T, { H, owner }] = await Promise.all([grab<Trades>(tradesUrl(import.meta.env.BASE_URL), validateTrades, 'trade history'), ownerOf()]);
          const cs = traderCareers([...historyLines(T), ...(H.seasons.some((s) => s.live) ? liveLines(V, owner) : [])]);
          return {
            head: ['Manager', 'Trades', 'Graded', 'Average grade', 'Average score', 'Won', 'Lost', 'Points gained', 'Above repl. gained', 'Above repl./wk', 'Chart value', 'Keeper value', 'Seasons'],
            rows: cs.map((c) => [ownerName(H, c.owner), c.trades, c.graded, c.grade, c.score, c.wins, c.losses, c.rawGain, c.parGain, c.parWk, c.value, c.keep, c.years.join(' ')]),
          };
        },
      },
      {
        id: 'keepercareers', label: 'Keeper careers', note: 'Who picks the right keepers: points and value gained', group: past,
        build: async () => {
          const [d, { H, owner }] = await Promise.all([grab<Drafts>(draftsUrl(import.meta.env.BASE_URL), validateDrafts, 'draft history'), ownerOf()]);
          const live = H.seasons.find((s) => s.live)?.year;
          const book = buildDraftBook(d, live ? { year: live, idx, teamOwner: owner } : undefined);
          const cs = keeperCareers(keeperBets(book));
          return {
            head: ['Manager', 'Keepers', 'Judged', 'Spent', 'Points gained', 'Points/keeper', 'Value gained', 'Value/keeper', 'Hits', 'Misses', 'Hit rate', 'Seasons'],
            rows: cs.map((c) => [ownerName(H, c.owner), c.keepers, c.scored, c.spend, c.par, c.parPer, c.value, c.valuePer, c.hits, c.misses, c.hitRate, c.years.join(' ')]),
          };
        },
      },
      {
        id: 'keptplayers', label: 'Every keeper kept', note: 'Each kept player since 2011 against what he turned out to be worth', group: past,
        build: async () => {
          const [d, { H, owner }] = await Promise.all([grab<Drafts>(draftsUrl(import.meta.env.BASE_URL), validateDrafts, 'draft history'), ownerOf()]);
          const live = H.seasons.find((s) => s.live)?.year;
          const book = buildDraftBook(d, live ? { year: live, idx, teamOwner: owner } : undefined);
          return {
            head: ['Season', 'Manager', 'Player', 'Pos', 'Price', 'Worth', 'Value', 'Points over repl.', 'Season pts', 'Worth the price'],
            rows: keeperBets(book).map((b) => [b.year, ownerName(H, b.owner), b.name, b.pos, b.price, b.worth, b.value, b.par, b.pick.pts, b.hit ? 'yes' : 'no']),
          };
        },
      },
    ];
  }, [idx, V, base, sim, year]);

  const groups = [...new Set(sets.map((s) => s.group))];
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const run = async () => {
    setBusy(true); setError(null); setDone(null);
    const written: string[] = [];
    try {
      for (const s of sets.filter((x) => picked.includes(x.id))) {
        const { head, rows } = await s.build();
        const name = `fwhl-${s.id}-${s.group === 'This season' ? `${year}-${stamp}` : 'history'}.csv`;
        download(name, csv(head, rows));
        written.push(`${name} (${rows.length.toLocaleString()} rows)`);
        await new Promise((r) => setTimeout(r, 250)); // one download at a time, so the browser keeps them all
      }
      setDone(written);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      if (written.length) setDone(written);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-8">
      <Section title="Export data" aside={`${picked.length} of ${sets.length} chosen`}>
        <p className="max-w-[75ch] text-sm text-ink-2">
          Tick what you want and download it as CSV, one file each. This season's numbers are as of Week {idx.scoresThrough};
          the history files cover 2010 to last season, with this season added where it belongs. Every table in the app also has its own
          Export CSV button, which gives you exactly the rows and columns you are looking at.
        </p>
        {groups.map((g) => (
          <fieldset key={g} className="grid gap-1 border-t border-ink pt-2">
            <legend className="sr-only">{g}</legend>
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="text-base font-semibold">{g}</h3>
              <button type="button" className="link text-sm" onClick={() => { const ids = sets.filter((s) => s.group === g).map((s) => s.id); setPicked((p) => (ids.every((i) => p.includes(i)) ? p.filter((i) => !ids.includes(i)) : [...new Set([...p, ...ids])])); }}>
                {sets.filter((s) => s.group === g).every((s) => picked.includes(s.id)) ? 'None' : 'All'}
              </button>
            </div>
            <ul className="grid gap-0.5">
              {sets.filter((s) => s.group === g).map((s) => (
                <li key={s.id}>
                  <label className="flex min-h-11 cursor-pointer items-baseline gap-3 border-b border-rule py-1.5 hover:bg-sunk">
                    <input type="checkbox" className="mt-1.5" checked={picked.includes(s.id)} onChange={() => toggle(s.id)} />
                    <span className="grid gap-0.5">
                      <span className="font-medium">{s.label}</span>
                      <span className="text-sm text-ink-3">{s.note}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" disabled={!picked.length || busy} onClick={run}>{busy ? 'Building…' : `Download ${picked.length || ''} CSV${picked.length === 1 ? '' : 's'}`}</button>
          {picked.length > 0 && <button type="button" className="btn btn-quiet" onClick={() => setPicked([])}>Clear</button>}
        </div>
        {error && <p role="alert" className="border border-loss bg-loss-soft p-3 text-sm">{error}</p>}
        {done && done.length > 0 && (
          <div role="status" className="grid gap-1 border border-rule-strong bg-surface p-3 text-sm">
            <p className="font-medium">Downloaded</p>
            <ul className="grid gap-0.5 text-ink-2">{done.map((d) => <li key={d} className="num text-xs">{d}</li>)}</ul>
            <p className="text-xs text-ink-3">If only the first file arrived, your browser asked about multiple downloads: allow them and run it again.</p>
          </div>
        )}
      </Section>
      <Section title="Everything, as one file">
        <p className="max-w-[75ch] text-sm text-ink-2">The full backup is JSON, not CSV: the whole league dataset plus your settings and saved trades, the file Data &amp; settings imports.</p>
        <div><button type="button" className="btn" onClick={() => download(`fwhl-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(exportBackup(), null, 1), 'application/json')}>Download backup JSON</button></div>
      </Section>
    </div>
  );
}
