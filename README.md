# FWHL League Tracker

Trade analyzer, trade finder, standings and player values for **Favre's Waffle House** (ESPN league 427581, 2026 season). It runs entirely in the browser: no server, no external APIs, no sign-in. League data ships with the app and lives in your browser after that, with export and import so it is never trapped.

This is the production rebuild of the "FWHL Trade Analyzer" artifact. The valuation engine is a straight port (tests prove it reproduces the old numbers exactly); the app around it is new.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine and data-update checks (Node's built-in test runner)
npm run data:check # validate the league data file
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ locally
```

Requires Node 22.18 or newer (the tests run TypeScript directly).

## What's in it

| View | What it does |
| --- | --- |
| Trade finder | Pick a position you need, tag your players Sell / Open / Keep (or in bulk), add players you want. Finds offers the other manager should accept, ranked by points per week your lineup gains; says what each partner needs. Pin or hide offers. Runs in a worker. Retired after the deadline. |
| Analyzer | Two teams, tick what each sends. Verdict on trade value, how each chart and the scoring model read it on their own, each lineup's weekly change (rosters stay the same size), how the partner sees it. Undo/redo, save trades and compare two or three, share as a link or text. |
| Trade tracker | Every trade graded per team (production plus value, keepers on top), record with and without it, and the league ripple. What if: vetoed trades as if they went through, and any trade rewound with its chain. |
| Buy & sell | Where scoring and the charts disagree, plus volume vs production, chart momentum and injury returns. |
| Waivers | Free agents ranked by what they add to your lineup after the cut. |
| Keepers | 2027 keeper calls: auction worth at the player's points rank vs his keeper cost, best set per team, league bargains. |
| Standings | This week for your team, records, PF, PA, max PF, efficiency, playoff odds (10,000 simulated seasons) by record path and the points-for seed, odds trend, weekly results with the Weeks 12-14 top-6 rule. |
| Players | Every valued player with total points; search, sort any column, choose columns, export CSV, chart moves since any week. Each player's sheet has his chart-value trend. |
| Teams | Any roster by position with role, pts/wk and value. |
| Data & settings | Your team, theme, data sources and gaps, injury return weeks, value engine presets, chart import, backup export / import / reset. |
| How it works | The methodology in plain words. |

Ctrl/⌘ K (or /) opens a palette for pages, players, teams and actions; `?` lists the keyboard shortcuts. The app installs to a home screen and works offline.

First visit asks which team is yours. That choice is stored on the device only, so every league mate can use the same site from their own side.

## Architecture

```
UI (src/views, src/app)          React components. Read data only through useLeague().
  │
Store (src/data/store.tsx)       Loads data, holds settings, memoizes engine results.
  │
Engine (src/engine)              Pure TypeScript, no DOM. Tested with Node.
  ├─ league.ts   indexes, current week, standings, freshness
  ├─ model.ts    projections, availability, chart blend, model, keepers, weekly lineup gains
  ├─ trade.ts    trade validation, evaluation, URL encoding
  ├─ finder.ts   trade search and team needs (runs in finder.worker.ts via finderClient.ts)
  ├─ replay.ts   trade tracker and what-ifs: grades, records with and without, the chain of trades
  ├─ keepers.ts  2027 keeper calls
  └─ sim.ts      season simulation (runs in sim.worker.ts via simClient.ts)
  │
Repository (src/data/repository.ts)   loadDataset / saveDataset / resetDataset / settings / saved trades
  └─ local adapter: bundled seed JSON + IndexedDB; settings in localStorage
```

To add a real backend later, write another `Repository` with the same methods (data, settings, saved trades) and pass it to `<LeagueProvider repo={...}>`. Nothing above it changes.

**Performance.** The playoff simulation depends only on the schedule, results and team strength, so it runs in a Web Worker and is cached by exactly those inputs: dragging a value slider never reruns it. The trade finder runs in its own worker too, cached by the full query, so typing and tagging never freeze the page. The tracker opens at once and fills in playoff odds for both worlds a moment later.

## Data

`public/seed/fwhl-2026.json` is the league as of November 10, 2026 (through Week 9), in schema v1 (`src/data/schema.ts`). It is normalized: flat lists keyed by ids, nothing duplicated, and no team is labeled "you".

| List | Key | Holds |
| --- | --- | --- |
| `teams` | id (ESPN team id) | manager name |
| `players` | id (`pl-0001`) | name, position, NFL team, bye, aliases for matching imports |
| `rosters` | teamId + playerId | active or IR slot |
| `games` | week + teams | scores and status |
| `playerWeeks` | playerId + week | team, slot, points, projection, opponent, rostered/started % |
| `playerStats` | playerId | ESPN projections and season production |
| `valuations` | source + week + playerId | Peaked and Menton chart values (0-100 index) |
| `rankings` | source + playerId | empty; held FantasyPros rest-of-season ranks until trade value moved to the charts plus ESPN projections |
| `injuries`, `news`, `keepers`, `transactions` | playerId / id | status and return week, role news, 2027 keeper cost, trades and vetoes |
| `usage` (optional) | playerId | unused; held FantasyPros volume vs production for the dropped Buy & sell volume flags |

`meta.sources` carries an as-of stamp per source; the app shows each one and flags it when it gets old.

**Weekly refresh.** Scheduled tasks read ESPN in a browser, write an input file, and run `npm run data -- <command>`, which validates everything and refuses bad data. Trade charts come from images transcribed to CSV. Each update is a commit to `main`, and the deploy re-checks the data before publishing. Formats and steps: [docs/data-updates.md](docs/data-updates.md). A browser that imported its own file keeps it only until newer data is deployed.

## Deploy

Live at **https://nicf8814.github.io/FWHL_League_Tracker/**. Every push to `main` runs the tests, builds and publishes to GitHub Pages (`.github/workflows/deploy.yml`); a failing test stops the deploy.

`npm run build` produces a static site in `dist/` with relative paths, so it works on GitHub Pages, Netlify or any static host, including a sub-path.

## Deliberate shortcuts

Marked in code with `// shortcut:`.

- `players[].espnId` is empty: the 2026 export did not include ESPN player ids. Fill it on the next ESPN pull and key imports on it.
- The Sandbox's chart-accuracy tilt is left out; it moved nothing on the current data.
- Without Web Worker support the simulation runs on the main thread (~150 ms once).

## Not in this release yet

Trade tracker, What if, Keepers, Buy & sell, Waivers and Chart history from the old artifact. Their data (transactions, vetoes, weekly history, valuations by week) is already in the schema.

## Design

See [DESIGN.md](DESIGN.md) for the tokens, type, layout rules and the hover census. Fonts: Archivo and IBM Plex, both under the SIL Open Font License (`public/fonts/OFL-*.txt`).
