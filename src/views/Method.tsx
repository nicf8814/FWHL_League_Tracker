import { useLeague } from '../data/store.tsx';
import { href } from '../app/router.ts';
import { Section } from '../ui/components.tsx';

// How the numbers are made (audit UI-11). Plain words; the live settings and season rules are read
// from the data so the page can't drift from the engine.
export default function Method() {
  const { idx, settings: s, values: V } = useLeague();
  const S = idx.ds.season;
  const cw = s.chartWeights;
  const repl = Object.entries(S.replacementRank).map(([p, n]) => `${p}${n}`).join(', ');
  return (
    <article className="grid max-w-[70ch] gap-10 text-ink-2 [&_b]:text-ink [&_h2]:text-ink">
      <Section title="Player value">
        <p>Every player gets one number on a 0 to 100+ scale. It blends two views: what league mates will accept (the market) and what actually scores in this league (the model). Right now it's {s.marketShare}% market and {100 - s.marketShare}% model; change it in <a className="link" href={href('data')}>Data & settings</a>.</p>
        <p><b>Market.</b> The Peaked in High Skool and Kyle Menton trade charts, weighted {cw.peaked} / {cw.menton}. Each chart's position rank is read off one shared curve per position, so a WR5 is worth the same whichever chart calls him that.</p>
        <p><b>Model.</b> ESPN projections in this league's scoring, blended with what each player has actually scored as games pile up (none at 0 games, half by 7, 70% by 12){s.productionRamp ? '' : ' (the blend is off right now)'}. Value is points per week above a replacement starter ({repl}), over the weeks left, with the stretch weeks {S.top6Weeks.join(', ')} counting 1.25× and the playoffs 1.5× times the team's playoff odds.</p>
        <p><b>Injuries.</b> Out and IR players lose the weeks they'll miss; IR is at least 4 weeks from when it started. A player who scores 0 with no projection in back-to-back games is treated as out until he plays. Injury discounts run at {Math.round(s.injuryStrength * 100)}% strength.</p>
        <p><b>Keepers.</b> A player's 2027 keeper surplus (projected auction price minus keeper cost) is added to his value for his owner, weighted by how much that owner should care about next year: 12% for a lock to make the playoffs, up to 60% for a team out of it.</p>
      </Section>

      <Section title="Trade verdicts">
        <p>The analyzer adds up what each side sends by its own team's values. When one side sends more players, its extra, lowest players only count for what they're worth above the best healthy free agent at their position, because a roster spot isn't free.</p>
        <p><b>Fair</b> is within 6% either way; <b>slight</b> is 6 to 18%; <b>clear</b> is more. <b>Fair for both</b> means the partner sees it as even by his own values (within ±{V.FAIR_RANGE}) and your lineup loses no more than {V.WEEKLY_LOSS_OK} point a week.</p>
        <p><b>Lineup impact</b> rebuilds both teams' best lineup every remaining week with and without the trade. Rosters stay the same size: a team taking more players than it sends cuts its lowest-valued players, and a team left short fills in from the best free agents.</p>
      </Section>

      <Section title="Playoff odds">
        <p>{S.sim.runs.toLocaleString()} simulated seasons from the real results so far. Each team's weekly mean is half its projected lineup and half its actual points per game, pulled {Math.round((1 - S.sim.shrink) * 100)}% toward the league average, with a season-long team swing and week-to-week noise. Seeds 1 to {S.seedsByRecord} go by record (head to head, then points for, break ties in wins); seed {S.seedsByRecord + 1} is the most points for among everyone else. Weeks {S.top6Weeks.join(', ')} give a win to the top 6 scores. An exact tie is a tie, half a win each.</p>
      </Section>

      <Section title="Trade grades">
        <p>Each team in a trade gets a letter grade. It starts from the trade itself (value received and projected points per week above replacement) and moves toward real production as weeks are played: after n weeks, n ÷ (n + 4) of the grade is production. Production is each player's points above a replacement starter at his position that week; out weeks count 0. Keeper value for 2027 is added on top, weighted like player keeper value. C is even; A+ and F are the far ends.</p>
        <p><b>Record without it</b> replays every week since the trade: the team's real score plus the difference between its best possible lineup without the trade and its best possible lineup as it really was, so real start/sit choices still count. Later trades that moved the same players are undone too. A changed score can flip the opponent's result, or, in top-6 weeks, move another team across the line.</p>
        <p><b>Vetoed trades</b> run the same way in the other direction: as if they went through, valued at today's numbers.</p>
      </Section>

      <Section title="Data">
        <p>No live connections. The app reads one league file that the weekly tasks refresh from ESPN, the trade charts and FantasyPros usage stats, and the site redeploys when it changes. What you import or change stays in this browser; export a backup to keep it. Every source's date is in <a className="link" href={href('data')}>Data & settings</a>.</p>
      </Section>
    </article>
  );
}
