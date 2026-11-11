# Updating the league data

The site reads one file: `public/seed/fwhl-2026.json`. Nothing edits it by hand. Every update goes through `scripts/data.ts`, which checks the input, applies it, validates the whole dataset and only then writes. If anything is off it exits with code 1 and writes nothing. A push to `main` then runs `data:check`, the tests and the build before it deploys, so bad data never goes live.

There are no APIs. ESPN, FantasyPros and the trade charts are read by a person or by a scheduled task in a browser, turned into one of the input files below, and committed.

```bash
npm run data -- check                                     # validate and summarize
npm run data -- results     input.json  [--dry-run]       # task 1, after Monday Night Football
npm run data -- projections input.json  [--dry-run]       # task 2, before Thursday Night Football
npm run data -- rosters     input.json  [--dry-run]       # task 3, any time
npm run data -- usage       input.json  [--dry-run]       # task 4, Tuesday
npm run data -- chart peaked|menton <week> chart.csv [--dry-run]
npm run data -- ranks fantasypros.csv [--dry-run]
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
- A name that matches nobody becomes a new player in `results`, `projections`, `rosters` and `transactions`; in `usage`, `ranks` and `chart` rows without a position it is listed in `unmatched` and skipped.
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

### usage (task 4)

```json
{ "asOf": "Week 9", "players": [{ "player": {"name": "Puka Nacua", "pos": "WR"}, "g": 8, "fpg": 19.4, "xpg": 17.1, "td": 5, "xtd": 4.2, "tgt": 88, "att": 2, "rz": 11, "tp": 31.5, "air": 702, "big": 9, "ca": 70, "dr": 3 }] }
```

Replaces the whole usage list. Needs 100+ players.

### chart (weekly trade charts)

A CSV with `name,value` and an optional `pos` column, one row per player, as the chart shows it:

```csv
name,value,pos
Jahmyr Gibbs,68.5,RB
Ja'Marr Chase,64,WR
```

The values are scaled so the chart's top player is 100. Rows with a `pos` that match nobody add a new player; rows without one are listed as unmatched. Needs 50+ matched players. Keep the CSV in `data/charts/<source>-week<N>.csv` and commit it with the data change.

### ranks (FantasyPros rest-of-season, half PPR)

A CSV of `name,pos,rank`, where rank is the positional rank (WR12 is 12).
