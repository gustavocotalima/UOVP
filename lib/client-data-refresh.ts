type RefreshOptions = { pluggyCompleted?: boolean };
type RefreshNotification = { pluggyCompleted: boolean };

/** Coalesces refreshes while local integrations are still writing their final snapshot. */
export function createDataRefreshGate() {
  let deferrals = 0;
  let pending: { refresh: () => void; pluggyCompleted: boolean } | null = null;
  const listeners = new Set<(notification: RefreshNotification) => void>();

  function perform(refresh: () => void, notification: RefreshNotification) {
    refresh();
    for (const listener of listeners) listener(notification);
  }

  return {
    beginDeferral() {
      deferrals += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        deferrals -= 1;
        if (deferrals !== 0 || !pending) return;
        const next = pending;
        pending = null;
        perform(next.refresh, { pluggyCompleted: next.pluggyCompleted });
      };
    },
    request(refresh: () => void, options: RefreshOptions = {}) {
      const pluggyCompleted = options.pluggyCompleted === true;
      if (deferrals > 0) {
        pending = { refresh, pluggyCompleted: pluggyCompleted || pending?.pluggyCompleted === true };
        return;
      }
      perform(refresh, { pluggyCompleted });
    },
    subscribe(listener: (notification: RefreshNotification) => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}

const gate = createDataRefreshGate();
export const beginDataRefreshDeferral = gate.beginDeferral;
export const requestDataRefresh = gate.request;
export const subscribeDataRefresh = gate.subscribe;
