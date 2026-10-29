export type PluggySyncStatus = { active: boolean; automatic: boolean };

const SYNC_ACTIVE_POLL_MS = 2_000;
const SYNC_IDLE_POLL_MS = 30_000;
const SYNC_MAX_RETRY_MS = 60_000;

type Options = {
  fetchStatus: (signal: AbortSignal) => Promise<PluggySyncStatus>;
  isVisible: () => boolean;
  onStatus: (status: PluggySyncStatus) => void;
  onComplete: () => void;
};

/** A single sequential request loop, including visibility recovery and local sync starts. */
export function createSyncStatusPoller(options: Options) {
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  let generation = 0;
  let checkPending = false;
  let localOperations = 0;
  let failures = 0;
  let observedActive = false;
  let status: PluggySyncStatus = { active: false, automatic: false };

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function schedule() {
    clearTimer();
    if (!running || !options.isVisible() || inFlight) return;
    const base = status.active || localOperations > 0 ? SYNC_ACTIVE_POLL_MS : SYNC_IDLE_POLL_MS;
    const delay = Math.min(SYNC_MAX_RETRY_MS, base * 2 ** Math.max(0, failures - 1));
    timer = setTimeout(() => {
      timer = null;
      void check();
    }, delay);
  }

  async function check() {
    clearTimer();
    if (!running || !options.isVisible()) return;
    if (inFlight) {
      checkPending = true;
      return;
    }
    checkPending = false;
    const controller = new AbortController();
    const requestGeneration = generation;
    inFlight = controller;
    try {
      const next = await options.fetchStatus(controller.signal);
      if (!running || controller.signal.aborted || requestGeneration !== generation) return;
      failures = 0;
      const completed = observedActive && !next.active;
      observedActive = next.active;
      status = next;
      options.onStatus(next);
      if (completed) options.onComplete();
    } catch {
      // Preserve the last known status on failures; aborted requests are not failures.
      if (running && !controller.signal.aborted && requestGeneration === generation) failures += 1;
    } finally {
      if (inFlight === controller) inFlight = null;
      if (checkPending && running && options.isVisible()) void check();
      else schedule();
    }
  }

  function checkNow() {
    clearTimer();
    void check();
  }

  return {
    start() {
      if (running) return;
      running = true;
      checkNow();
    },
    stop() {
      running = false;
      checkPending = false;
      generation += 1;
      clearTimer();
      inFlight?.abort();
    },
    visibilityChanged() {
      clearTimer();
      if (options.isVisible()) {
        checkNow();
      } else {
        checkPending = false;
        generation += 1;
        inFlight?.abort();
      }
    },
    beginLocalOperation() {
      localOperations += 1;
      checkNow();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        localOperations -= 1;
        schedule();
      };
    },
    acknowledgeRefresh() {
      // A deferred refresh may describe an earlier operation. Preserve any currently
      // observed active episode so its eventual completion still refreshes the page.
      failures = 0;
      generation += 1;
      inFlight?.abort();
      checkNow();
    },
  };
}
