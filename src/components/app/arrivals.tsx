"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { formatLondonTime } from "@/lib/format";
import { ARRIVAL_HIGHLIGHT_MS, describeArrivals, type ArrivalReport } from "@/lib/realtime/arrivals";

/**
 * Arriving data, made visible (#171). The provider sits in the workspace layout around the header
 * and the page: LiveRefresh tells it when a batch arrives, the components that show data tell it
 * what changed, and it says so once per batch in one polite live region. The live indicator in
 * the header reads its state.
 */

export type LiveStatus = "connecting" | "live" | "offline";

type LiveState = Readonly<{
  status: LiveStatus;
  /** Batches arrived since the page opened; the indicator pulses once each time it grows. */
  arrivals: number;
  /** Commit time of the newest change Realtime delivered, from the database clock. */
  lastArrivalAt: string | null;
}>;

type ArrivalControls = Readonly<{
  /** A batch of changes arrived and the page is refreshing; `at` is its newest commit time. */
  arrived: (at: string | null) => void;
  setStatus: (status: LiveStatus) => void;
  /**
   * What one component saw change in a render. `id` is unique per component and batch, so the
   * second run of an effect (React Strict Mode) is not counted twice.
   */
  report: (id: string, report: ArrivalReport) => void;
}>;

const INITIAL_LIVE_STATE: LiveState = { status: "connecting", arrivals: 0, lastArrivalAt: null };

const LiveStateContext = createContext<LiveState>(INITIAL_LIVE_STATE);
const ArrivalControlsContext = createContext<ArrivalControls | null>(null);

// Long enough for a screen reader to notice the region emptied, so the same sentence twice in a
// row is still announced twice.
const ANNOUNCEMENT_RESET_MS = 100;

export function ArrivalProvider({ children }: { children: ReactNode }) {
  const [live, setLive] = useState<LiveState>(INITIAL_LIVE_STATE);
  const [announcement, setAnnouncement] = useState("");
  const pending = useRef(new Map<string, ArrivalReport>());
  const timers = useRef({ flush: 0, announce: 0 });

  const controls = useMemo<ArrivalControls>(() => {
    // Every component that changed reports from its effect in the same commit, so the reports of
    // one refresh are all in before a zero-delay timer runs.
    function flush(): void {
      timers.current.flush = 0;
      const text = describeArrivals([...pending.current.values()]);
      pending.current.clear();
      if (text === null) return;
      setAnnouncement("");
      window.clearTimeout(timers.current.announce);
      timers.current.announce = window.setTimeout(() => setAnnouncement(text), ANNOUNCEMENT_RESET_MS);
    }
    return {
      arrived(at) {
        setLive((current) => ({
          ...current,
          arrivals: current.arrivals + 1,
          lastArrivalAt:
            at === null || (current.lastArrivalAt !== null && Date.parse(current.lastArrivalAt) >= Date.parse(at))
              ? current.lastArrivalAt
              : at,
        }));
      },
      setStatus(status) {
        setLive((current) => (current.status === status ? current : { ...current, status }));
      },
      report(id, report) {
        pending.current.set(id, report);
        if (timers.current.flush === 0) timers.current.flush = window.setTimeout(flush, 0);
      },
    };
  }, []);

  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      window.clearTimeout(pendingTimers.flush);
      window.clearTimeout(pendingTimers.announce);
    };
  }, []);

  return (
    <ArrivalControlsContext value={controls}>
      <LiveStateContext value={live}>
        {children}
        {/* In the page from the first render, so a later sentence is a change a screen reader hears. */}
        <p role="status" aria-live="polite" aria-atomic="true" className="sr-only" data-testid="arrival-announcement">
          {announcement}
        </p>
      </LiveStateContext>
    </ArrivalControlsContext>
  );
}

/** For LiveRefresh: null outside the provider, where nothing is marked. */
export function useArrivalControls(): ArrivalControls | null {
  return useContext(ArrivalControlsContext);
}

/**
 * The view a page is showing: its path with the filters and page that decide what it lists. A
 * change in scope is navigation, not arrival, so it resets every comparison instead of animating.
 */
const ScopeContext = createContext<string | null>(null);

export function ArrivalScope({ scope, children }: { scope: string; children: ReactNode }) {
  return <ScopeContext value={scope}>{children}</ScopeContext>;
}

export type RenderDiff<T> = Readonly<{
  /** What the previous render in the same scope showed; null on the first render of a scope. */
  previous: T | null;
  /** Grows by one each time the value changes within a scope. */
  batch: number;
}>;

type DiffState<T> = RenderDiff<T> & Readonly<{ scope: string | null; signature: string; value: T }>;

