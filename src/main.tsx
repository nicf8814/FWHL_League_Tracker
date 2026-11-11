import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { LeagueProvider } from './data/store.tsx';
import { ErrorBoundary } from './ui/components.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary label="The app">
      <LeagueProvider>
        <App />
      </LeagueProvider>
    </ErrorBoundary>
  </StrictMode>,
);

// FEAT-10: installable and usable offline. Production only, so dev never serves stale files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch((e: unknown) => console.warn('Offline support unavailable.', e));
  });
}
