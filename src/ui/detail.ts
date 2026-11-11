import { useSyncExternalStore } from 'react';

// Simple / Full (Nov 11, item C): Simple hides the expert numbers so each screen answers its question
// first. Per device, like the theme; Simple is the default.
export type Detail = 'simple' | 'full';
const KEY = 'fwhl.detail';
const EVT = 'fwhl-detail';

const read = (): Detail => {
  try { return localStorage.getItem(KEY) === 'full' ? 'full' : 'simple'; } catch { return 'simple'; }
};
let cur = read();

export function setDetail(d: Detail) {
  cur = d;
  try { localStorage.setItem(KEY, d); } catch { /* this visit only */ }
  window.dispatchEvent(new Event(EVT));
}

const subscribe = (cb: () => void) => { window.addEventListener(EVT, cb); return () => window.removeEventListener(EVT, cb); };
export const useDetail = () => useSyncExternalStore(subscribe, () => cur, () => 'simple' as Detail);
export const useFull = () => useDetail() === 'full';
export const getDetail = () => cur;
