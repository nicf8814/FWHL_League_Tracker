import { lazy, Suspense, useState } from 'react';
import { useDeadline, useLeague } from '../data/store.tsx';
import { freshness } from '../engine/league.ts';
import { ErrorBoundary, Mono, Sheet } from '../ui/components.tsx';
import { PlayerSheetProvider } from '../views/PlayerSheet.tsx';
import { href, useRoute, type Route } from './router.ts';
import { Shortcuts, type Command } from './Palette.tsx';
import { getTheme, nextTheme, setTheme } from '../ui/theme.ts';
import { getDetail, setDetail, useDetail } from '../ui/detail.ts';

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
const Home = lazy(() => import('../views/Home.tsx'));

// Four sections (Nov 11, item B), each a few pages shown as tabs. Phones get the sections in the
// bottom bar; desktops list them in the rail.
type Page = { route: Route; label: string };
type Section = { id: string; label: string; icon: string; pages: Page[] };
const SECTIONS: Section[] = [
  { id: 'team', label: 'My Team', icon: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z', pages: [{ route: 'home', label: 'Home' }, { route: 'waivers', label: 'Waivers' }, { route: 'keepers', label: 'Keepers' }] },
  { id: 'trades', label: 'Trades', icon: 'M7 7h13l-3-3M17 17H4l3 3', pages: [{ route: 'finder', label: 'Finder' }, { route: 'analyzer', label: 'Analyzer' }, { route: 'tracker', label: 'Tracker' }, { route: 'market', label: 'Buy & sell' }] },
  { id: 'league', label: 'League', icon: 'M4 20V10M10 20V4M16 20v-7M22 20H2', pages: [{ route: 'standings', label: 'Standings' }, { route: 'players', label: 'Players' }, { route: 'teams', label: 'Teams' }] },
  { id: 'settings', label: 'Settings', icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1', pages: [{ route: 'data', label: 'Data & settings' }, { route: 'method', label: 'How it works' }] },
];
// FEAT-11: after the deadline the finder is retired.
const sectionsFor = (passed: boolean) => (passed ? SECTIONS.map((x) => ({ ...x, pages: x.pages.filter((p) => p.route !== 'finder') })) : SECTIONS);
const sectionOf = (r: Route) => SECTIONS.find((x) => x.pages.some((p) => p.route === r))!;
export const PAGES = SECTIONS.flatMap((x) => x.pages);
const SHORT: Record<string, string> = { espn: 'ESPN', peaked: 'Peaked', menton: 'Menton', fantasypros: 'FantasyPros' };
const VIEWS: Record<Route, React.ComponentType> = { home: Home, finder: Finder, analyzer: Analyzer, tracker: Tracker, standings: Standings, players: Players, teams: Teams, data: DataSettings, method: Method, keepers: Keepers, market: Market, waivers: Waivers };

const EXTRA: Command[] = [
  { id: 'theme', label: 'Switch light / dark', group: 'Actions', run: () => setTheme(nextTheme(getTheme())) },
  { id: 'detail', label: 'Switch Simple / Full detail', group: 'Actions', run: () => setDetail(getDetail() === 'full' ? 'simple' : 'full') },
];

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
  const sections = sectionsFor(dl.passed);
  const sec = sections.find((x) => x.id === sectionOf(route).id)!;
  const retired = dl.passed && route === 'finder';
  const View = retired ? FinderRetired : VIEWS[route];
  const title = retired ? 'Trading is closed' : PAGES.find((p) => p.route === route)!.label;
  return (
    <PlayerSheetProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:bg-surface focus:p-2">Skip to content</a>
      <div className="min-h-dvh lg:grid lg:grid-cols-[13.5rem_minmax(0,1fr)]">
        <Rail route={route} sections={sections} />
        <div className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-rule bg-paper pt-[env(safe-area-inset-top)]">
            <div className="mx-auto flex h-14 max-w-[90rem] items-center gap-3 px-4 md:px-6 lg:px-8">
              <Wordmark className="lg:hidden" />
              <span className="min-w-0 flex-1 truncate font-display text-lg font-extrabold [font-stretch:85%] lg:text-xl">{sec.label}</span>
              <span className={`num hidden text-xs md:inline ${dl.days <= 7 && !dl.passed ? 'text-loss' : 'text-ink-3'}`}>{dl.label}</span>
              <DetailSwitch />
            </div>
            {sec.pages.length > 1 && (
              <nav aria-label={`${sec.label} pages`} className="border-t border-rule">
                <ul className="mx-auto flex max-w-[90rem] gap-1 overflow-x-auto px-2 md:px-4 lg:px-6">
                  {sec.pages.map((p) => <li key={p.route}><Tab page={p} active={route === p.route} /></li>)}
                </ul>
              </nav>
            )}
          </header>
          <main id="main" className="mx-auto max-w-[90rem] px-4 pb-28 pt-5 md:px-6 lg:px-8 lg:pb-12">
            <h1 className="sr-only">{title}</h1>
            <ErrorBoundary key={route} label={title}>
              <Suspense fallback={<p className="text-sm text-ink-3" role="status">Loading…</p>}>
                <div className="enter" key={route}><View /></div>
              </Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>
      <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-30 border-t border-rule-strong bg-paper pb-[env(safe-area-inset-bottom)] lg:hidden">
        <ul className="grid grid-cols-4">
          {sections.map((x) => (
            <li key={x.id}>
              <a href={href(x.pages[0]!.route)} aria-current={x.id === sec.id ? 'page' : undefined} className={`rowbtn relative flex h-15 flex-col items-center justify-center gap-1 text-[13px] ${x.id === sec.id ? 'font-semibold text-ink' : 'text-ink-3'}`}>
                {x.id === sec.id && <span className="absolute inset-x-4 top-0 h-[3px] bg-accent" aria-hidden="true" />}
                <Icon d={x.icon} />{x.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <MyTeamGate />
      <Shortcuts nav={sections.flatMap((x) => x.pages)} extra={EXTRA} />
    </PlayerSheetProvider>
  );
}

const Icon = ({ d }: { d: string }) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;

function DetailSwitch() {
  const d = useDetail();
  return (
    <div role="group" aria-label="Detail" className="flex border border-rule-strong text-[13px]">
      {(['simple', 'full'] as const).map((v) => (
        <button key={v} type="button" aria-pressed={d === v} onClick={() => setDetail(v)} className={`min-h-9 px-2.5 font-medium sm:px-3 ${d === v ? 'bg-primary text-primary-ink' : 'text-ink-2'}`}>{v === 'simple' ? 'Simple' : 'Full'}</button>
      ))}
    </div>
  );
}

function Tab({ page, active }: { page: Page; active: boolean }) {
  return (
    <a href={href(page.route)} aria-current={active ? 'page' : undefined} className={`rowbtn relative flex h-11 items-center whitespace-nowrap px-3 text-[15px] ${active ? 'font-semibold text-ink' : 'text-ink-3'}`}>
      {page.label}
      {active && <span className="absolute inset-x-3 bottom-0 h-[3px] bg-accent" aria-hidden="true" />}
    </a>
  );
}

function Wordmark({ className = '' }: { className?: string }) {
  return (
    <a href={href('home')} className={`flex items-center gap-2 ${className}`} aria-label="FWHL home">
      <span className="font-display text-xl font-extrabold leading-none tracking-tight [font-stretch:70%]">FWHL</span>
      <span className="h-3 w-1.5 bg-accent" aria-hidden="true" />
    </a>
  );
}

function Rail({ route, sections }: { route: Route; sections: Section[] }) {
  const { idx, settings } = useLeague();
  const fresh = freshness(idx);
  return (
    <aside className="sticky top-0 hidden h-dvh flex-col border-r border-rule bg-surface lg:flex">
      <div className="flex h-14 items-center border-b border-rule px-5"><Wordmark /></div>
      <nav aria-label="Sections" className="grid gap-4 overflow-y-auto p-3">
        {sections.map((x) => (
          <div key={x.id} className="grid gap-0.5">
            <span className="flex items-center gap-2 px-3 pb-1 text-xs font-semibold uppercase tracking-wider text-ink-3"><Icon d={x.icon} />{x.label}</span>
            {x.pages.map((p) => (
              <a key={p.route} href={href(p.route)} aria-current={route === p.route ? 'page' : undefined} className={`rowbtn flex h-9 items-center gap-3 rounded px-3 text-sm ${route === p.route ? 'bg-sunk font-semibold text-ink' : 'text-ink-2'}`}>
                <span className={`h-4 w-[3px] ${route === p.route ? 'bg-accent' : 'bg-transparent'}`} aria-hidden="true" />
                {p.label}
              </a>
            ))}
          </div>
        ))}
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
