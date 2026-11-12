# League History: three design options (with draft history)

Designs only. Nothing in `src/`, `public/` or `data/` changed. Open the three HTML files in a browser; each is self-contained (real tokens, fonts and data inlined, about 600 KB). A dark bar at the top is review chrome, not page design: it flips **State** (live, loading, empty, partial) and **Theme** (system, light, dark).

| File | Option |
|---|---|
| `option-a-ledger-archive.html` | A. Ledger Archive: today's drawers, plus a Draft view per season and an all-time Drafts tab |
| `option-b-owner-season-grid.html` | B. Owner by Season Grid: owners down, seasons across, one metric at a time |
| `option-c-search-desk.html` | C. Search Desk: search every draft, filters, a player page across years |

Rebuild after editing: `node design-options/build.ts` (reads `public/seed/history.json`, `public/seed/fwhl-2026.json`, `data/history/rosters/sleeper-2024-2025.json` and the two draft exports in `design-options/source/`).

## What I read first

1. Static React 19 + Tailwind 4 site, no runtime libraries besides React, no outside calls; data arrives as input files through `npm run data`.
2. `DESIGN.md` is strict: ledger look, tokens only, three typefaces, six sizes, 40 px rows, 44 px targets, rules not cards, no shadows or pills, color always paired with a sign or label.
3. History today: `history.json` (107 KB) loads once and builds in about 28 ms; the page is drawers, one per season plus All seasons.
4. Weekly lineups already load per season (`lineups/<year>.json`, 50 to 80 KB) only when opened. That pattern extends to drafts.
5. `src/ui/table.tsx` already has sortable columns, a column chooser and CSV export.
6. A worker pattern exists (`finderClient.ts` / `finder.worker.ts`).
7. Owner identity: history uses owner keys; co-owners resolve through `seatOf` (Nick with Tommy from 2022).
8. The data is small. 3,000 picks, 852 players, a 9 KB season summary. Filtering every pick takes **0.13 ms** on the main thread.
9. Uneven years are the real problem, not size: price references, projections, keeper flags and points differ by year and platform.
10. `League_Draft_History.xlsx` was not in the uploads, so the mockups mark where your model's columns go but do not show them.

## Draft data facts the mockups handle

