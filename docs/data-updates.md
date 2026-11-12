# Updating the league data

The site reads one file: `public/seed/fwhl-2026.json`. Nothing edits it by hand. Every update goes through `scripts/data.ts`, which checks the input, applies it, validates the whole dataset and only then writes. If anything is off it exits with code 1 and writes nothing. A push to `main` then runs `data:check`, the tests and the build before it deploys, so bad data never goes live.

There are no APIs. ESPN and the trade charts are read by a person or by a scheduled task in a browser, turned into one of the input files below, and committed. How Claude gathers each file is in docs/gathering.md; nothing in the repo calls ESPN.

```bash
npm run data -- check                                     # validate and summarize
npm run data -- results     input.json  [--dry-run]       # task 1, after Monday Night Football
npm run data -- projections input.json  [--dry-run]       # task 2, before Thursday Night Football
npm run data -- rosters     input.json  [--dry-run]       # task 3, any time
npm run data -- chart peaked|menton <week> chart.csv [--dry-run]
npm run data -- drop-fantasypros [--dry-run]                # one time: remove the old FantasyPros data
npm run data -- careers     [--dry-run]                   # rebuild public/seed/careers.json from the lineup files
```

`--dry-run` prints the report without writing. `--force` skips the "too much changed" checks (only when the change is real). Each run prints a JSON report: `changes`, `created` (new players), `espnIdsAdded`, `unmatched` (names it could not place), `warnings`, and a summary of the dataset after the change.

## Publishing a change

1. Work on a fresh clone of `main`. Write input files outside the repo (for example `/tmp/fwhl/`).
2. `npm ci`, then run the command with `--dry-run` and read the report. Stop and report instead of writing if:
   - it errors (the message says why), or
   - `created` lists more than about 10 players, which means names or ids stopped matching.
3. Run it again without `--dry-run`.
4. `npm run data:check && npm test && npm run build`. All must pass.
5. Commit only the data file (and any chart CSV, below):
   `git add public/seed/fwhl-2026.json && git commit -m "Data: Week 10 results"`
6. `git fetch origin main && git rebase origin/main`. If the data file conflicts, another update landed first: `git rebase --abort`, `git reset --hard origin/main`, and redo steps 3 to 5 on top of it.
7. `git push origin HEAD:main`. The Deploy workflow publishes it in about a minute.

## Players and ESPN ids

Every player in an input is a reference:

```json
{ "name": "Josh Allen", "pos": "QB", "espnId": 3918298, "nflTeam": "BUF" }
```

- `name` and `pos` (QB, RB, WR or TE) are required. `espnId` and `nflTeam` are optional.
- A reference matches by `espnId` first, then by name (and position). When a name match has no ESPN id yet, the id is filled in. A run never fails because an id is missing; it matches by name as before.
- A name that matches nobody becomes a new player in `results`, `projections`, `rosters` and `transactions`; in `chart` rows without a position it is listed in `unmatched` and skipped.
- A player with the same name but a different ESPN id is treated as a different person.

## Input formats

### results (task 1)

```json
{
  "week": 10,
  "games": [[1, 3, 10, 145.35, 206.6, "final"], [11, 1, 2, null, null, "scheduled"]],
  "rows": [{ "player": {"name": "Josh Allen", "pos": "QB", "espnId": 3918298}, "teamId": 10, "slot": "start", "points": 31.2, "projection": 24.8, "opponent": "MIA" }],
  "season": [{ "player": {"name": "Josh Allen", "pos": "QB", "espnId": 3918298}, "seasonPoints": 301.5, "seasonAvg": 30.2, "posRank": "QB1" }],
  "transactions": []
}
```

