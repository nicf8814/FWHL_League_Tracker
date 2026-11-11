# FWHL League Tracker

Trade analyzer, trade finder, standings and player values for **Favre's Waffle House** (ESPN league 427581, 2026 season). It runs entirely in the browser: no server, no external APIs, no sign-in. League data ships with the app and lives in your browser after that, with export and import so it is never trapped.

This is the production rebuild of the "FWHL Trade Analyzer" artifact. The valuation engine is a straight port (tests prove it reproduces the old numbers exactly); the app around it is new.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # engine checks (Node's built-in test runner)
npm run build      # type-check + production build into dist/
npm run preview    # serve dist/ locally
```

Requires Node 22.18 or newer (the tests run TypeScript directly).

## What's in it

| View | What it does |
| --- | --- |
| Trade finder | Pick a position you need, tag your players Sell / Open / Keep, add players you want. Finds offers the other manager should accept, ranked by points per week your lineup gains. |
| Analyzer | Two teams, tick what each sends. Verdict on trade value, each lineup's weekly change, how the partner sees it by his own values, and this week's lineup before and after. The trade lives in the URL, so a trade is a link. |
| Standings | Record, PF, PA, max PF, lineup efficiency, playoff odds (10,000 simulated seasons) split into the record path and the points-for 6th seed, odds trend by week, weekly results including the Weeks 12-14 top-6 rule. |
| Players | Every valued player: trade value, market vs model, pts/wk, above replacement, each chart, keeper cost. |
| Teams | Any roster by position with role, pts/wk and value. |
| Data & settings | Your team, data freshness per source, value engine weights, backup export / import / reset. |

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
  ├─ finder.ts   trade search
  └─ sim.ts      season simulation (runs in sim.worker.ts via simClient.ts)
  │
Repository (src/data/repository.ts)   loadDataset / saveDataset / resetDataset / settings
  └─ local adapter: bundled seed JSON + IndexedDB; settings in localStorage
```

To add a real backend later, write another `Repository` with the same four methods and pass it to `<LeagueProvider repo={...}>`. Nothing above it changes.

**Performance.** The playoff simulation depends only on the schedule, results and team strength, so it runs in a Web Worker and is cached by exactly those inputs: dragging a value slider never reruns it. Finder results are cached by the full query, so opening a team or showing more offers is instant.

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
| `rankings` | source + playerId | FantasyPros rest-of-season positional rank |
| `injuries`, `news`, `keepers`, `transactions` | playerId / id | status and return week, role news, 2027 keeper cost, trades and vetoes |

`meta.sources` carries an as-of stamp per source; the app shows each one and flags it when it gets old.

**Weekly refresh.** Produce a new dataset JSON in this schema (the weekly refresh tasks can write it), then either import it in Data & settings or commit it over `public/seed/fwhl-2026.json` and redeploy. Imports are validated first (shape and every cross-reference); if anything is wrong nothing changes and you get the list of problems.

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
