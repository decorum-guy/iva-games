import type { Server } from 'node:http';

/** Drain HTTP before closing application databases. A client which leaves a body
 * unfinished must not keep a release waiting forever. Destroying its socket does
 * not cancel an application promise: those are tracked separately and awaited. */
export function createHttpLifecycle(server: Server, graceMs = 5_000) {
  if (!Number.isFinite(graceMs) || graceMs < 1) throw new Error('Invalid HTTP shutdown grace');
  const requests = new Set<Promise<void>>();
  const responses = new Set<Promise<void>>();
  server.on('request', (_request, response) => {
    const closed = new Promise<void>(resolve => { response.once('close', resolve); });
    responses.add(closed);
    void closed.then(() => responses.delete(closed));
  });
  let stopping = false;
  let completion: Promise<void> | undefined;
  return {
    get stopping() { return stopping; },
    run(work: () => Promise<void>): Promise<void> {
      const pending = Promise.resolve().then(work);
      requests.add(pending);
      void pending.then(() => requests.delete(pending), () => requests.delete(pending));
      return pending;
    },
    close(): Promise<void> {
      if (completion) return completion;
      stopping = true;
      // Start closing the listener synchronously, before awaiting workers or WS.
      const closed = new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolve();
        });
      });
      const deadline = setTimeout(() => server.closeAllConnections(), graceMs);
      completion = (async () => {
        try {
          await closed;
          // A disconnected client may still have a committed action in flight.
          // The caller's process-level watchdog reports a failure if it hangs.
          // Node's server.close callback may precede ServerResponse's close
          // event after a forced socket drain. Wait for its resource cleanup as
          // well, rather than racing database closure/process exit against it.
          while (requests.size || responses.size) await Promise.allSettled([...requests, ...responses]);
        } finally { clearTimeout(deadline); }
      })();
      return completion;
    },
  };
}