- `week`: the last completed week; every game that week must be `"final"`.
- `games`: the whole regular season, Weeks 1 to 14, as `[week, homeTeamId, awayTeamId, homePts, awayPts, "final"|"scheduled"]`.
- `rows`: that week's line for every rostered player, plus free agents who scored. `slot` is `start`, `bench`, `ir` or `fa`; `opponent` is the NFL opponent or `"BYE"`. Each team's `start` points must add up to its score within 0.1, or the run stops.
- `season`: season totals for rostered players.
- `transactions`: see below. Existing ones are never changed.
- Backfill (task 5): an earlier `week` replaces only that week's rows and leaves "scores through" alone. Send `"season": []` so today's season totals aren't overwritten with old ones, and `"transactions": []`.

### projections (task 2)

```json
{
  "week": 10,
  "started": false,
  "players": [{
    "player": {"name": "Jahmyr Gibbs", "pos": "RB", "espnId": 4429795},
    "bye": 6, "ros": 270.4,
    "weekly": {"10": 28.4, "11": 27.1},
    "opponents": {"10": "GB", "11": "MIN"},
    "oprk": 22, "rosteredPct": 99.9, "startedPct": 99.1
  }]
}
```

- `started`: true once any game of the current week has kicked off; that week then counts as played.
- `ros`: ESPN rest-of-season points. The script works out points per week (ros over the games left, byes skipped) and the regular-season remainder through Week 14.
- `weekly` and `opponents`: single-week projections and opponents for weeks not played yet. `oprk`, `rosteredPct` and `startedPct` are for the current week.
- Stops if over 10% of rostered players have no projection, or over 15% moved more than 50%.

### rosters (task 3)

```json
{
  "teams": [{ "teamId": 10, "players": [
    { "player": {"name": "David Montgomery", "pos": "RB", "espnId": 4038441}, "slot": "ir", "injury": "OUT" }
  ]}],
  "transactions": []
}
```

- All 12 teams, every QB/RB/WR/TE on each roster. `slot` is `active` or `ir` (the IR slot). `injury` is `"Q"`, `"OUT"`, `"IR"` or `null` (ESPN Questionable, Doubtful and Day-to-day are `"Q"`; Injury Reserve is `"IR"`).
- Stops if fewer than 12 teams, a roster is empty, or over 25% of players changed teams.
- A status that is unchanged keeps its date and note. A new IR status starts today (its return week is that week + 4).

### transactions (inside results or rosters)

```json
{ "id": "t06af514c-f87e-4870-b490-38b58ffabdd3", "type": "trade", "date": "2026-11-05", "week": 9, "effectiveWeek": 9,
  "legs": [{ "player": {"name": "Garrett Wilson", "pos": "WR", "espnId": 4569618}, "from": 1, "to": 2 }] }
```

