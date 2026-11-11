# FWHL League Tracker

Static React + TypeScript app for the Favre's Waffle House fantasy league (ESPN league 427581). No server and no APIs: the site reads `public/seed/fwhl-2026.json`. Pushing to `main` tests, builds and deploys to https://nicf8814.github.io/FWHL_League_Tracker/.

## Rules

- Never edit `public/seed/fwhl-2026.json` by hand. Use `npm run data -- <command>` (docs/data-updates.md). Never change the format of the file.
- `test/fixtures/fwhl-2026-11-10.json` is a frozen copy for the tests. Never update it with new data.
- Before any push: `npm run data:check && npm test && npm run build`.
- Data pushes go straight to `main` and change only data files. Code changes go on a branch with a pull request unless Nic says otherwise.
- Mark deliberate shortcuts in code with `// shortcut: <reason, when to revisit>`.

## Weekly trade charts

Nic sends the Peaked in High Skool and Kyle Menton trade charts as images, usually on Wednesday. For each chart:

1. Read every player and value from the image into `data/charts/<peaked|menton>-week<N>.csv` with columns `name,value,pos`, in the chart's order. Use the position the chart groups him under.
2. Check the transcription: the row count matches the chart, and the top 5 and five random rows match the image exactly. Fix before going on.
3. `npm run data -- chart <peaked|menton> <N> data/charts/<file>.csv --dry-run`. For each name in `unmatched`, fix the spelling to the player's usual name, or keep the position so he is added. Look over `created` too.
4. Run it without `--dry-run`, run the checks above, commit the CSV and the data file as `Data: <Peaked|Menton> Week <N> chart`, and push to `main` (docs/data-updates.md, Publishing a change).
5. Tell Nic in a few lines: players loaded, any names added or skipped, and the biggest risers and fallers from the previous week of that chart.

Ask Nic which week a chart is for if the image doesn't say.
