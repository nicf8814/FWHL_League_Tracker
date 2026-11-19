# Draft Prep Machine: design

Status: phase 2 built Nov 18, 2026 (cost, worth and edge for the 2026 board, Settings > Draft prep). Data: docs/data-updates.md, "Draft prep". League rules: docs/rules/league-rules.md. Nic's earlier work: docs/draft-prep/reference/ (see References).

## Goal

A prep tool for the auction. Before the draft it shows fair and expected prices for everyone left in the pool after keepers, and builds 13-man rosters for Nic to aim for. Draft-day entry and live suggestions are out of scope for now.

## Decisions so far

| Topic | Decision |
|---|---|
| Scope | Pre-draft prep only. No connection to the ESPN draft room. |
| Scoring | Half PPR, 6-pt pass TD (2026 rules). |
| Production | Points over replacement (VORP), measured by position finish so older seasons compare. |
| Tiers | Price bands and ranking tiers, crossed. |
| Projections | Nic loads projections and prices next summer. Until then, stand-in estimates. |
| Engines | Two: most starter points, and best title odds. Shown side by side. |
| Keepers | The machine guesses every team's keepers; Nic can switch any player on or off. It can also choose Nic's keepers. |
| Bench | 6 spots: 3 reach starters and 3 at $1. |
| Locks/avoids | Per plan, editable. |
| Plan output | Exact players and tier price targets. |
| Personas | One per owner from history, with sliders Nic can change. |
| Nomination | Suggest who to nominate. |
| History used | 2022–2026 for prices; all years for the backtest. |
| Age, injuries | Left out (no data). |
| Access | Simple password screen on the draft prep pages (see Access). |
| QB prices | No 6-pt TD bump (Nic, Nov 18, after the check below). Worth already uses 6-pt projections. |
| Pricing | Cost and worth shown side by side; edge is the gap. |

## Inputs

1. **Players**: name, position, NFL team.
2. **Projections** (Nic, next summer): season points and a price per player, as a CSV. Before then, stand-ins from 2026 points per game and the Peaked/Menton values, shaded down.
3. **Keepers**: the keeper list we already track (cost, contract year), plus Nic's on/off switches.
4. **History**: drafts, keepers, trades and transactions, 2022–2026 (`public/seed/drafts.json`, `data/history/`).

## 1. Market analysis (first deliverable)

The original question, answered from 2022–2026:

- **Keepers and prices**: dollars kept vs. inflation on everyone else. Example: 2026, 19 keepers took $560, leaving $1,840.
- **Tiers vs. production**: for each position, price band × ranking tier, then how often each cell finished as a starter, and its points over replacement per dollar.
- **Prices by position finish** in today's dollars. 2023–26 averages for the 1st, 5th and 12th most expensive: RB $90/$58/$24, WR $83/$46/$23, QB $41/$9/$2, TE $20/$4/$1.
- **Champions' builds**: 2023–25 champions were balanced (top player $46–48, two biggest buys about 40% of spend).

## 2. Economy

- League money = 12 × $200 − keeper dollars.
- Each year's prices are converted to today's dollars using that year's money left after keepers.
- Position-finish price curves come from 2022–2026 history, recent years weighted more. 2022 predates the 2023 roster changes, so it gets the least weight.
- QBs: prices follow 6-pt VORP; history only gives the curve's shape.

## 3. Valuation

Two numbers per player (Nic, Nov 18):

- **Cost** (what he will sell for): Nic's 2026 board method. FantasyPros consensus $ x league tier factor x keeper-aware base inflation, with a bid floor and ceiling. It predicted 2026 prices at 0.96. Tier factors refit on many seasons, not just 2025, and nudged by personas.
- **Worth** (what he is worth to us): the 2026FF_PreDraft_App pipeline's stages 1, 3, 4, 5: shrink projections toward the mean, points over replacement per game, tier breaks where the gap exceeds half the position's projection error, then $2,400 spread by VORP with a $1 floor. Every constant (replacement level, projection error, shrink, exponent) re-measured from this repo's history, scored with 6-pt pass TDs.
- **Edge** = worth minus cost. History: buying above the bid ceiling returned 1.8 VORP/$ in 2026 vs 2.6 within it; 2018-22 overpays returned 1.2-1.6 vs 2.7 for fair prices.
- **Tiers**: ranking tiers by projected points, cut where the gap exceeds half the position's projection error; price bands from history. Show tiers and $ ranges, not exact ranks (the pipeline's Monte Carlo check: adjacent ranks flip often).

## 4. Keepers

