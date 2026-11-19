// The worker side of workerClient.ts: answer each request that carries an id with its result, or with
// the error message if the job threw. Messages without an id (one-way, such as data to keep) get no answer.
export function serve<Req extends object>(handle: (req: Req) => unknown) {
  self.onmessage = (e: MessageEvent<Req & { id?: number }>) => {
    const { id } = e.data;
    try {
      const result = handle(e.data);
      if (id !== undefined) self.postMessage({ id, result });
    } catch (err) {
      if (id !== undefined) self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
    }
  };
}
