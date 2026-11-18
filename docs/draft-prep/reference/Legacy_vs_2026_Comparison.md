# FWHFFL Draft Tool: Legacy App vs. 2026 Pipeline — Full Comparison

**Legacy system** = the Google Sheets/Apps Script/Firebase web app you uploaded (`index.html`, `Index.html`, `index_archive_firebasev1.html`, `code_gs.txt`, `rosters.html`, `players.json`, `settings.json`, `firebase.json`).
**2026 system** = the Python valuation pipeline (`FWHFFL_2.PY`, the corrected version of `FWHFFL_1.PY`) plus the Path C draft-day tool built on top of it (`FWHFFL_3.HTM`, the most current of the `FWHFFL_1/2/3.HTM` iterations).

---

## 1. What each system actually is

| | **Legacy (last year)** | **2026 (this year)** |
|---|---|---|
| Core engine | Google Apps Script (`code_gs.txt`) running inside a Google Sheet, triggered `onEdit` | Standalone Python pipeline (`FWHFFL_2.PY`), run offline against FantasyPros + league history files |
| Front end | `index.html` (main draft tool) + `rosters.html` (Sleeper roster sync) + two more evolutionary copies (`Index.html`, `index_archive_firebasev1.html`) | `FWHFFL_3.HTM` — single-file static tool with the pipeline's output embedded directly as a JS data array |
| Hosting | Google Sheets web app **and** a Firebase static-hosting migration in progress (`firebase.json`, `index_archive_firebasev1.html` = archived Firebase build) | None — self-contained HTML file, no hosting/backend yet |
| Live sync | Yes — Firestore (`db.collection('settings')...`) and Sleeper roster pulls (`rosters.html`) so multiple managers could see updates | No — `RAW_PLAYERS` is a frozen snapshot baked in at generation time; re-running the pipeline means regenerating the HTML |
| Data store | Google Sheet "Draft Pool" / "Settings" tabs, exported to `players.json` (474 players) and `settings.json` | CSV/XLSX inputs → pandas pipeline → CSV board (`FWHFFL1.CSV`, 153 players) → hand-embedded into the HTML |

**Bottom line:** last year's tool was a *live, multi-user, cloud-synced* app; this year's is a *single-run, single-user, static* tool that sits directly on top of a far more rigorous valuation model. They're strong in opposite places.

---

## 2. Pricing philosophy — the core difference