- Guess each team's keepers: keep if next year's cost is below expected price, about 1.6 keepers per team (2026: 1.58), max 2.
- Keeper cost: +$10 for a 1-year contract; +$15 then +$10 more on the 2-year contract (rules Art. XIII).
- Every player has an on/off switch; the pool and prices update when one changes.
- "Pick my keepers": compares keeping 0, 1 or 2 players, and which, by the team each choice leads to.

## 5. Owner personas

Built from 2022–2026, one per owner, each a slider:

- budget split by position
- paying above expected price, overall and at $50+
- how many keepers
- FAAB spending and trade frequency
- favorite NFL teams

Used to shift expected prices and to guess who bids on whom.

## 6. Roster builder

- **Rules**: 13 players including keepers; $200 minus keeper costs; the max-bid rule; position maximums (QB 4, RB 5, WR 8); lineup QB, 2 RB, 2 WR, WR/TE, flex.
- **Bench**: 3 reach starters plus 3 at $1.
- **Engines**:
  - Points: most projected starter VORP.
  - Title: from history, turn a weekly score into a win chance, and a season scoring average into title odds. All years, scores as a share of that season's league average. Example: 1.0× average wins 50%, 1.2× wins 75%, 1.5× wins 92%. Outcome spread per position and price band gives each plan a range, not one number.
- **Output**: 2–3 plans (stars and scrubs, balanced, RB-heavy). Each lists a target and a max bid per spot, two backups at about the same price, and the tier target ("an RB2 for $25–30").
- **Controls**: locks, avoids, budget per spot, and which engine.

## 7. Nomination

Suggest players to nominate so other teams spend money: players Nic doesn't want who are likely to be overpaid, given the personas and each team's needs.

## 8. Backtest

All years. Correlate whatever each draft had (ESPN projections, ESPN average auction values) with what players actually sold for and actually scored, by position finish. Then run the builder on past drafts with that year's keepers and compare its plans with the 12 real rosters.

What we have per season:
- ESPN projections: 2018–2022 (2019 and 2021 nearly complete), 2026.
- ESPN average auction value: 2010–2016, 2018, 2020–2025.

Data gaps:
- 2023 has ESPN preseason projections for only 19 of 156 picks.
- 2024–25 Sleeper projections were pulled after the season (they know the outcome) and points count only while on a league roster.
- ESPN average auction values for 2021–23 look off-scale (drafted players went for about 3× AAV).

## Access

A simple password screen on the draft prep pages, to keep leaguemates out while it is being built. Not real security: the repo is public and Nic accepts that.

- The page checks a SHA-256 hash of the password, so the password itself is not in the code. Hash: `55174404f557a8209cd5aacf3c54e1a4e2b7bc5b9eaa8254dd570c67d9733685`. Remembered in the browser after the first unlock.
- Nic's inputs are stored as plain files in the repo.
- Mark it in code as `// shortcut: password screen only, data is public in the repo; revisit if Nic shares the tool or wants real privacy`.
- Removing the screen later (to share with the league) is a one-line change.

## Phase 2 results (2026 board, tested on the real 2026 auction)

| Cost model | Tracks real prices | Average miss |
|---|---|---|
| This engine (tiers fit on 2025 FantasyPros board + 2025 auction, capped by slot history) | 0.97 | $3.20 |
| Nic's 2026 board | 0.96 | $3.80 |
| Raw FantasyPros consensus | 0.95 | $6.00 |
| Tiers fit on ESPN's own auction values, 2022-25 | 0.94 | $5.30 (dropped: the price source must match the board's) |

- Measured: replacement QB12, RB30, WR37, TE5 (FLEX starts 2023-25: RB 50%, WR 36%, TE 13%; WR/TE: WR 68%, TE 32%). Shrink per projected point over replacement (2018-22): QB 1.15, RB 0.74, WR 0.92, TE 0.82. Projection miss: QB 22%, RB 36%, WR 32%, TE 33%.
- Worth through Week 10 of 2026: buys more than $10 over worth gave back about $26 each (n=6); otherwise the edge barely predicted results (correlation 0.15). One season, injuries (Lamar, Daniels): recheck after the season.
- Bid window (Nic, Nov 18: nobody pays $133; the record is $100, Saquon 2018): the least and most the league paid for his slot (RB1, RB2, ...) in the last 5 drafts (Nic chose the strict 5-year cap over the all-time high or a cushion). Cost is capped at the ceiling. 2026 check: 81% of $15-40 buys and 46% of $40+ buys landed inside; the misses at the top were 2026 stars going above anything in 2021-25 (RB1 $89 vs. $82).
- Dropped: bands from the model's own price misses on 2025 alone. Too few buys, so floors ran far too low (Chase $39) and ceilings far too high (Gibbs $133).

