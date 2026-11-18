# Draft Prep Machine: design

Status: draft, Nov 18, 2026. No code yet. League rules: docs/rules/league-rules.md.

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
| QB prices | Raised for 6-pt pass TDs, not left at history. |

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

- **Fair price**: VORP turned into dollars so the whole pool's money is spent. If keepers were bargains, everyone left costs more.
- **Expected price**: fair price adjusted toward what the league actually pays (history curves and personas).
- **Tiers**: ranking tiers by projected points, cut where the gap between players is biggest; price bands from history.

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

- The page checks a hash of the password, so the password itself is not in the code. Remembered in the browser after the first unlock.
- Nic's inputs are stored as plain files in the repo.
- Mark it in code as `// shortcut: password screen only, data is public in the repo; revisit if Nic shares the tool or wants real privacy`.
- Removing the screen later (to share with the league) is a one-line change.

## Phases

1. Market analysis report.
2. Economy and valuation, with stand-in projections.
3. Keepers and personas.
4. Roster builder (both engines).
5. Nomination.
6. Backtest, then load Nic's projections next summer.

## Open questions

1. 2026 weekly scores in data/history/matchups.csv average 76, against about 113 in 2024–25. Check before using them for win chances.
