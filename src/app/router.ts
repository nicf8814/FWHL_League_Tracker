import { useCallback, useSyncExternalStore } from 'react';

// Hash routing on the native hashchange event: deep links and the back button work, no router library.
export const ROUTES = ['home', 'finder', 'analyzer', 'tracker', 'standings', 'players', 'teams', 'data', 'method', 'keepers', 'market', 'waivers'] as const;
export type Route = (typeof ROUTES)[number];

const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
};
const read = () => location.hash;

export function parseHash(hash: string): { route: Route; query: URLSearchParams } {
  const [path = '', qs = ''] = hash.replace(/^#\/?/, '').split('?');
  const route = (ROUTES as readonly string[]).includes(path) ? (path as Route) : 'home';
  return { route, query: new URLSearchParams(qs) };
}

export const href = (route: Route, query?: string) => `#/${route}${query ? `?${query}` : ''}`;

export function useRoute() {
  const hash = useSyncExternalStore(subscribe, read, () => '');
  const { route, query } = parseHash(hash);
  const go = useCallback((r: Route, q?: string) => {
    location.hash = href(r, q);
  }, []);
  // Update the query without adding a history entry (typing, toggling players).
  const replace = useCallback((r: Route, q?: string) => {
    history.replaceState(history.state, '', href(r, q));
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  }, []);
  return { route, query, go, replace };
}