/**
 * The previous render's value, kept in state as React documents for information from previous
 * renders (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
 * `signature` identifies the value, so a refresh that brings identical data changes nothing.
 * Outside an ArrivalScope there is never a previous value, so nothing animates.
 */
export function useRenderDiff<T>(value: T, signature: string): RenderDiff<T> {
  const scope = useContext(ScopeContext);
  const [state, setState] = useState<DiffState<T>>({ scope, signature, value, previous: null, batch: 0 });
  if (state.scope === scope && state.signature === signature) return state;
  const sameScope = scope !== null && state.scope === scope;
  const next: DiffState<T> = {
    scope,
    signature,
    value,
    previous: sameScope ? state.value : null,
    batch: sameScope ? state.batch + 1 : state.batch,
  };
  setState(next);
  return next;
}

/** True from a change until ARRIVAL_HIGHLIGHT_MS later; a newer change restarts it. */
export function useArrivalHighlight(batch: number, changed: boolean): boolean {
  const [clearedBatch, setClearedBatch] = useState(0);
  useEffect(() => {
    if (!changed) return;
    const timer = window.setTimeout(() => setClearedBatch(batch), ARRIVAL_HIGHLIGHT_MS);
    return () => window.clearTimeout(timer);
  }, [batch, changed]);
  return changed && clearedBatch !== batch;
}

/** Adds this component's change to the batch announcement, once per batch. */
export function useArrivalReport(batch: number, report: ArrivalReport | null): void {
  const controls = useContext(ArrivalControlsContext);
  const id = useId();
  // Primitives, so a new report object with the same content does not report again.
  const events = report?.kind === "events" ? report.count : null;
  const label = report?.kind === "updated" ? report.label : null;
  useEffect(() => {
    if (controls === null) return;
    if (events !== null) controls.report(`${id}:${batch}`, { kind: "events", count: events });
    else if (label !== null) controls.report(`${id}:${batch}`, { kind: "updated", label });
  }, [controls, id, batch, events, label]);
}

/**
 * "Live" in the workspace header. The dot pulses once per arriving batch and is steady between
 * arrivals. Hover or focus shows when data last arrived; Escape hides that until the pointer or
 * focus leaves, and a press keeps it open for touch screens.
 */
export function LiveIndicator() {
  const { status, arrivals, lastArrivalAt } = useContext(LiveStateContext);
  const tooltipId = useId();
  const [pinned, setPinned] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void {
    if (event.key !== "Escape") return;
    setDismissed(true);
    setPinned(false);
  }

  const visibility = dismissed ? "invisible" : pinned ? "visible" : "invisible group-hover:visible group-focus-within:visible";
  return (
    <span className="group relative inline-flex" onMouseLeave={() => setDismissed(false)}>
      <button
        type="button"
        aria-describedby={tooltipId}
        onClick={() => {
          setPinned((current) => !current);
          setDismissed(false);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => {
          setPinned(false);
          setDismissed(false);
        }}
        className="inline-flex min-h-6 min-w-6 items-center gap-1.5 rounded-md px-1.5 font-mono text-xs text-muted transition-colors hover:text-foreground"
      >
        <span aria-hidden="true" className="relative flex size-2">
          {/* Keyed by batch, so each arrival mounts a fresh pulse that runs once. */}
          {arrivals > 0 ? (
            <span key={arrivals} data-testid="live-pulse" className="arrival-live-pulse absolute inset-0 rounded-full bg-success" />
          ) : null}
          {/* Filled when live, hollow otherwise: the shape says it as well as the color. */}
          <span
            className={`relative size-2 rounded-full ${status === "live" ? "bg-success" : "border border-muted"}`}
          />
        </span>
        {status === "offline" ? "Offline" : "Live"}
        <span className="sr-only"> updates</span>
      </button>
      <span
        role="tooltip"
        id={tooltipId}
        className={`absolute right-0 top-full z-50 mt-2 w-max max-w-64 rounded-md border border-line-strong bg-panel-raised px-3 py-2 text-xs leading-5 text-foreground shadow-lg ${visibility}`}
      >
        {status === "offline" ? (
          "Live updates stopped. Reload the page to see new data."
        ) : status === "connecting" ? (
          "Connecting to live updates."
        ) : lastArrivalAt === null ? (
          "Live updates are on. No new data since this page opened."
        ) : (
          <>
            Live updates are on. Data last arrived at{" "}
            <time dateTime={lastArrivalAt}>{formatLondonTime(lastArrivalAt)}</time> London time.
          </>
        )}
      </span>
    </span>
  );
}
