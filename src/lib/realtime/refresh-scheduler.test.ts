import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createRefreshScheduler, REFRESH_DEBOUNCE_MS, REFRESH_MAX_WAIT_MS } from "./refresh-scheduler";

function setup() {
  const page = { hidden: false };
  const refresh = vi.fn<() => void>();
  const scheduler = createRefreshScheduler({ refresh, isHidden: () => page.hidden });
  return { page, refresh, scheduler };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createRefreshScheduler", () => {
  it("refreshes once, exactly one debounce after a single change", () => {
    const { refresh, scheduler } = setup();
    scheduler.notify();
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    // The max wait timer of the same burst must not fire a second refresh.
    vi.advanceTimersByTime(REFRESH_MAX_WAIT_MS * 2);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("refreshes once for 50 changes 40 ms apart: the burst ends before the max wait", () => {
    const { refresh, scheduler } = setup();
    // The last change lands at 1960 ms, so the debounce fires at 2710 ms, before the 3000 ms max
    // wait, and the flush cancels that max wait.
    for (let change = 0; change < 50; change += 1) {
      scheduler.notify();
      vi.advanceTimersByTime(40);
    }
    vi.runAllTimers();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("fires at the max wait while changes keep arriving faster than the debounce", () => {
    const { refresh, scheduler } = setup();
    const interval = REFRESH_DEBOUNCE_MS / 3;
    let elapsed = 0;
    while (elapsed < REFRESH_MAX_WAIT_MS - interval) {
      scheduler.notify();
      vi.advanceTimersByTime(interval);
      elapsed += interval;
    }
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(REFRESH_MAX_WAIT_MS - elapsed);
    expect(refresh).toHaveBeenCalledTimes(1);

    // The stream goes on: the next burst gets its own max wait.
    for (let tick = 0; tick < REFRESH_MAX_WAIT_MS / interval; tick += 1) {
      scheduler.notify();
      vi.advanceTimersByTime(interval);
    }
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("starts a new burst after a refresh, so a later lone change refreshes again", () => {
    const { refresh, scheduler } = setup();
    scheduler.notify();
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    scheduler.notify();
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("defers changes that arrive in a hidden tab to one refresh when it becomes visible", () => {
    const { page, refresh, scheduler } = setup();
    page.hidden = true;
    scheduler.notify();
    scheduler.notify();
    scheduler.notify();
    vi.runAllTimers();
    expect(refresh).not.toHaveBeenCalled();

    // Still hidden: a visibility event that does not show the page changes nothing.
    scheduler.visibilityChanged();
    expect(refresh).not.toHaveBeenCalled();

    page.hidden = false;
    scheduler.visibilityChanged();
    expect(refresh).toHaveBeenCalledTimes(1);
    scheduler.visibilityChanged();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("defers a pending refresh when the tab is hidden before the debounce ends", () => {
    const { page, refresh, scheduler } = setup();
    scheduler.notify();
    page.hidden = true;
    vi.advanceTimersByTime(REFRESH_DEBOUNCE_MS);
    expect(refresh).not.toHaveBeenCalled();
    page.hidden = false;
    scheduler.visibilityChanged();
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not refresh on becoming visible when nothing changed while hidden", () => {
    const { refresh, scheduler } = setup();
    scheduler.visibilityChanged();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("cancels a pending refresh on dispose and ignores every later call", () => {
    const { refresh, scheduler } = setup();
    scheduler.notify();
    scheduler.dispose();
    vi.runAllTimers();
    scheduler.notify();
    vi.runAllTimers();
    scheduler.visibilityChanged();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("drops a deferred refresh on dispose", () => {
    const { page, refresh, scheduler } = setup();
    page.hidden = true;
    scheduler.notify();
    scheduler.dispose();
    page.hidden = false;
    scheduler.visibilityChanged();
    expect(refresh).not.toHaveBeenCalled();
  });
});
