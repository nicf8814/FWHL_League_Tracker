import { lazy, Suspense, useState } from 'react';
import { useDeadline, useLeague } from '../data/store.tsx';
import { freshness } from '../engine/league.ts';
import { ErrorBoundary, Mono, Sheet } from '../ui/components.tsx';
import { PlayerSheetProvider } from '../views/PlayerSheet.tsx';
import { href, useRoute, type Route } from './router.ts';
import { Shortcuts, type Command } from './Palette.tsx';
import { getTheme, nextTheme, setTheme } from '../ui/theme.ts';

const Finder = lazy(() => import('../views/Finder.tsx'));
const Analyzer = lazy(() => import('../views/Analyzer.tsx'));
const Standings = lazy(() => import('../views/Standings.tsx'));
const Players = lazy(() => import('../views/Players.tsx'));
const Teams = lazy(() => import('../views/Teams.tsx'));
const Tracker = lazy(() => import('../views/Tracker.tsx'));
const Method = lazy(() => import('../views/Method.tsx'));
const DataSettings = lazy(() => import('../views/DataSettings.tsx'));
const Keepers = lazy(() => import('../views/Keepers.tsx'));
const Market = lazy(() => import('../views/Market.tsx'));
const Waivers = lazy(() => import('../views/Waivers.tsx'));

const NAV: { route: Route; label: string; short: string }[] = [
  { route: 'finder', label: 'Trade finder', short: 'Find' },
  { route: 'analyzer', label: 'Analyzer', short: 'Trade' },
  { route: 'tracker', label: 'Trade tracker', short: 'Tracker' },
  { route: 'market', label: 'Buy & sell', short: 'Buy/sell' },
  { route: 'waivers', label: 'Waivers', short: 'Waivers' },
  { route: 'keepers', label: 'Keepers', short: 'Keepers' },
  { route: 'standings', label: 'Standings', short: 'Table' },
  { route: 'players', label: 'Players', short: 'Players' },
  { route: 'teams', label: 'Teams', short: 'Teams' },
  { route: 'data', label: 'Data & settings', short: 'Data' },
  { route: 'method', label: 'How it works', short: 'Method' },
];
const SHORT: Record<string, string> = { espn: 'ESPN', peaked: 'Peaked', menton: 'Menton', fantasypros: 'FantasyPros' };
const VIEWS: Record<Route, React.ComponentType> = { finder: Finder, analyzer: Analyzer, tracker: Tracker, standings: Standings, players: Players, teams: Teams, data: DataSettings, method: Method, keepers: Keepers, market: Market, waivers: Waivers, more: More };

const EXTRA: Command[] = [{ id: 'theme', label: 'Switch light / dark', group: 'Actions', run: () => setTheme(nextTheme(getTheme())) }];

// Phones: five pages in the bottom bar, everything else one tap away here.
const BOTTOM: Route[] = ['finder', 'analyzer', 'tracker', 'standings'];
function More() {
  const dl = useDeadline();
  return (
    <ul className="grid max-w-md">
      {navFor(dl.passed).map((n) => <li key={n.route}><a className="rowbtn flex min-h-12 items-center border-b border-rule px-1" href={href(n.route)}>{n.label}</a></li>)}
    </ul>
  );
}

// FEAT-11: after the deadline the finder is retired and the tracker leads.
const navFor = (passed: boolean) => (passed ? NAV.filter((n) => n.route !== 'finder') : NAV);
const MORE = { route: 'more' as Route, label: 'More', short: 'More' };

function FinderRetired() {
  const dl = useDeadline();
  return (
    <div className="grid max-w-prose gap-3">
      <p>The trade deadline passed {dl.date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}, so the finder is retired for the season.</p>
      <ul className="grid gap-2">
        <li><a className="link" href={href('tracker')}>Trade tracker</a>: how every trade this season turned out.</li>
        <li><a className="link" href={href('waivers')}>Waivers</a>: the best pickups for your lineup.</li>
        <li><a className="link" href={href('keepers')}>Keepers</a>: who to keep for 2027.</li>
        <li><a className="link" href={href('analyzer')}>Analyzer</a>: still open for what-ifs.</li>
      </ul>
    </div>
  );
}