| | **Legacy** | **2026** |
|---|---|---|
| Where the dollar value originates | An externally-sourced `projectedPrice` (a market/ADP dollar estimate typed or imported into the sheet) | Computed *from scratch* out of raw stat projections → VORP → a $2,400-pool allocation |
| Formula | `price = projectedPrice × baseInflation × posFactor` | 6-stage pipeline: shrink stat lines → team-environment adjust → convert to VORP → tier → allocate $2,400 by VORP^exponent → apply tier/position inflation shape |
| Role of the market number | **Primary input** — the whole price is anchored to it | **Calibration target only** (Stage 5 picks an exponent so the #1 overall price matches the market's own top-3 average) — never a direct price source |
| VORP's role | A secondary *grading* metric (Elite/Good/Fair/Poor label) laid on top of the market price | The *primary* valuation mechanism — dollars are derived from VORP, not the other way around |

This is the single biggest architectural difference. Last year's tool answers "how should the market price move from where it already is?" This year's answers "what should the price be, built up from projections?" — with the market only used to sanity-check the shape.

---

## 3. Inflation model

| | **Legacy** | **2026** |
|---|---|---|
| Structure | **One flat scalar** applied to every player | **Barbell-shaped**: different multipliers by *both* projected-$ tier and position |
| Formula | `factor = remainingBudget ÷ remainingPosWeightedValue` (after removing keeper cash/value) | `shape = (tier_inflation + position_inflation) / 2`, applied on top of a separate keeper-driven `base` reconciliation multiplier |
| Measured/observed value | `baseInflation ≈ 1.125` (a **+12.5% flat markup**, stored in `settings.json`) | Tier bands run from **+39.6%** at $40+ down to **−48.5%** at $8–14, then back up slightly at $1–3 |
| Position skew | A static `posFactors` guess (`QB:1.00, RB:1.07, WR:1.08, TE:0.63`) | Empirically measured position inflation: `RB +16.7%, QB −20.3%, WR −11.7%, TE −23.1%` |
| Keeper interaction | Keepers change the *single* global scalar (less cash + less value removed from the pool) | Keepers only move the `base` budget-reconciliation term; the tier/position **shape now always applies**, even pre-keeper (this was a bug fix logged 2026-07-29 — the old pipeline code briefly had the same flaw the legacy app still has: gating shape behind keeper existence) |

This directly validates the "inflation is a barbell, not flat" finding already in your notes — the legacy app is a working example of the flat-multiplier approach the 2026 model was specifically built to replace.

---

## 4. VORP calculation

| | **Legacy** | **2026** |
|---|---|---|
| Formula | `VORP = projectedPoints − replacement` (season total) | `VORP_pg = PG_env − replacement` (per-game), then `VORP_tot = VORP_pg × 17` |
| Replacement levels | Static guesses, hand-set in Settings: `QB 250, RB 150, WR 130, TE 80` (season totals ⇒ ≈14.7/10.5/11.5/7.9 wk-normalized on 17 games — but the app never actually divides by games) | **Measured from 7 seasons of league data**: `QB 18.98, RB 11.13, WR 9.15, TE 10.65` pts/game |
| Games-played handling | None — points are whatever was pasted into the sheet, no per-game normalization step | Explicit "Option A" decision: trust FantasyPros' seasonal blend, divide by 17 *only* to bin players into shrinkage bands |
| TE vs WR replacement | TE (80) set **lower** than WR (130) — standard assumption | TE (10.65) measured **higher** than WR (9.15) — a real finding from how your league's REC_FLEX is actually used, which the legacy static guess would have completely missed |
| Downstream use | Feeds a VORP/$ **grade** (see §5), not the price itself | Feeds price directly via the Stage 5 dollar allocation |

The legacy replacement levels were never validated against your league's actual scoring or REC_FLEX usage — they're generic guesses. The 2026 numbers are reverse-engineered from real box scores, which is why they flip the TE/WR relationship.

---

## 5. Tiering

| | **Legacy** | **2026** |
|---|---|---|
| Method | Fixed VORP/$ cutoffs: `Elite ≥2.5, Good ≥1.9, Fair ≥1.3, Poor ≥0.9, else Overpriced` | Dynamic **gap detection** per position: a new tier starts when the drop in VORP/game between consecutive players exceeds `0.5 × that position's projection MAE` |
| Adapts to the position/year? | No — same five cutoffs regardless of position or how bunched/spread the player pool is | Yes — tier breaks move with actual per-position uncertainty (MAE) and actual talent gaps in the projection set |
| Purpose | Draft-day "buy/pass" label shown next to each player | Used both for gap-based tier labeling **and** as an input to the tier/position inflation shape in §3 |

---

## 6. Keeper handling

| | **Legacy** | **2026** |
|---|---|---|
| Keeper flag source | Manual per-player field in the sheet (`Keeper = "My Keeper"`) + `keeperCost` | Explicit `keepers` list `{player, salary, market_value}` passed into Stage 6 |
| Price override | Kept player's price is hard-set to `keeperCost`; that value and its budget are then backed out of the *single* inflation scalar | Kept player is priced at salary (excluded from `FinalValue`, shown as `NaN`/off-market); `base = (BUDGET − Σsalary) / (BUDGET − Σmarket_value)` reconciles the open pool |
| Per-team keeper cap enforcement | Not present in `code_gs.txt`'s core calc, but **is** enforced in the 2026 Path C UI (see §7) | Not yet — Stage 6 needs the confirmed 12-team keeper list to run at all (this is your current blocker) |
| GLC salary escalators (+$10/+$15) | Not modeled anywhere in the legacy code | Not yet modeled in `FWHFFL_2.PY` either — worth flagging as a shared gap |

---

## 7. Draft-day roster builder & position rules

| | **Legacy** (`code_gs.txt` mock draft) | **2026** (`FWHFFL_3.HTM`) |
|---|---|---|
| Roster shape | `QB1, RB1, WR1, RB2, WR2, WR/RB/TE, WR/TE` + 6 bench = 13 slots, hardcoded | `STARTER_SLOTS = [QB,RB,RB,WR,WR,FLEX,LFLEX]`, `ROSTER_MAX = 13` — same shape, defined as constants |
| Position caps | Only RB is checked (`rbCount > 5` flag) — **no QB or WR cap enforced** | `POS_MAX = {QB:2, RB:5, WR:8}` — all three caps enforced, matches your actual league rule |
| IR spot | Not modeled | Not modeled (both systems treat 13 as the whole roster; your league's separate IR spot isn't represented in either) |
| Fill algorithm | Greedy: sort selected players by cost descending, fill slots top-down | Greedy: maximize VORP/$ per dollar, respecting budget, roster size, and position caps, reserving $1/slot for remaining picks |
| Keeper-cap warning | None | Explicit UI warning if a manager has >2 keepers flagged |
| Validity checks | `totalCost ≤ 200` and all 7 starters filled at ≥$1 | Budget bar, roster count, live warnings for cap violations |
| Historical cross-reference | None | Each player record embeds **last year's actual price & manager** (`lastYear: {manager, price, ...}`) — a genuinely new capability, useful for "what did this guy go for last year" context at the table |

The legacy mock-draft function is close in spirit but has one real bug worth noting: it never enforces the QB (2) or WR (8) caps, only RB. If you ever revive that Apps Script, that's a one-line fix (`add colCount checks for QB/WR the same way rbCount is checked`).

---

## 8. Bid guidance (a legacy feature the 2026 build currently lacks)

| | **Legacy** | **2026** |
|---|---|---|
| Bid floor/ceiling | Yes — `floor = inflated × (1 − volatility×0.8)`, `ceiling = inflated × (1 + volatility)`, with per-position volatility (`QB 0.08, RB 0.10, WR 0.09, TE 0.07`) | No equivalent output yet — the pipeline emits a single `FinalValue`, not a bid range |

This is a genuinely useful legacy feature worth porting forward: a volatility-scaled bid window gives you a "don't pay more than X, you can walk below Y" range at the table instead of a single number. Your pipeline already tracks `MAE` per position (§2.2 of the framework), which is a ready-made volatility proxy if you want to reconstruct this.

---

## 9. Data inputs

| | **Legacy** | **2026** |
|---|---|---|
| Projections | Manually maintained in the Google Sheet — source unclear/unlogged | FantasyPros seasonal stat-line exports (`FantasyPros_Fantasy_Football_Projections_*.csv`), explicitly sourced and dated |
| Team environment | Not modeled | `NFL_Offensive_Analytics_2024_2025.xlsx` — opponent-adjusted EPA, coaching continuity, regressed toward league mean for new play-callers |
| League history | None referenced in the code | 7 seasons of auction results (`2019`–`2024` CSVs) used to measure replacement levels, MAE, inflation shape |
| Validation | None — no logged findings, no escalation process | 8-pass validation framework with ESCALATED/CORRECTED logging (`DRAFT_KIT_FRAMEWORK.md`) |

---

## 10. What's worth pulling from the legacy app into this year's build

| Legacy feature | Why it's worth reviving | Effort to port |
|---|---|---|
| **Firebase live sync** (`index_archive_firebasev1.html`, `db.collection('settings')`) | Lets every manager see the same board update in real time on draft night — `FWHFFL_3.HTM` is currently single-user/static | Medium — would need a small backend (Firebase or similar) instead of a baked-in JS array |
| **Sleeper roster sync** (`rosters.html`) | Automates pulling current rosters/keeper costs instead of hand-entering them — directly relevant to closing your Stage 6 blocker | Medium — note the league is migrating to ESPN, so this would need to target ESPN's API instead |
| **Bid floor/ceiling window** (§8) | Gives an actionable bid range, not just a target price | Low — you already have per-position MAE in the pipeline to drive it |
| **`onEdit` live recompute** (`code_gs.txt`) | Auto-recalculates the whole board the instant a keeper or target is flagged, no manual re-run | Medium-High — would mean moving the pipeline logic client-side or standing up a small backend |
| **QB/WR position-cap enforcement in the mock draft** | Legacy only checks RB; 2026's Path C already does this correctly — flagging as validated, not a gap | N/A (already fixed in 2026) |

## 11. What's worth keeping / already better in the 2026 build

- Measured (not guessed) replacement levels, MAE, and inflation shape — this is the core upgrade and shouldn't be diluted by reverting to legacy static settings.
- Barbell tier/position inflation instead of one flat scalar.
- Dynamic gap-detection tiering instead of fixed VORP/$ cutoffs.
- `lastYear` price/manager context embedded per player in `FWHFFL_3.HTM`.
- Explicit position caps (QB/RB/WR) enforced in the auto-build, not just RB.
- Logged, escalation-tracked validation process — the legacy app has no equivalent audit trail.

## 12. Open gaps shared by both systems

- Neither system models the separate IR roster spot (both cap at 13).
- Neither system models the GLC keeper salary escalators (+$10 one-year / +$15-then-+$10 two-year).
- Neither has ESPN integration yet (legacy targeted Sleeper; league is moving to ESPN for 2026).

---

## 13. Summary verdict

| Dimension | Winner | Why |
|---|---|---|
| Pricing rigor | **2026** | Model-derived from real stat projections + measured league parameters, not a market-price markup |
| Inflation realism | **2026** | Barbell shape matches observed auction behavior; legacy's flat +12.5% is empirically wrong for this league |
| Replacement levels | **2026** | Measured from 7 seasons vs. legacy's static guesses |
| Tiering | **2026** | Adapts to position-specific uncertainty and talent gaps |
| Live/multi-user usability | **Legacy** | Firebase sync + Sleeper roster pull; 2026 is currently a static single-run snapshot |
| Draft-day bid guidance | **Legacy** | Has a floor/ceiling bid window; 2026 outputs a single number |
| Position-cap enforcement | **2026** | Legacy only checks RB; 2026 checks QB/RB/WR |
| Auditability | **2026** | 8-pass validation log vs. no equivalent in legacy |
| Keeper handling | **Tie** | Both use a similar "back cash/value out of the pool" mechanic; neither models GLC escalators |
