# How the Draft Board Values Are Calculated

Favre's Waffle House (FWHFFL): 12 teams, $200 budget, salary cap auction, 0.5 PPR, 13-man rosters, max 2 keepers per team.

This document describes the 2026 model exactly as it runs in `2026_Draft_Board.xlsx` (Settings + 2026 Draft Board tabs). Every number below can be traced to a cell in that workbook. Section 10 covers the older 2025 model so the history tabs make sense, and section 11 lists where every historical number came from.

---

## 1. The pipeline at a glance

Each player moves through these steps, in this order:

| Step | Output | Feeds price? |
|---|---|---|
| 1 | Projected Points (league scoring) | No (feeds VORP only) |
| 2 | Projected Value ($, consensus) | **Yes** |
| 3 | Position Rank and Pricing Tier | **Yes** |
| 4 | Tiered Factor | **Yes** |
| 5 | Effective Base Inflation (keeper aware) | **Yes** |
| 6 | Inflated Market Value | **Yes, this is the price** |
| 7 | Bid Floor and Bid Ceiling | Price range |
| 8 | Keeper override | Replaces price for keepers |
| 9 | Replacement Level and VORP | No (informational) |
| 10 | VPD and VORP Tier | No (informational) |

The key design choice: **price comes from the market (consensus dollars, adjusted for how this league actually bids). Points and VORP never move the price.** VORP tells you whether a price is a good deal, not what the price is.

---

## 2. Projected Points (2026, league scoring)

FantasyPros 2026 stat projections (passing, rushing, receiving lines) are re-scored with the league's 2026 ESPN rules:

| Stat | Points |
|---|---|
| Passing yard | 0.05 |
| Passing TD | **6** (new for 2026, was 4) |
| Interception | -2 |
| Rushing / receiving yard | 0.15 |
| Rushing / receiving TD | 6 |
| Reception | 0.5 |
| 2-pt conversion | 2 |
| Fumble lost | -2 |

```
Projected Points = 0.05*PassYd + 6*PassTD - 2*INT + 0.15*(RushYd + RecYd)
                 + 6*(RushTD + RecTD) + 0.5*Rec + 2*TwoPt - 2*FumLost
```

Example: Josh Allen recomputes to **483.3** vs FantasyPros' default 372.5. The 6-point passing TD adds roughly 97 to 115 points to every top-12 QB. (Source: `2026_Analysis_Phase1.xlsx`, "2026 Recomputed Points" tab.)

---

## 3. Projected Value ($, consensus)

The FantasyPros consensus auction value pulled on **8/22/2026** (`2026 Fantasy Pros Auction Values 8.22.26.csv`), on a $200 / 12-team scale. Example: Jahmyr Gibbs $63, Ja'Marr Chase $53, Josh Allen $25.

This is the starting point for every price. It is a single-source number, so it is the biggest outside input in the model.

---

## 4. Position Rank and Pricing Tier

**Position Rank** ranks each player within his position by Projected Value (not by points):

```
Pos Rank = COUNTIFS(Position = mine, Projected Value > mine) + 1
```

Ties share a rank (Gibbs and Bijan are both RB1 at $63).

**Pricing Tier** buckets that rank using the cutoffs below. The cutoffs came from natural price cliffs in the 2025 live-bid data.

| Position | Tier | Pos Rank range | Tiered Factor | Tiered Volatility |
|---|---|---|---|---|
| QB | Elite (must-have QB1) | 1 to 4 | 1.242 | 10% |
| QB | Streamer tier | 5+ | 0.429 | 53% |
| RB | Elite RB | 1 to 6 | 1.295 | 8% |
| RB | High-Mid RB | 7 to 13 | 1.030 | 16% |
| RB | Low-Mid RB | 14 to 24 | 0.765 | 43% |
| RB | Deep/bench RB | 25+ | 0.532 | 34% |
| WR | Elite WR | 1 to 6 | 1.302 | 11% |
| WR | Mid WR | 7 to 20 | 0.795 | 22% |
| WR | Deep/bench WR | 21+ | 0.724 | 32% |
| TE | Elite TE | 1 to 4 | 0.452 | 21% |
| TE | Rest of TE | 5+ | 0.400 | 7% |

---

## 5. Tiered Factor (how this league bids vs. consensus)

The Tiered Factor is the league's measured over/under-pay for that tier. Each factor was fit so that, across the 2025 auction's 134 live-bid (non-keeper) picks, the tier's average modeled price equals its average actual price (zero average bias per tier).