## 2027 live stand-in (Nov 18)

Nic: "Gibbs is RB1 today, so he should be worth RB1 in 2027; if he gets hurt he drops, based on history." Until 2027 projections and prices exist:

- Today's rank by position: 70% points-per-game rank (4+ games), 30% latest Peaked/Menton value rank (Nic's weights). Under 4 games: trade value only.
- Games share = games played + healthy games left (injury return week) over 17.
- History (2019-2025 seasons, 1,243 player-seasons): how far players moved from their season rank to next August's price rank, by position group (RB/WR pooled, QB, TE), rank tier (top/mid/deep) and games share (full 75%+, part 40-75%, lost under 40%). Thin groups widen to the next tier first. Examples: RB1 full season -> RB2 (1-3); RB1 lost season -> RB3 (2-3); RB3 lost -> RB8 (6-10).
- The middle of that range sets his price and projection: the 2026 board's price and projection at that rank. Then the normal cost (tiers fit on 2025+2026 boards, slot windows 2022-2026), worth and edge.
- Keepers: each team's best calls from the Keepers page (locked contracts first), switchable per player; switches are saved in the viewer's browser.
- QB prices, 6-pt passing TDs: no bump. QB share of points over replacement was 9.6%, 10.9%, 7.8% in 2023-25 (4 pts) and 7.4% in 2026 (6 pts): the extra points lift QB12 too, so the gap that sets value barely moves. The 2026 auction (already 6 pts) gave QBs 6.6% of open money. Worth already counts 6 pts.
- Replaced by Nic's FantasyPros file next summer (`data/draft-prep/2027/`).

## Draft section: board, settings, personas and mock auctions (Nov 18)

Draft prep has its own sidebar section, **Draft**: Board and Settings.

