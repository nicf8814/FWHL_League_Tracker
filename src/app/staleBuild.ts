import { lazy, type ComponentType } from 'react';

// Each deploy replaces the hashed files in assets/. A page that was open before the deploy (or an old
// index.html from the browser cache) still asks for the old file names, and the import fails
// ("Importing a module script failed" in Safari, "Failed to fetch dynamically imported module" in Chrome).
// The fix is to load the new index.html: reload once, and remember the attempt so a real outage
// can't loop. The error boundary shows the error if the reload didn't help.
const KEY = 'fwhl-stale-reload';

export function isChunkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /module script failed|dynamically imported module|error loading dynamically|Unable to preload CSS/i.test(msg);
}

/** Reloads the page for a fresh build, at most once a minute. Returns false if it won't. */
export function reloadForNewBuild(): boolean {
  let last = 0;
  try { last = Number(sessionStorage.getItem(KEY)) || 0; } catch { /* storage blocked */ }
  if (Date.now() - last < 60_000) return false;
  try { sessionStorage.setItem(KEY, String(Date.now())); } catch { /* storage blocked */ }
  location.reload();
  return true;
}

/** React.lazy that reloads the page when the chunk is gone after a deploy. */
export function lazyPage<T extends ComponentType<any>>(load: () => Promise<{ default: T }>) {
  return lazy(() =>
    load().catch((e: unknown) => {
      // Keep the import pending while the page reloads, so the error screen doesn't flash.
      if (isChunkError(e) && reloadForNewBuild()) return new Promise<never>(() => {});
      throw e;
    }),
  );
}

// Vite fires this when it can't preload a chunk's dependencies.
if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', (event) => {
    if (reloadForNewBuild()) event.preventDefault();
  });
}
