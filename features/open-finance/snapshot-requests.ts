/** Deduplicates detail requests and prevents an older snapshot from populating a new cache. */
export function createSnapshotRequests(initialRevision: string) {
  let revision = initialRevision;
  const requests = new Map<string, AbortController>();

  function clear() {
    for (const controller of requests.values()) controller.abort();
    requests.clear();
  }

  return {
    reset(nextRevision: string) {
      if (revision === nextRevision) return false;
      clear();
      revision = nextRevision;
      return true;
    },
    start(key: string, requestRevision: string) {
      if (requestRevision !== revision || requests.has(key)) return null;
      const controller = new AbortController();
      requests.set(key, controller);
      return controller;
    },
    isCurrent(key: string, controller: AbortController) {
      return !controller.signal.aborted && requests.get(key) === controller;
    },
    finish(key: string, controller: AbortController) {
      if (requests.get(key) !== controller) return false;
      requests.delete(key);
      return true;
    },
    clear,
  };
}