- Personas (`draft-prep.json` `personas`, built from the 2022-2026 drafts): position lean (his share of spend at the position over the league's, pulled toward 1 by how much he spent there), overpay (paid vs. expected price), stars (his priciest buy each draft), favorite NFL teams (2.5x the league's rate, 5+ buys, ESPN drafts since 2018). Settings shows them as sliders; changes are saved in the viewer's browser.
- Mock auctions (`src/engine/mockAuction.ts`): the other 11 teams buy the open pool 100-500 times, priciest first with some shuffle. Each bid = expected cost x persona x noise, capped by the owner's max bid, position limits and the slot's ceiling, and lower once his starters there are covered. Price = second-highest bid + $1, scaled so players sell for about their expected cost on average (2026 test run: mock prices missed real ones by $6 on average, the board's cost by $5.60).
- Board: Chance at your price (was Get %: how often nobody else would pay more than Nic's bid, his planned bid, else expected cost; a tie counts half), one player at a time before his budget, with the usual sale price in the hover text; and "every bid holds" (was plan odds) in My plan. The Likely buyer column is gone (Nic, Nov 19: just the odds of winning the bid at his price, no "usually goes to"). Reruns a quarter second after the last change, in the mock-auction worker.

## Mock draft (Draft > Mock draft, Nov 18)

Full auctions with all 12 teams on the live board, after keepers (`runAuction` in `src/engine/mockAuction.ts`; the board's Chance at your price uses the same auction).

- Nomination: teams nominate in turn. Each nomination picks top 24 / 25-72 / the rest by price at the league's measured rate for that stage of the draft (`draft-prep.json` `nomination`, from the order players came up in the 2022-26 auctions: first fifth 65% top, second 21% top and 65% middle, ... last fifth 99% cheap). Usually the priciest one left at a position the nominator doesn't need; 30% of the time a wild card from that group.
- Nic's team bids his plan (planned bids, $1 on anyone else so leftovers fill his roster) or an auto-fill strategy as bids. The other 11 bid by persona.
- The auction runs until every roster is full; unpriced players with the best projections fill in as $1 fodder. The nominator opens at $1, so he picks someone he could take, and late in the draft someone he wants.
- Roster shapes like the real ones (2022-26 auctions: QB 1-2, RB 4-5, WR 5-7, TE 0-2): every team, Nic's strategy included, bids less past its starters, a fifth past a usual roster (1 QB, 5 RB, 7 WR, 1 TE; half for a backup QB) and stops at 3 QB / 6 RB / 8 WR / 3 TE. Teams must keep room for a legal lineup. Below $1 of interest an owner bids the $1 minimum only that share of the time. (Nic, Nov 18: Chris was buying only QBs.)
- Page (redesigned Nov 19: one simulation, answers in Nic's terms; it was Run mock / Run again / Most typical of 100). It plays 100 auctions in the mock-auction worker by itself whenever the plan, keepers or fill choice change (`draftOutlook` in `src/engine/mockAuction.ts`); the same inputs give the same answer, and **Re-Roll Draft** plays a fresh 100 with new luck (Nic, Nov 19: "I can't re-run the mock to see other outcomes"; numbers move a few points between rolls). It shows:
  - the headline: how often his whole plan comes together, and the players he usually buys and money he usually has left;
  - Your targets, least likely first: his odds of winning each planned player at his bid, and, over the drafts he lost him, what it took to win him (the winner's top bid + $1): the median and the middle half of the range, since it varies draft to draft. No "usually goes to" (Nic, Nov 19);
  - Watch an example draft: the most typical of the 100 (the one where the most players went where they usually go) and 11 more to step through with Previous / Next draft, each with his result, each target he lost there (who won the bid, at what price, and what it took to win him in that draft), every roster (the % by a price: how often that team landed him across all 100) and the nomination log with the runner-up bid.
- Board vs Mock draft: the Board looks at one player at a time before his budget; the Mock draft plays the whole plan with his real budget, so its chances can be lower. Both say so in their help text.

## Mock dials fitted to real auctions (Nov 18)

Nic: "we can't hardcode this logic". Too little data for a learned model (5 drafts under today's rules), so the mock keeps its readable steps and `npm run data -- fitmock` (`scripts/fitMock.ts`) picks its five dials (bid randomness, interest past starters, past a usual roster, money pressure, wild-card nominations) from 432 combinations by replaying the 2025 auction (Nic's full 2025 FantasyPros board, real keepers, owners as personas) and checking on 2026. Money pressure builds through the draft (none at the opening bid). Draft > Settings shows the fit.

Result on 2026 (held out): money left per team off by $1.72 (was $28.38 with the starting dials); price miss $5.60 (was $6.69); roster shape 0.43 players per position (0.46); only 42% of real prices inside the mock's middle-80% range. Money pressure sits at the edge of its range: the mock's structure, not its dials, is now the limit.

Stars fix (Nov 18): the persona habits (lean x overpay, x stars) used to stack, so the second-highest bid for a star sat at the slot ceiling every time (Chase $89 in all 200 mocks; he went for $70 in 2026) and Get % at expected cost read 0%. Calibration now divides those habits out per position, star or not, so a player sells for about his expected cost on average; the habits still decide who buys him. Chase on the 2027 board: Get % at his $65 cost 14% (was 0%). It stays under 50% on purpose: to win him you have to beat the one owner who wants him most, not the average price.

## Phases

1. Market analysis report.
2. Economy and valuation, with stand-in projections.
3. Keepers and personas.
4. Roster builder (both engines).
5. Nomination.
6. Backtest, then load Nic's projections next summer.

## References

Nic's earlier work, kept for reference only. Build from this repo's data; re-measure, don't copy, their constants.

| File | What it is |
|---|---|
| `reference/2026_Draft_Board.xlsx` | The 2026 board: tiered cost model, keepers, 2025 backtest. Source of the cost method. |
| `reference/Draft_Value_Methodology.md` | How the board's numbers are calculated. |
| `reference/Legacy_vs_2026_Comparison.md` | 2025 app vs. the Python pipeline. Errors: QB max is 4, not 2; keeper raises are modeled in this repo. |
| `reference/Draft_Intelligence_Spec.md` | Draft-day budget, scarcity and buy/wait/pass spec. Later phase. Budget reserve math reused by the builder. |
| `reference/legacy-Index.html`, `legacy-Baseline_Calcs.js` | 2025 Apps Script/Firebase app (config redacted). UI ideas only: keeper No/Yes/My Keeper, target checkbox, mock roster panel. |
| github.com/nicf8814/2026ff_predraft_app | Python pipeline (source of the worth method). Stale: scores pass TDs at 4; rules doc says max 2 QB and exactly 2 keepers; its measured constants can't be audited (source workbook missing). Its `2026_draft_results.csv` is 2025's auction. |

Findings from that repo to check against our data: 120 pts/week was only the 62nd percentile in 2025 and a top-3 finish needed about 128+; teams left about 14.6 pts/week on the bench in 2025.

## Open questions

1. 2026 weekly scores in data/history/matchups.csv average 76, against about 113 in 2024–25. Check before using them for win chances.
