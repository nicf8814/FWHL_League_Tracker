import { useEffect, useState } from 'react';

// Runs an off-thread job (a worker call) and keeps its answer. start() returns null for "nothing to run"
// (value becomes null). When the inputs change, the old answer stays shown until the new one arrives,
// and an answer that comes back after the inputs moved on is dropped. busy: a job is running.
export function useJob<T>(start: () => Promise<T> | null, deps: readonly unknown[]): { value: T | null; busy: boolean } {
  const [state, setState] = useState<{ value: T | null; busy: boolean }>({ value: null, busy: false });
  useEffect(() => {
    const p = start();
    if (!p) { setState({ value: null, busy: false }); return; }
    let live = true;
    setState((s) => ({ value: s.value, busy: true }));
    p.then((value) => { if (live) setState({ value, busy: false }); }, () => { if (live) setState((s) => ({ value: s.value, busy: false })); });
    return () => { live = false; };
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps -- the caller lists start()'s inputs
  return state;
}
