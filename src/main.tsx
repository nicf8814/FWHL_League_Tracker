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
