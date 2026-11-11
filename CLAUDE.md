# FWHL League Tracker

Static React + TypeScript app for the Favre's Waffle House fantasy league (ESPN league 427581). No server and no APIs: the site reads `public/seed/fwhl-2026.json`. Pushing to `main` tests, builds and deploys to https://nicf8814.github.io/FWHL_League_Tracker/.

## Rules

- Never edit `public/seed/fwhl-2026.json` by hand. Use `npm run data -- <command>` (docs/data-updates.md). Never change the format of the file.
- `test/fixtures/fwhl-2026-11-10.json` is a frozen copy for the tests. Never update it with new data.
- Before any push: `npm run data:check && npm test && npm run build`.
- Data pushes go straight to `main` and change only data files. Code changes go on a branch with a pull request unless Nic says otherwise.
- Mark deliberate shortcuts in code with `// shortcut: <reason, when to revisit>`.
- Nothing in this repo (site, scripts, workflows) may call ESPN, FantasyPros or any other outside API. Only Claude, in Nic's Chrome, reads them (docs/gathering.md), and the result reaches the repo as an input file.

## Publishing an uploaded file

Nic gathers data with scheduled tasks that follow docs/gathering.md and send him a JSON file. When he hands one back, publish it as described in docs/data-updates.md, "Publishing a change". The file name says which command to run:

| File | Command | Commit message |
|---|---|---|
| `results-week<L>.json` | `results` | `Data: Week <L> results` |
| `backfill-week<L>.json` | `results` | `Data: backfill Week <L> with free agents` (one commit for several weeks: `Data: backfill Weeks <a>-<b> with free agents`) |
| `projections-week<C>.json` | `projections` | `Data: Week <C> projections` |
| `rosters-<date>.json` | `rosters` | `Data: rosters and injuries <YYYY-MM-DD>` |
| `usage-week<N>.json` | `usage` | `Data: FantasyPros usage Week <N>` |

1. Copy the file to `/tmp/fwhl/`, then run the command with `--dry-run`. Stop and tell Nic if it errors, if `created` lists more than 10 players (40 for a backfill week), or if `unmatched` isn't empty for `usage` (list the names).
2. Run it without `--dry-run`, run the checks above, commit only the data file, rebase on `origin/main` and push to `main`.
3. Check the newest Deploy run on `main` succeeds (up to 5 minutes). If it sits queued, start Deploy by hand (`workflow_dispatch` on `main`).
4. Give Nic the commit link, the `changes` line, players added, ESPN ids filled in, and whether the deploy succeeded. For a backfill, check `npm run data:check` still shows scores through the latest week, not Week 6.

## Weekly trade charts

Nic sends the Peaked in High Skool and Kyle Menton trade charts as images, usually on Wednesday. For each chart:

1. Read every player and value from the image into `data/charts/<peaked|menton>-week<N>.csv` with columns `name,value,pos`, in the chart's order. Use the position the chart groups him under.
2. Check the transcription: the row count matches the chart, and the top 5 and five random rows match the image exactly. Fix before going on.
3. `npm run data -- chart <peaked|menton> <N> data/charts/<file>.csv --dry-run`. For each name in `unmatched`, fix the spelling to the player's usual name, or keep the position so he is added. Look over `created` too.
4. Run it without `--dry-run`, run the checks above, commit the CSV and the data file as `Data: <Peaked|Menton> Week <N> chart`, and push to `main` (docs/data-updates.md, Publishing a change).
5. Tell Nic in a few lines: players loaded, any names added or skipped, and the biggest risers and fallers from the previous week of that chart.

Ask Nic which week a chart is for if the image doesn't say.
