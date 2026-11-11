// Theme choice (audit FEAT-8): system, light or dark, per device. Kept out of Settings so changing it
// never rebuilds values. index.html applies it before first paint so there is no flash.
export type Theme = 'system' | 'light' | 'dark';
const KEY = 'fwhl.theme';

export function getTheme(): Theme {
  try {
    const t = localStorage.getItem(KEY);
    return t === 'light' || t === 'dark' ? t : 'system';
  } catch {
    return 'system';
  }
}

export function setTheme(t: Theme) {
  try {
    if (t === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, t);
  } catch {
    // blocked storage: applies for this visit only
  }
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  window.dispatchEvent(new Event('fwhl-theme'));
}

export const nextTheme = (t: Theme): Theme => (t === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark') : t === 'dark' ? 'light' : 'dark');