- **Sources:** ESPN draft export (2010 to 2023 and 2026, 2,688 picks) and Sleeper draft export (2024 and 2025, 312 picks). Every pick has the price paid and the owner; all are auctions with $200 budgets.
- **Owners map cleanly:** the three ESPN name differences (Clint Helling, Nic Ferrara, "Tommy Teves & Nick Heisterkamp") map to history keys. Sleeper accounts are matched by roster id through weekly scores (no hand typing; `chov13`, `braejones12` and `BaryGusey` resolve to Chandler Hovik, the filler team and Chris Walker). Zero unmatched.
- **Players across platforms:** name without punctuation or suffix, plus position. 852 distinct players; 424 drafted in 3 or more seasons; Aaron Rodgers in 15.
- **Price as a share of budget** compares the 16, 15 and 13 round eras.
- **Price reference is labelled per year:** ESPN average auction value (missing in 2017 and 2019), and in Sleeper years the export's own estimate, which is **not a Sleeper number**.
- **Projections:** ESPN preseason points 2018 to 2022 and 2026 (only 19 of 156 in 2023); Sleeper's were pulled after the season (hindsight). Not mixed silently: the mockups show season points and hindsight worth, and name the reference column per year.
- **Sleeper season points** are not in the draft file. They are computed from the weekly lineups and count weeks on a league roster only (marked `*`). 2026 is season to date (marked `†`).
- **Value** = hindsight worth minus price. Worth is a player's points over a replacement at his position (QB and TE 12th, RB 30th, WR 36th) priced at what that draft paid per point (non-keepers set the rate). Keepers are left out of value rankings by default and have their own "Keepers that paid off" view.
- **Keeper flags are uncertain** in 2010 (none flagged), 2022 (19 vs your sheet's 20), 2023 (sheet reconstructed) and 2024 (Sleeper flags 10, sheet 30). Each design shows these as partial, not as zero.

## Side by side

| | A. Ledger Archive | B. Owner by Season Grid | C. Search Desk |
|---|---|---|---|
| **Concept** | Keep the drawers. Each season gets **Standings, Week by week, Draft**. All seasons gets a **Drafts** tab: coverage strip, best and worst values, priciest, keepers that paid off, how each owner drafts, draft against finish. | One matrix of owners by seasons with a metric switch (Finish, Win %, Pts vs avg, Luck, RB budget, Keepers, Draft value, Top pick). Tap a square for that owner's season and draft; tap a year for the season. | A search box and filters (seasons, owner, position, keepers, price, sort) over every pick, saved views, and a player page with price against worth for every year he was drafted. |
| **Answers best** | "What happened in the 2018 draft?", "Who drafts stars and scrubs?", all-time best and worst values | "How has Clint done over 17 years?", "Who spends on RBs?", where draft value and finish line up | "What did people pay for Kelce, year by year, and who had him before and after?", any narrow question |
| **Draft questions in 1 to 2 taps** | Best and worst value (season and all time) yes; per player across years no (needs a search); owner style yes; keepers yes; draft vs standings yes | Owner style yes; draft vs standings yes; best and worst per owner season yes; per player across years no | Best and worst value yes; per player across years yes; keepers yes; owner style partly (filter by owner); draft vs standings no |
| **Principles used** | Chunked loading (a draft file per season), pagination (25 per page, rounds as pages), presets, URL state, memoized summaries | Overview first then details, small summary index, coverage strip, normalization (share of budget, rank, vs average), URL state | Debounced search (200 ms), worker, saved views, pagination (25), URL state, pre-built player index |
| **Not used, and why** | Virtualization and infinite scroll: no list here passes about 200 rows | Virtualization: the grid is about 28 by 17 cells. Worker: a 9 KB summary needs none | Virtualization: results are paged. The worker is honestly **optional at today's size** (0.13 ms to filter everything); it earns its keep only if search grows to lineups (about 37,000 player-weeks) |

## Data plan (shared by all three)

New input files, same manual flow as the rest of `data/history/`:

- `data/history/drafts/espn-2010-2023-2026.json` and `sleeper-2024-2025.json`: the exports as received.
- `data/history/accounts.csv`: `platform,season,account,owner` for Sleeper display names and any ESPN name that differs. Prefilled by matching scores; the build fails on an unmatched account.
- `data/history/player-names.csv`: overrides for names the suffix rule misses (nicknames, D/ST naming). Starts empty.
- `data/history/draft-model.csv`: your sheet's model columns (projected value, inflated market value, bid floor and ceiling, VORP, keeper value gap) for 2019 to 2026, exported from the xlsx. Optional; shown as its own labelled columns.
- `data/history/keepers.csv`: corrections where the flag is wrong (2024 Sleeper shows 10, sheet 30). The build applies them and the coverage note says so.

New command `npm run data -- drafts [--dry-run]`. The dry run reports unmatched owners, accounts and players, keeper flag counts against your sheet, and per-season spend. It writes:

| File | Size today | Loaded when |
|---|---|---|
| `public/seed/drafts/<year>.json` (17 files, same compact style as `lineups/`: a player table plus tuples) | up to 15 KB raw, 5 KB gz each | A: a season's Draft view opens. B: a square is tapped. C: a player page opens |
| `public/seed/drafts/summary.json` (owner by season: finish, record, spend, keepers, value) | 9 KB raw, 3 KB gz | A: Drafts tab. B: page open. C: owner filter |
| `public/seed/drafts/players.json` (every player's picks across years) | 121 KB raw, 30 KB gz | C only, on first search |

2026 refresh: the weekly `rosters` and `results` flow already updates season points. `npm run data -- drafts` re-reads the 2026 picks' points from the league seed, so the live draft stays season to date without a new export. `npm run data:check` would fail while draft files are out of date, like history and lineups today.

This also sets up your draft engine: the per-season files and the summary are the history it can learn from (price by position, keeper value, owner tendencies), and `draft-model.csv` is the slot for its outputs.

## Component and state plan

| | A | B | C |
|---|---|---|---|
| New components | `SeasonDraft` (group by team, round or value; pager), `DraftsTab` (coverage strip, ranking presets, owner styles, draft vs finish) | `SeasonGrid` (metric switch, sticky owner column), `CellDetail`, `YearDetail`, `CoverageRow` | `SearchDesk` (box, filters, presets), `DraftResults` (pager), `PlayerDraftPage`, `draftSearch.worker.ts` (optional) |
| URL | `?tab=drafts&preset=best&page=2`, `?dr=2018-team` | `?metric=value&who=all&cell=clint-h.2018` | `?q=kelce&pos=TE&keeper=exclude&from=2018&sort=value&p=2` |
| Memory | Loaded season files, cached like lineups; summaries memoized on the file | Summary only; one season file per tapped square | Player index once; results ids |
| Worker | None | None | Search (optional today) |
| Reuses | `useTable` column chooser and CSV export, `Sheet`, `Seg`, drawers | `.tbl` sticky column, owner page links | `useTable`, `Sheet`, the existing worker client pattern |

## Performance

Measured today: 3,000 picks; season draft file 5 KB gz; summary 3 KB gz; player index 30 KB gz; filtering every pick 0.13 ms. Not measured: a real phone, and Safari.

| | A | B | C |
|---|---|---|---|
| First paint of History | Unchanged (history.json only) | Adds the 3 KB summary | Unchanged until Search opens, then 30 KB |
| Opening a season's draft | 5 KB, about 200 rows grouped into 12 folds or 25-row pages | 5 KB for one square | 5 KB for a player's years are already in the index |
| At 3x (about 25 seasons, 4,500 picks) | Same per season; Drafts tab summary about 15 KB | Grid 25 columns wide (scrolls in its box); summary 5 KB | Index about 50 KB gz; filter under 1 ms. Virtualize only if a single view renders over about 1,000 rows, which none does |

## Accessibility

- All three keep real `<table>` semantics with `<caption>`, sticky headers, and the first column sticky. Pagination (not infinite scroll) gives screen readers a stable position.
- Color never carries meaning alone: values carry a sign, finishes a number, positions a label, coverage a symbol (● ½ –) plus a hidden word and a tooltip.
- Keyboard: every control is a button, select or input; controls are 44 px tall, names inside tables are text links as on the live page. Drawers are native `<details>`.
- Motion: only the drawer chevron rotates, on the existing tokens, which drop to 0 ms under reduced motion.
- B's grid is the hardest for a screen reader (about 400 cells). Each cell is a labelled button ("Clint H 2018: 1st"), and the metric definition is linked with `aria-describedby`.
- C announces result counts (`aria-live`) and keeps focus in the search box while results update.

## Effort, risks, workflow

| | A | B | C |
|---|---|---|---|
| Effort | **S to M** (the draft command is most of it) | **M** | **M to L** |
| Risks | The Drafts tab grows into a second busy page if every ranking is added | Dense on phones; one metric at a time hides context; partial years need care so a "–" is not read as zero | Search-only pages hide the overview; the worker adds code for no gain today |
| Weekly workflow | No change. Drafts change once a year: drop the export in `data/history/drafts/`, run `npm run data -- drafts --dry-run`, then the usual checks | Same | Same |

## Comparison and recommendation

| | A. Ledger Archive | B. Owner by Season Grid | C. Search Desk |
|---|---|---|---|
| Questions answered | Season and all-time drafts, owner style, draft vs finish | Owner over time, any metric by year | Any player or narrow question across years |
| First-load cost | None until opened (5 KB a season) | 3 KB summary up front | 30 KB on first search |
| Cross-year comparison | Rankings only | Best | Per player and filter |
| Mobile fit | Best (drawers, folds) | Weakest (wide grid in its own scroll box) | Good |
| Accessibility risk | Low | Medium (big grid) | Low to medium |
| Build effort | S to M | M | M to L |
| Data maintenance | Draft command once a year | Same plus the summary | Same plus the player index |

**Recommendation: build A now, then add C's player page and search as a "Search" tab in All seasons later.** The data is small, so the techniques that matter are per-season files, a small summary and clear labels for uneven years, not virtualization or workers. A keeps the drawers you just approved and answers four of the five draft questions in one or two taps. The fifth, "what did people pay for this player year by year", is C's strength, and its player page drops straight into A's player links. B's grid is the best single overview, but on a phone it is the weakest, and its one-metric-at-a-time view needs the drawers anyway.

Build first: the `drafts` command with `accounts.csv`, then A's season Draft view, then the Drafts tab. Defer: C's search and player page (next), the worker (only if search grows to lineups), and B (worth revisiting as an Owners tab view later).