- `id`: `"t"` + the ESPN transaction id for an accepted trade; `"wi"` + the first 8 characters of the vetoed proposal's id for a veto (`"type": "veto"`).
- Both teams must send at least one player. A transaction whose id already exists is skipped.
- Each new trade leg is stamped with two snapshots the Trade tracker grades from: `rosAtTrade` (the player's ESPN rest-of-season projection in the data at that moment) and `valueAtTrade` (his Peaked/Menton chart value then). They can't be rebuilt later, so load a trade in the same run as, or right after, that week's projections and charts. Vetoes get no chart value; the tracker values a veto at today's numbers.

### chart (weekly trade charts)

A CSV with `name,value` and an optional `pos` column, one row per player, as the chart shows it:

```csv
name,value,pos
Jahmyr Gibbs,68.5,RB
Ja'Marr Chase,64,WR
```

The values are scaled so the chart's top player is 100. Rows with a `pos` that match nobody add a new player; rows without one are listed as unmatched. Needs 50+ matched players. Keep the CSV in `data/charts/<source>-week<N>.csv` and commit it with the data change.

### drop-fantasypros (one time)

FantasyPros rest-of-season ranks are no longer used: the market side of trade value is the two trade charts (Peaked 70 / Menton 30), and ESPN's rest-of-season projections drive the scoring side. The Buy & sell volume flags, the only use of FantasyPros usage stats, were dropped too. This command removes the old ranks, the usage list and both sources from the data file. Run it once; it takes no input.

## League history

The History page (League → History) reads `public/seed/history.json`, which covers 2010 to last season. The current season is never in it; the page adds it live from `fwhl-2026.json`, so the weekly tasks need no change.

The file is built from the CSV exports in `data/history/` and never edited by hand:

```bash
npm run data -- history [--dry-run]
```

- `championships.csv`, `matchups.csv`, `settings.csv`, `standings.csv`, `teams.csv`: the league export, as downloaded.
- `owners.csv`: who each owner name is. `team2026` links an owner to their team id in the league seed; `filler` marks a spot someone ran to fill the league (Clint's 2024-25 second team), which counts in that season but in no one's career; `note` shows on the owner's page. Ty Carlson's two ESPN ids merge because the export uses his name.
- `aliases.csv`: seasons where an export name belongs to someone else. From 2012, "Alex Teves" is Tommy Teves. Applied before anything else, so the export CSVs stay as downloaded.
- `bracket-fixes.csv`: playoff-week games the export got wrong, checked against the platform's bracket. In 2024-25 the export invented games for Sleeper teams with a bye or already placed, and left out the 2025 10th-place game. `drop` removes a game, `add` adds one with its scores; the build stops if a row doesn't apply.
- `sleeper-scores.csv`: Sleeper's own score for every 2024-25 game, taken from the Sleeper roster export. The league export's Sleeper scores run a little off (up to about 2 points, never changing a winner), so the build uses these instead.
- `coowners.csv`: an owner who shares another owner's team (from/to inclusive, `to` blank = still). From 2022 Nick Heisterkamp co-owns Tommy Teves's team, so those seasons, titles and games count in both careers. The team stays under Tommy's name in the season tables, with Nick shown alongside.
- `corrections.csv`: games where the official result differs from the box score (2012 Week 13, Wes over Cooper). Records follow the official result, and scores stay as played.

The build stops if a season's games do not reproduce the official records (unless `corrections.csv` explains it) or if the podium disagrees with the final ranks. `npm run data:check` fails while `history.json` is out of date with the CSVs.

After a season ends: export the new CSVs over the old ones, add any new owner to `owners.csv` (with `team2026` updated for the new season's ids if they change), run the command, then the usual checks. Code changes go through a pull request, the data refresh straight to `main`.

### Weekly lineups

Each season drawer on the History page has a **Week by week** view: pick a week, open a game for both lineups side by side, unfold the bench, tap a player for his season. It reads `public/seed/lineups/<year>.json`, one file per past season, loaded only when that view opens. Built, never edited by hand:

```bash
npm run data -- lineups [--dry-run]
```

- `data/history/rosters/espn-2010-2023.json` and `sleeper-2024-2025.json`: the roster exports, as received.
- Each export team is matched to its owner in `history.json` by its weekly scores (within a point and a half for Sleeper, whose own scores run slightly off the league export), so the exports' owner names never matter. The build stops if a team can't be matched.
- 2010-2017: ESPN kept weekly starters only (no bench or projections); the file adds each team's end-of-season roster with season totals. 2010-2011 have weeks where a starter is missing, flagged as "starters add to".
- Gaps show as gaps: an empty lineup slot reads "Empty slot", a game without a lineup says so, and a box score whose starters don't add up to the league record shows both numbers.

`npm run data:check` fails while the files are out of date with the exports. A new season's export goes in `data/history/rosters/` (extend `scripts/lineups.ts` for a new file name), then run the command.

### Draft history

The History page shows every auction since 2010: a **Drafts** tab in All seasons (search, quick questions, filters written as one sentence), a **Draft** view in each season (pick a team for its roster, prices, points, value and weekly starts), and a player history sheet behind every player name. It reads `public/seed/drafts.json` (about 70 KB compressed), loaded only when a draft view opens. Built, never edited by hand:

```bash
npm run data -- drafts [--dry-run]
```

- `data/history/drafts/espn-2010-2023-2026.json` and `sleeper-2024-2025.json`: the draft exports, as received.
- `accounts.csv`: draft names that differ from the history owner names. ESPN rows (season blank = every season) cover "Clint Helling", "Nic Ferrara" and the co-owned team; Sleeper rows map each season's display name (`nicf8814`, `braejones12`, ...). The build stops on any name it can't place, so a new Sleeper account gets a row here.
- `draft-notes.csv`: one line per season where the data is partial (no keeper flags in 2010, no ESPN average value in 2017 and 2019, Sleeper's keeper flag and projections in 2024-25). Shown on that season's draft.
- Players match across ESPN and Sleeper by name without punctuation or suffix, plus position.
- Weekly starts and Sleeper season points come from the lineups the same build makes (weeks 1-17, points while on a league roster).
- Value is worked out in the browser (`src/engine/drafts.ts`), so the 2026 draft's points and starts follow each weekly results push without rebuilding this file. The page explains the method behind the (i) button.

The dry run lists unmatched owners, keepers per season and each season's team spend range. `npm run data:check` fails while `drafts.json` is out of date. After a season's draft: add the export (extend `scripts/drafts.ts` for a new file name), add any new account to `accounts.csv`, run the command, then the usual checks.

### Trade history

History → All seasons → **Trades** lists every trade from 2018 to last season, each side graded A to F; a season's **Trades** view shows that year's, and owner pages show each owner's trades. Reads `public/seed/trades.json` (about 80 KB), built and never edited by hand:

```bash
npm run data -- trades [--dry-run]
```

- `data/history/trades/espn-2018-2026.json` and `sleeper-2024-2025.json`: the trade exports, as received. ESPN's own log misses trades, so its export also lists trades found from the weekly rosters (players swapped directly between two teams in one week), marked `likely` and shown as "found from rosters". Checked against 2026, where the app knows every trade: 9 of 10 found, every "likely" one real.
- Owners match through `accounts.csv` (ESPN names, Sleeper display names), players by name and position like the drafts.
- Grades are worked out at build time (`src/engine/tradeHistory.ts`) with the Tracker's method: projected points per week above replacement at the trade, moving toward real production as weeks are played (n ÷ (n + 4)), plus next season's real keeper outcome from the draft data (only once that season is over). A week a player didn't play counts as even, as on the Tracker. Each week is replayed with the trade undone for the record, seed and playoff line. No trade-chart values exist for past seasons, so the grade at the trade uses projections only.
- The live season's trades stay on the Tracker page; the 2026 rows in the ESPN export are not used here.

The dry run lists each season's trades, how many were found from rosters, and any player who never shows on his new team (usually a second trade the same week, or injured reserve). `npm run data:check` fails while `trades.json` is out of date.

### All-time players

History → All seasons → **All-time players** ranks every career since 2010 and counts who turns up on the most championship rosters; **Trading** and **Keepers** on the same dropdown total every trade and every kept player per manager. The players page reads `public/seed/careers.json` (about 280 KB), built and never edited by hand:

```bash
npm run data -- careers [--dry-run]
```

- Built from the weekly lineup files (`public/seed/lineups/<year>.json`), so it follows whatever `npm run data -- lineups` produced; no new inputs of its own.
- One row per player per team per season: points as a starter, weeks started, bench points, weeks rostered, and whether he was on that season's championship roster.
- The ranking number is **points scored while in an FWHL starting lineup**, because it is the only number all 16 finished seasons have: ESPN kept starters only for 2010-2017, so bench points and weeks rostered are null before 2018 and the page marks those columns as partial.
- A player counts for a title if he was on the champion's roster at the end of that season: the last week of lineups, or the end-of-season roster the starters-only seasons carry instead. Champions come from `championships.csv` through `history.json`.
- One player is one career across seasons and platforms through the same name-and-position key the drafts use (`playerKey`). Two different players with the same name and position would merge; none in the data today.
- The live season is **not** in the file. The page adds it from the league seed each time it opens, so a weekly results push moves the all-time numbers with no rebuild.

Trading and Keepers need no file of their own: they total `trades.json` (plus this season's trades, graded live) and the keeper picks already in `drafts.json`. `npm run data:check` fails while `careers.json` is out of date with the lineup files.
