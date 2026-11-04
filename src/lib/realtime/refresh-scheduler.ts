/**
 * When to refresh a workspace page after Realtime reports a change (#129).
 *
 * A sync writes rows in a burst: a snapshot per metric, an event per provider event, then the
 * connection's status. Refreshing per row would re-render the page dozens of times, so changes are
 * coalesced with a trailing debounce, and a maximum wait stops a continuous stream from putting
 * the refresh off forever. A hidden tab does not refresh at all; it refreshes once when it becomes
 * visible again, so a background tab never re-renders for nobody.
 *
 * Pure apart from the timers, so the component owns the browser APIs and the tests use fake timers.
 */

export const REFRESH_DEBOUNCE_MS = 750;
export const REFRESH_MAX_WAIT_MS = 3_000;

export type RefreshSchedulerOptions = {
  refresh: () => void;
  /** Whether the page is hidden right now (`document.visibilityState === "hidden"`). */
  isHidden: () => boolean;
};

export type RefreshScheduler = {
  /** A change arrived. */
  notify: () => void;
  /** Call on every `visibilitychange`; refreshes once if changes arrived while hidden. */
  visibilityChanged: () => void;
  /** Cancels any pending or deferred refresh. Every later call does nothing. */
  dispose: () => void;
};

export function createRefreshScheduler({ refresh, isHidden }: RefreshSchedulerOptions): RefreshScheduler {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  // Started by the first change of a burst and left running while later changes reset the debounce.
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  let deferred = false;
  let disposed = false;

  function clearTimers(): void {
    clearTimeout(debounceTimer);
    clearTimeout(maxWaitTimer);
    debounceTimer = undefined;
    maxWaitTimer = undefined;
  }

  function flush(): void {
    clearTimers();
    // The tab can be hidden between a change and its refresh.
    if (isHidden()) {
      deferred = true;
      return;
    }
    refresh();
  }

  return {
    notify() {
      if (disposed) return;
      if (isHidden()) {
        clearTimers();
        deferred = true;
        return;
      }
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(flush, REFRESH_DEBOUNCE_MS);
      maxWaitTimer ??= setTimeout(flush, REFRESH_MAX_WAIT_MS);
    },
    visibilityChanged() {
      if (disposed || !deferred || isHidden()) return;
      deferred = false;
      refresh();
    },
    dispose() {
      disposed = true;
      deferred = false;
      clearTimers();
    },
  };
}