export function App() {
  const { route } = useRoute();
  const dl = useDeadline();
  const nav = navFor(dl.passed);
  const retired = dl.passed && route === 'finder';
  const View = retired ? FinderRetired : VIEWS[route];
  const title = retired ? 'Trading is closed' : route === 'more' ? 'More' : NAV.find((n) => n.route === route)!.label;
  return (
    <PlayerSheetProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-surface focus:p-2">Skip to content</a>
      <div className="min-h-dvh lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <Rail route={route} nav={nav} />
        <div className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-rule bg-paper pt-[env(safe-area-inset-top)]">
            <div className="mx-auto flex h-14 max-w-[90rem] items-center gap-3 px-4 md:px-6 lg:px-8">
              <Wordmark className="lg:hidden" home={nav[0]!.route} />
              <h1 className="min-w-0 flex-1 truncate text-lg lg:text-xl">{title}</h1>
              <span className={`num hidden text-xs sm:inline ${dl.days <= 7 && !dl.passed ? 'text-loss' : 'text-ink-3'}`} title={dl.date.toLocaleString()}>{dl.label}</span>
              <a href={href('data')} className="btn btn-quiet md:hidden" aria-label="Data and settings">Data</a>
            </div>
            <nav aria-label="Sections" className="hidden border-t border-rule md:block lg:hidden">
              <ul className="mx-auto flex max-w-[90rem] gap-1 overflow-x-auto px-4 md:px-6">
                {nav.map((n) => <li key={n.route}><NavLink item={n} active={route === n.route} variant="tabs" /></li>)}
              </ul>
            </nav>
          </header>
          <main id="main" className="mx-auto max-w-[90rem] px-4 pb-28 pt-5 md:px-6 md:pb-12 lg:px-8">
            <ErrorBoundary key={route} label={title}>
              <Suspense fallback={<p className="text-sm text-ink-3" role="status">Loading…</p>}>
                <View />
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-30 border-t border-rule-strong bg-paper pb-[env(safe-area-inset-bottom)] md:hidden">
        <ul className="grid auto-cols-fr grid-flow-col">
          {[...nav.filter((n) => BOTTOM.includes(n.route)), ...(dl.passed ? [NAV.find((n) => n.route === 'keepers')!] : []), MORE].map((n) => <li key={n.route}><NavLink item={n} active={route === n.route || (n.route === 'more' && !BOTTOM.includes(route) && route !== 'keepers')} variant="bottom" /></li>)}
        </ul>
      </nav>
      <MyTeamGate />
      <Shortcuts nav={nav} extra={EXTRA} />
    </PlayerSheetProvider>
  );
}

function Wordmark({ className = '', home }: { className?: string; home: Route }) {
  return (
    <a href={href(home)} className={`flex items-center gap-2 ${className}`} aria-label="FWHL home">
      <span className="font-display text-xl font-extrabold leading-none tracking-tight [font-stretch:70%]">FWHL</span>
      <span className="h-3 w-1.5 bg-accent" aria-hidden="true" />
    </a>
  );
}

function NavLink({ item, active, variant }: { item: (typeof NAV)[number]; active: boolean; variant: 'rail' | 'tabs' | 'bottom' }) {
  const common = { href: href(item.route), 'aria-current': active ? ('page' as const) : undefined };
  if (variant === 'bottom')
    return (
      <a {...common} className={`rowbtn relative flex h-14 items-center justify-center text-[13px] font-medium ${active ? 'text-ink' : 'text-ink-3'}`}>
        {active && <span className="absolute inset-x-3 top-0 h-[3px] bg-accent" aria-hidden="true" />}
        {item.short}
      </a>
    );
  if (variant === 'tabs')
    return (
      <a {...common} className={`rowbtn relative flex h-11 items-center whitespace-nowrap px-3 text-sm font-medium ${active ? 'text-ink' : 'text-ink-3'}`}>
        {item.label}
        {active && <span className="absolute inset-x-3 bottom-0 h-[3px] bg-accent" aria-hidden="true" />}
      </a>
    );
  return (
    <a {...common} className={`rowbtn flex h-10 items-center gap-3 rounded px-3 text-sm ${active ? 'bg-sunk font-semibold text-ink' : 'text-ink-2'}`}>
      <span className={`h-4 w-[3px] ${active ? 'bg-accent' : 'bg-transparent'}`} aria-hidden="true" />
      {item.label}
    </a>
  );
}

function Rail({ route, nav }: { route: Route; nav: typeof NAV }) {
  const { idx, settings } = useLeague();
  const fresh = freshness(idx);
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-rule bg-surface lg:flex">
      <div className="flex h-14 items-center border-b border-rule px-5"><Wordmark home={nav[0]!.route} /></div>
      <nav aria-label="Sections" className="grid gap-0.5 p-3">
        {nav.map((n) => <NavLink key={n.route} item={n} active={route === n.route} variant="rail" />)}
      </nav>
      <div className="mt-auto grid gap-3 border-t border-rule p-5 text-xs text-ink-3">
        {settings.myTeamId !== null && (
          <a href={href('teams', `team=${settings.myTeamId}`)} className="link flex items-center gap-2 text-ink-2">
            <Mono team={settings.myTeamId} size="sm" />
            {idx.teams.get(settings.myTeamId)?.name}
          </a>
        )}
        <p>Week {idx.currentWeek} · scores through Week {idx.scoresThrough}</p>
        <ul className="grid gap-1">
          {fresh.filter((f) => f.id !== 'scores').map((f) => (
            <li key={f.id} className={f.stale ? 'text-even' : ''}>{SHORT[f.id] ?? f.id} · {f.asOf}{f.stale ? ' (old)' : ''}</li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

// DATA-2: which team is "mine" is a per-device choice, asked once, changeable in Data & settings.
function MyTeamGate() {
  const { idx, settings, setSettings } = useLeague();
  const [skipped, setSkipped] = useState(false);
  const open = settings.myTeamId === null && !skipped;
  return (
    <Sheet open={open} onClose={() => setSkipped(true)} title="Which team is yours?">
      <p className="mb-4 text-sm text-ink-2">The finder and analyzer start from your roster. This is saved on this device only; change it any time in Data & settings.</p>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {idx.ds.teams.map((t) => (
          <li key={t.id}>
            <button type="button" className="btn w-full justify-start" onClick={() => setSettings({ myTeamId: t.id })}>
              <Mono team={t.id} size="sm" /> {t.name}
            </button>
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-quiet mt-4" onClick={() => setSkipped(true)}>Just looking</button>
    </Sheet>
  );
}
