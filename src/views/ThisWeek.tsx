import type { PlayerId, TeamId } from '../data/schema.ts';
import { useLeague } from '../data/store.tsx';
import { teamName } from '../engine/league.ts';
import { lineup } from '../engine/model.ts';
import { fmt, Mono, pct, Section } from '../ui/components.tsx';
import { usePlayerSheet } from './PlayerSheet.tsx';

// "This week" for my team (audit FEAT-15): matchup, ESPN-projected best lineups, who's out or on bye.
// Shared with Home: this week's matchup for my team on ESPN's projections.
export function useThisWeek() {
  const { idx, base, settings } = useLeague();
  const me = settings.myTeamId;
  const w = idx.currentWeek;
  if (me === null || w > idx.ds.season.regularSeasonWeeks) return null;
  const wk = idx.weeks.get(w);
  const proj = (p: PlayerId) => wk?.get(p)?.projection ?? null;
  const bye = (p: PlayerId) => wk?.get(p)?.opponent === 'BYE' || idx.players.get(p)?.bye === w;
  // Best lineup on ESPN's projection for this week (falls back to the season rate when ESPN has none).
  const best = (t: TeamId) => {
    const keys = (idx.roster.get(t) ?? []).filter((p) => !base.isOut(p) && !bye(p));
    return lineup(base, keys, (p) => { const x = proj(p), b = base.proj.get(p) ?? 0; return x === null ? 1 : b > 0 ? x / b : 0; });
  };
  const top6 = idx.ds.season.top6Weeks.includes(w);
  const game = idx.ds.games.find((g) => g.week === w && (g.homeId === me || g.awayId === me));
  const opp = game ? (game.homeId === me ? game.awayId : game.homeId) : null;
  const mine = best(me);
  const all = top6 ? idx.teamIds.map((t) => [t, best(t).start] as const).sort((a, b) => b[1] - a[1]) : [];
  const myRank = all.findIndex(([t]) => t === me) + 1;
  const roster = idx.roster.get(me) ?? [];
  const out = roster.filter((p) => base.isOut(p));
  const byes = roster.filter((p) => !base.isOut(p) && bye(p));
  return { me, w, top6, opp, mine, oppPts: opp !== null ? best(opp).start : null, all, myRank, out, byes };
}

export function ThisWeek() {
  const { idx, sim } = useLeague();
  const open = usePlayerSheet();
  const t = useThisWeek();
  if (!t) return null;
  const { me, w, top6, opp, mine, oppPts, all, myRank, out, byes } = t;
  const names = (ps: PlayerId[]) => ps.map((p, i) => <span key={p}>{i ? ', ' : ''}<button type="button" className="link" onClick={() => open(p)}>{idx.players.get(p)?.name}</button></span>);
  return (
    <Section title={`This week · Week ${w}`} aside={sim ? `Your playoff odds ${pct(sim.odds[me])}` : undefined}>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="grid content-start gap-1">
          {top6 ? (
            <p>Top-6 week. Your best lineup projects <b className="num">{fmt(mine.start)}</b>, <b>{ordinal(myRank)}</b> of 12 on ESPN's projections{myRank <= 6 ? '.' : `; 6th is ${fmt(all[5]?.[1])}.`}</p>
          ) : opp !== null ? (
            <>
              <p className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><Mono team={me} size="sm" />{teamName(idx, me)}</span><b className="num">{fmt(mine.start)}</b></p>
              <p className="flex items-center justify-between gap-3"><span className="flex items-center gap-2"><Mono team={opp} size="sm" />{teamName(idx, opp)}</span><b className="num">{fmt(oppPts)}</b></p>
              <p className="text-xs text-ink-3">Best possible lineups on ESPN's Week {w} projections, without out and bye players.</p>
            </>
          ) : <p>No game this week.</p>}
        </div>
        <div className="grid content-start gap-1 text-sm">
          <p><b className="font-medium">Out:</b> {out.length ? names(out) : 'nobody'}</p>
          <p><b className="font-medium">On bye:</b> {byes.length ? names(byes) : 'nobody'}</p>
          <p className="text-ink-2"><b className="font-medium text-ink">Best lineup:</b> {mine.slots.filter((x) => x.pid).map((x) => idx.players.get(x.pid!)?.name.split(' ').slice(-1)[0]).join(', ')}</p>
        </div>
      </div>
    </Section>
  );
}

const ordinal = (n: number) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