What the factors say about this league:

- **Studs get bid up.** Elite RBs (1.295x) and Elite WRs (1.302x) go for about 30% over consensus.
- **The middle collapses.** Low-Mid RB (0.765x), Mid WR (0.795x), and every non-elite tier go well under consensus.
- **QBs and TEs are cheap.** Streamer QBs go for about 43% of consensus. Even elite TEs go for under half (0.452x), because there is no dedicated TE slot.

Why tiers instead of one number per position: the old flat factors (QB 1.00, RB 1.074, WR 1.077, TE 0.627) averaged the bidding wars at the top with the $1 bench bids at the bottom and got both wrong. Against the 2025 backtest, tiering raised price correlation from **0.9389 to 0.9723**.

Sample size caveat: RB (n=51) and WR (n=60) are solid. QB (n=13) and TE (n=10) are thin, so treat their factors as directional.

---

## 6. Effective Base Inflation (keeper aware)

Keepers change how much money is chasing the remaining players. The model recalculates inflation from the actual keeper list:

```
Total League Budget       = Teams * Budget                  = 12 * 200 = $2,400
Total Weighted Value      = SUM(Projected Value * Tiered Factor), all players   = 2,132.76
Kept Weighted Value       = same sum, active keepers only                      =   554.48
Keeper Spend              = SUM(Keeper Cost), active keepers                    =  $560
Remaining Budget          = 2,400 - 560                                         = $1,840
Remaining Weighted Value  = 2,132.76 - 554.48                                   = 1,578.29

Effective Base Inflation  = Remaining Budget / Remaining Weighted Value = 1.1658
```

Reading it: if keepers as a group cost less than they are worth, more real money chases the open pool and prices rise. If keepers are overpaid (CeeDee Lamb at $82), it pushes prices down. With the 19 locked 2026 keepers the net effect is **+16.6%**.

The Keepers tab has an "Active?" toggle. Setting a keeper to No puts him back in the auction pool and removes him from this calculation, useful for testing how much one outlier keeper swings the board.

A static fallback factor of **1.125175809** (left over from the 2025 calibration) is still in Settings!B3 and is used only if "Use Dynamic Base Inflation?" is set to No.

---

## 7. Inflated Market Value (the price)

```
Inflated Market Value = ROUND(Projected Value * Effective Base Inflation * Tiered Factor, 2)
```

**Worked example, Jahmyr Gibbs (RB1, Elite RB):**
```
$63 * 1.1658 * 1.295 = $95.11
```

**Worked example, Josh Allen (QB1, Elite QB):**
```
$25 * 1.1658 * 1.242 = $36.20
```

---

## 8. Bid Floor and Bid Ceiling

The range uses the tier's volatility (table in section 4). The floor is pulled in less than the ceiling is pushed out (80% of volatility), so the range is skewed upward to match how auctions overshoot.

```
Bid Floor   = MAX(1, ROUND(Inflated Value * (1 - Volatility * 0.8), 0))
Bid Ceiling = MAX(1, ROUND(Inflated Value * (1 + Volatility), 0))
```

Gibbs (8%): Floor = 95.11 * 0.936 = **$89**, Ceiling = 95.11 * 1.08 = **$103**.

Volatility was grid-searched against 2025 to land about 55% of real prices inside the range. Elite tiers are tight (stars sell near expectation); deep tiers are wide (one reach bid scatters them). Backtest in-range coverage: **60.4%**.

---

## 9. Keepers

A keeper's price is his contract, not the market model:

```
If Keeper:  Inflated Value = Keeper Cost
            Bid Floor      = Keeper Cost
            Bid Ceiling    = Keeper Cost * (1 + Volatility)   (quirk carried over from the live app)
```

Two extra columns show what the keeper would cost on the open market:

```
Open-Market Value if Not Kept = Projected Value * Effective Base Inflation * Tiered Factor
Keeper Value Gap              = Open-Market Value - Keeper Cost
```

Positive gap = bargain keeper. Negative = overpaying vs. market. CeeDee Lamb: $56.16 market vs. $82 cost = **-$25.84**.

League keeper rule (Manifesto Art. XIII): a kept player costs prior salary **+$10** (1-year contract), or **+$15 then +$10** (2-year contract). Max 2 keepers per team starting 2026.

The old project doc suggested a 15% "opportunity cost" multiplier on keepers. That is not used in the current board.

---

