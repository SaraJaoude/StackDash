/**
 * When to refresh a workspace page after Realtime reports a change (#129).
 *
 * A sync writes rows in a burst: a snapshot per metric, an event per provider event, then the
 * connection's status. Refreshing per row would re-render the page dozens of times, so changes are
 * coalesced with a trailing debounce, and a maximum wait stops a continuous stream from putting
 * the refresh off forever. A hidden tab does not refresh at all; it refreshes once when it becomes
 * visible again, so a background tab never re-renders for nobody.
 *
 * The maximum wait bounds latency, not load: every refresh renders the whole workspace route on
 * the server again, and nothing in the router stops a second one starting before the first has
 * landed (#309). So only one refresh runs at a time. Changes flushed while it runs queue a single
 * trailing refresh, started when the running one settles; however fast changes arrive, at most one
 * refresh is running and one is waiting. A refresh that never settles stops counting as running
 * after `REFRESH_MAX_IN_FLIGHT_MS`, so a stalled request delays live updates but cannot stop them.
 *
 * Pure apart from the timers, so the component owns the browser APIs and the tests use fake timers.
 */

export const REFRESH_DEBOUNCE_MS = 750;
export const REFRESH_MAX_WAIT_MS = 3_000;
// How long a refresh may stay in flight before the scheduler stops waiting for it. `settled()`
// arrives once the refreshed payload is on screen, which takes well under a second on the local
// server (#309) and 4 s in the slow-server measurement there; e2e/fixtures/realtime.ts allows
// 15 s for delivery, the debounce, and one render together. A refresh still open after that has
// stalled (a held connection, a function hanging to its platform limit), and waiting longer would
// leave every later change queued with nothing shown. Expiring early costs one overlapping render,
// which is what every refresh did before #309.
export const REFRESH_MAX_IN_FLIGHT_MS = 15_000;

export type RefreshSchedulerOptions = {
  /** Starts a refresh. The caller reports its end with `settled()`. */
  refresh: () => void;
  /** Whether the page is hidden right now (`document.visibilityState === "hidden"`). */
  isHidden: () => boolean;
};

export type RefreshScheduler = {
  /** A change arrived. */
  notify: () => void;
  /**
   * Call on every `visibilitychange`; requests one refresh if changes arrived while hidden, queued
   * behind a running one.
   */
  visibilityChanged: () => void;
  /**
   * No refresh this scheduler started is still running: call it when every one has landed, the
   * way `useTransition`'s `isPending` turns false only once all of them have. It starts the refresh
   * queued behind them, if any. A refresh not settled within `REFRESH_MAX_IN_FLIGHT_MS` is treated
   * as settled, and may start a successor; a late `settled()` for the expired one is safe only
   * under this contract, because it cannot arrive before the successor has landed too. A caller
   * that reported each refresh separately would end the successor early and drop its limit.
   */
  settled: () => void;
  /** Cancels any pending, queued, or deferred refresh. Every later call does nothing. */
  dispose: () => void;
};

export function createRefreshScheduler({ refresh, isHidden }: RefreshSchedulerOptions): RefreshScheduler {
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;
  // Started by the first change of a burst and left running while later changes reset the debounce.
  let maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  let deferred = false;
  let inFlight = false;
  // Ends a refresh that never reports settling, so a stalled request cannot hold the queue.
  let inFlightTimer: ReturnType<typeof setTimeout> | undefined;
  // Changes flushed while a refresh runs, to refresh once more when it settles.
  let queued = false;
  let disposed = false;

  function clearTimers(): void {
    clearTimeout(debounceTimer);
    clearTimeout(maxWaitTimer);
    debounceTimer = undefined;
    maxWaitTimer = undefined;
  }

  function request(): void {
    // The tab can be hidden between a change and its refresh.
    if (isHidden()) {
      deferred = true;
      return;
    }
    if (inFlight) {
      queued = true;
      return;
    }
    inFlight = true;
    inFlightTimer = setTimeout(settle, REFRESH_MAX_IN_FLIGHT_MS);
    refresh();
  }

  function settle(): void {
    clearTimeout(inFlightTimer);
    inFlightTimer = undefined;
    inFlight = false;
    if (!queued) return;
    queued = false;
    request();
  }

  function flush(): void {
    clearTimers();
    request();
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
      request();
    },
    settled() {
      if (disposed) return;
      settle();
    },
    dispose() {
      disposed = true;
      deferred = false;
      queued = false;
      clearTimers();
      clearTimeout(inFlightTimer);
    },
  };
}
