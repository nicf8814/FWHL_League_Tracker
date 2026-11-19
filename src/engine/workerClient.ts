// One helper for every Web Worker on the site (season sim, trade finder, mock auctions): start the
// worker on first use, match each answer to its request, fail every waiting request if the worker
// crashes (and start a fresh one next time), and run the job inline where there are no workers.
// The worker side is serve() in workerServe.ts.
//
// spawn must call `new Worker(new URL('./x.worker.ts', import.meta.url), { type: 'module' })` itself,
// in the client file: Vite only bundles a worker it can see written out that way.

export interface WorkerClient<Req, Res> {
  // Run req in the worker; inline() runs it on the page instead when workers aren't available.
  call(req: Req, inline: () => Res): Promise<Res>;
  // A one-way message (no answer), such as handing the worker data to keep. False: no worker.
  send(msg: unknown): boolean;
}

export function workerClient<Req extends object, Res>(spawn: () => Worker, label: string, onReset?: () => void): WorkerClient<Req, Res> {
  const pending = new Map<number, { resolve: (v: Res) => void; reject: (e: Error) => void }>();
  let worker: Worker | null = null;
  let seq = 0;

  function get(): Worker | null {
    if (worker) return worker;
    if (typeof Worker === 'undefined') return null;
    try {
      worker = spawn();
    } catch {
      return null;
    }
    worker.onmessage = (e: MessageEvent<{ id: number; result?: Res; error?: string }>) => {
      const p = pending.get(e.data.id);
      if (!p) return;
      pending.delete(e.data.id);
      if (e.data.error !== undefined) p.reject(new Error(e.data.error));
      else p.resolve(e.data.result as Res);
    };
    worker.onerror = (e) => {
      for (const p of pending.values()) p.reject(new Error(e.message || `${label} worker failed`));
      pending.clear();
      worker?.terminate();
      worker = null;
      onReset?.();
    };
    return worker;
  }

  return {
    call(req, inline) {
      const w = get();
      // shortcut: no Worker (very old browsers, test runners) runs the job on the page on the next frame,
      // which blocks while it runs.
      if (!w) return new Promise((resolve, reject) => setTimeout(() => { try { resolve(inline()); } catch (e) { reject(e); } }, 16));
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        w.postMessage({ ...req, id });
      });
    },
    send(msg) {
      const w = get();
      if (!w) return false;
      w.postMessage(msg);
      return true;
    },
  };
}

// Newest-only: while a job is running, keep just the latest request and send it when the job finishes;
// the ones in between are never run. Everyone waiting gets the newest answer. For jobs re-asked on every
// keystroke (the Board's Get %), so the worker never works through a queue of stale requests.
export function newestOnly<A, R>(start: (a: A) => Promise<R>): (a: A) => Promise<R> {
  let busy = false;
  let next: { a: A; waiting: ((p: Promise<R>) => void)[] } | null = null;
  const go = (a: A): Promise<R> => {
    busy = true;
    const p = start(a);
    const done = () => {
      busy = false;
      if (!next) return;
      const n = next;
      next = null;
      const q = go(n.a);
      for (const w of n.waiting) w(q);
    };
    p.then(done, done);
    return p;
  };
  return (a) => {
    if (!busy) return go(a);
    return new Promise<R>((resolve, reject) => {
      if (next) next.a = a; else next = { a, waiting: [] };
      next.waiting.push((q) => q.then(resolve, reject));
    });
  };
}