## 10. VORP, VPD, and VORP Tier (informational only)

### Replacement level
Replacement level is the points of the last startable player at each position, based on actual 2026 lineup slots (QB, RB, RB, WR, WR, WR/TE, FLEX) times 12 teams. Flex usage shares are editable assumptions on the Settings tab.

| Position | Formula | Replacement Rank | Replacement Points |
|---|---|---|---|
| QB | 12 * 1 | QB12 | 401.61 |
| RB | 12 * (2 + 1 FLEX * 45%) | RB29 | 223.94 |
| WR | 12 * (2 + 1 WR/TE * 70% + 1 FLEX * 45%) | WR38 | 186.84 |
| TE | 12 * (1 WR/TE * 30% + 1 FLEX * 10%) | TE5 | 199.88 |

Replacement Points = the projected points of the player at that rank (ranked by points within position).

### VORP
```
VORP = Projected Points - Replacement Points (for his position)
```
Gibbs: 435.12 - 223.94 = **211.2**. A negative VORP means a free agent should be able to match him.

### VPD (VORP per dollar)
```
VPD (primary)   = VORP / Inflated Market Value     -> drives the VORP Tier label
VPD (worst case)= VORP / Bid Ceiling               -> supplementary, no label
```

### VORP Tier
| VPD at Inflated Value | Tier |
|---|---|
| 2.5 or more | Elite |
| 1.9 to 2.49 | Good |
| 1.3 to 1.89 | Fair |
| 0.9 to 1.29 | Poor |
| under 0.9 | Overpriced |

These thresholds are provisional and only label value. They never change the price.

---

## 11. The older 2025 model (what the 2025 tab's projections came from)

The 2025 board (`2025_Draft_Core_Economic_Model.xlsx`, same data as the project's `players.json`) used a simpler formula:

```
Inflated Price = Projected Price * 1.125175809            (one flat base inflation)
Bid Floor      = ROUND(Inflated * (1 - Pos Volatility * 0.8))
Bid Ceiling    = ROUND(Inflated * (1 + Pos Volatility))    QB 8%, RB 10%, WR 9%, TE 7%
VORP Rank      = Projected Points - Replacement            QB 281, RB 143.9, WR 141.5, TE 109
VPD            = Projected Points / Inflated Price
```

Example: Ja'Marr Chase $58 * 1.1252 = $65.26, floor $61, ceiling $71. He went for $89.

What 2025 taught the 2026 model:
- One flat inflation number misprices both ends of the market. 2024 data showed **+30 to +40%** on projected $25+ players and **-39% to -49%** on $3 to $14 players, while overall open-auction inflation was about **-2.6%**.
- Weekly projections are too spread out (high ones overshoot, low ones undershoot). Price bands beat point estimates.

Note: the project files `players.json` and `economic_calculations_breakdown.md` still describe the 2025 data and an earlier "barbell" draft of the model. The 2026 Draft Board supersedes both.

---

## 12. Sources for the league history workbook

| Season | Auction prices | Projected value | Projected points | Inflated value | Actual points |
|---|---|---|---|---|---|
| 2026 | Not on file yet (keepers only) | FantasyPros 8/22/26 | Recomputed, league scoring | 2026 Draft Board | Season in progress |
| 2025 | Sleeper auction, 156 buys | 2025 Economic Model | 2025 Economic Model | 2025 Economic Model | Full season, league scoring |
| 2024 | League file, 155 buys | 2024 workbook | 2024 workbook | **Not preserved** | Full season, league scoring |
| 2023 | ESPN recap, 156 buys | 2023 Auction Values | None | None | None |
| 2022 | League file, 179 buys | None | None | None | QBs only, recomputed* |
| 2021 | League file, 180 buys | None | None | None | QBs only, recomputed* |
| 2020 | League file, 180 buys | None | None | None | None |
| 2019 | League file, 180 buys | None | None | None | None |
| Pre-2019 | **No data on file** | | | | |

\* Recomputed from season stat lines with pre-2026 scoring (4 pt passing TD).

Caveats:
- 2022 keeper flags are undercounted in the source (19 flagged; the league reported 27).
- 2023 keepers are reconstructed from the keeper pick slots (picks 1 to 30).
- 2025 manager names are Sleeper usernames; 2023 uses ESPN team names; other years have no manager on file.
- A few 2025 players (Joe Mixon, Travis Hunter, Tre Harris) show no actual points because they never logged rostered weeks.
