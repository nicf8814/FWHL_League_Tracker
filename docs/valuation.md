# Player value (Nov 22, 2026)

Trade value used to be the Peaked in High Skool and Kyle Menton trade charts blended with a scoring model that borrowed the charts' scale. It is now our own price in **auction dollars**, with the charts blended in at 50% until they stop adding anything (see the backtest below). Code: `src/engine/war.ts`, `buildValues` in `src/engine/model.ts`.

## How a player is priced

1. **Projection**: ESPN's rest-of-season points per week in our scoring, blended with his season average as games pile up (production ramp: 0 at 0 games, 50% at 7, 70% by 12).
2. **PAR**: projection minus a replacement starter at his position (`season.replacementRank`: QB12, RB31, WR34, TE7).
3. **WAR** (matchup wins above replacement, after Arrow Analytics): put him into each team's best projected lineup in place of the weakest starter he could legally replace, and add up the change in each team's chance of beating each of the other 11 (normal, weekly sd `season.sim.weeklySd`). Averaged over all 132 team-vs-team games. Season WAR does the same with actual starters and scores, counting wins outright.
4. **Score** = 0.6 z(PAR) + 0.4 z(WAR), z-scores across every position.
5. **Dollars**: the league's auction re-run today. The top 12 x 13 = 156 players by score share 12 x $200 = $2,400: each gets $1 plus A x (score above the 157th)^k. k (1 to 3) is fitted each build so the sorted prices track what this league really pays by overall rank (`season.keeper.priceByRank`); A makes the pool spend exactly $2,400. On the Nov 19 data k is about 2: Gibbs $115, JSN $102, Walker $93.
6. Then, as before: injury discount (weeks he'll miss), news, keeper premium for his owner, and the chart blend (`marketShare`, default 50).

Saved settings from before this change (version 1) start at the new default once.

## Backtest: can the charts go?

`npm run backtest` rebuilds every predictor as it stood before Week W's games, for every week with both charts, and rank-correlates it with what happened next: points above replacement from Week W+1 to the last final week, missed weeks counting 0. Players both charts rate (106 to 125 a week). Averages weighted by weeks ahead, Weeks 2 to 9, scores through Week 10:

| Predictor | All positions | Played Week W | Within position | Within position, played W |
|---|---|---|---|---|
| Peaked | 0.54 | 0.55 | 0.52 | 0.51 |
| Menton | 0.53 | 0.53 | 0.51 | 0.49 |
| Charts (average) | **0.54** | 0.55 | **0.52** | **0.50** |
| ESPN Week W projection | 0.46 | **0.56** | 0.40 | 0.45 |
| Season average so far | 0.42 | 0.44 | 0.32 | 0.32 |
| Ours | 0.45 | 0.54 | 0.38 | 0.43 |
| Ours on a rest-of-season stand-in | 0.52 | 0.54 | 0.42 | 0.43 |
| Preseason projection per game | 0.50 | 0.51 | 0.44 | 0.44 |
| ESPN season-long rate (injured 0s → season avg) | 0.51 | 0.54 | 0.45 | 0.45 |
| **Ours on the preseason projection** | **0.54** | 0.55 | 0.47 | 0.47 |
| Ours on the ESPN season-long rate | 0.52 | 0.55 | 0.43 | 0.43 |
| Ours + charts (ranks 50/50) | 0.53 | **0.56** | 0.49 | 0.49 |

What it says:

- **The charts are still the best single predictor**, by about 0.02 overall and 0.07 to 0.10 within a position. They lead in 7 of 8 weeks within position, most in Weeks 2 to 3, when they know roles that projections and season averages don't yet.
- **Injuries explain most of the overall gap.** Among players who played Week W, ESPN, ours and the charts tie (0.54 to 0.56). The charts price a player's return; the stored single-week projection reads an injured player as 0. The live app uses ESPN's rest-of-season rate plus return weeks, which the "rest-of-season stand-in" row approximates (0.52).
- **Within a position the charts know something ESPN doesn't**, even for healthy players (0.50 vs 0.45). That is the real reason not to drop them yet.
- **WAR adds nothing to the ranking** (ours tracks ESPN closely): it is a function of the same projection. Its value is the scale (dollars that reflect real lineups), not prediction.
- **The production ramp slightly hurts**: with it off, ours goes 0.38 → 0.40 within position and 0.43 → 0.45 within position for players who played. Small, inside the noise, but it never helps. Worth revisiting.
- **Adding the charts to ours** reaches the charts' level overall and is the best on healthy players (0.56), so a 50/50 blend loses little against either.
- **Season-long projections (Nic, Nov 22) close most of the gap.** Built on the preseason projection (`data/draft-prep/2026/board.csv`, per game) and ramped toward the season average, ours ties the charts overall (0.54) and trails within position by 0.03 to 0.05 instead of 0.10 (charts ahead in 8 of 8 weeks, but inside the noise each week). Here the ramp helps: without it 0.50, at full strength 0.54, stronger adds nothing. ESPN's weekly projections averaged over the season, with injured 0s filled by the season average, do less well (0.52, 0.43 within position), and mixing them into the preseason rate makes it worse. A projection made once, before the season, then corrected by what players actually score, beats chasing ESPN's week-to-week numbers.

Limits: one season, 8 overlapping windows, 1 to 8 weeks ahead; with ~125 players a correlation has a standard error near 0.07, so week-to-week differences are noise and only the consistent pattern counts. ESPN's stored projection is the single-week number, not the rest-of-season rate the app uses; two rest-of-season snapshots exist (Week 10 and 11 projection commits), too few to test.

An earlier quick check (Nov 21) that had the season average beating the charts used points per game in games played as the outcome. That ignores missed games, which is most of what the charts get right; this backtest supersedes it.

**Verdict: close, not yet.** On the preseason projection plus the ramp, ours matches the charts overall and is about 0.04 behind within a position. Next: run the live value on the preseason projection (the site already ships it in `public/seed/draft-prep.json`) and retest at Week 14, alongside ESPN's rest-of-season snapshots. If ours matches the charts within position then, set `marketShare` to 0 and stop the chart task.

## What the change does to the app

Measured on the Nov 19 data, old engine (main) vs the new one at 50% and 0% charts:

- **History charts** (finishes, head to head, drafts, weeks, past trades): no effect. They read results and the history files only; past-season trade grades (`tradeHistory.ts`) use keeper prices, never trade value.
- **Trade tracker grades**: 2 of 28 final grades move at the 50% default (Nic's Week 9 trade with Travis C → C-, Nic's Week 9 trade with Heist B+ → B), 4 at 0%. Real trades are graded on `valueAtTrade`, the chart value stamped when the trade was loaded, so their at-trade value doesn't move; what moves is the keeper share taken off it and keeper edges. Vetoes are valued at today's price, so they move most (value received drops 14 to 24% on the Nov 10 test data), but no veto's final grade changes at 50%.
- **History > Managers, trader careers**: grades come from the tracker (above); the "value" column is the stamped chart value. If the charts stop, new trades get no `valueAtTrade`, the at-trade part of a grade falls back to projected points alone, and the column goes blank. Before dropping the charts, rebuild value at trade from the data (each player's value as of the trade week, from scores before it and that week's projections), which needs no new field in the data file.
- **Trade analyzer and finder**: the biggest change is shape, not level. The dollar curve is steeper than the charts: the #1 player is worth 1.9 times the #15 on the old values, 2.1 at 50% and 2.7 at 0%. So a star costs more depth in a 2-for-1, and the side getting the best player in a consolidation trade looks better; expect the finder to suggest fewer "two good for one great" offers. Verdicts are percentages, so the overall level doesn't matter; two absolute constants do and were left alone: "fair for both" (±5) and the stud premium (kicks in at a 5-point gap), which read as dollars now.
- **Tops by value** (live): old Hubbard 130, JSN 130, Gibbs 113; 50% JSN 116, Gibbs 111, Hubbard 108; 0% Gibbs 115, JSN 102, Walker 93. QBs and TEs rise at 0% (Burrow #13) because our price is worth to a lineup, not what the league pays for them at auction.
- **Buy & sell** no longer uses the charts: our price vs the same price on ESPN's projection alone (no ramp), ESPN started % moves over 2 weeks (byes and injured weeks skipped), and injury returns.
- **Players**: new "Value" column set with PAR, WAR per week and season WAR; "Model" is now "Ours $" and "Market" is "Charts".
- **Draft stand-in** still takes 30% from the charts' latest value rank (`views/draftLive.ts`); left as is while the charts stay.
