import { describe, expect, it } from "vitest";

import { EVENT_RUN_GAP_MS, groupEventRuns } from "./runs";

// 12:00 London summer time on 2026-06-16.
const NOON_MS = Date.UTC(2026, 5, 16, 11, 0);
const MINUTE_MS = 60 * 1000;

type Event = {
  id: string;
  provider: string;
  type_id: string;
  severity: string;
  occurred_at: string;
  external_account_id: string | null;
  connection_id: string | null;
};

const payment = (id: string, at: number, overrides: Partial<Event> = {}): Event => ({
  id,
  provider: "stripe",
  type_id: "stripe.payment_succeeded",
  severity: "success",
  occurred_at: new Date(at).toISOString(),
  external_account_id: "account-a",
  connection_id: "connection-a",
  ...overrides,
});

const ids = (runs: readonly (readonly Event[])[]) => runs.map((run) => run.map(({ id }) => id));

describe("groupEventRuns", () => {
  it("returns no runs for no events", () => {
    expect(groupEventRuns([])).toEqual([]);
  });

  it("keeps one event as a run of one", () => {
    const only = payment("a", NOON_MS);
    expect(groupEventRuns([only])).toEqual([[only]]);
  });

  it("collapses many identical events into one run, newest first", () => {
    const events = [0, 1, 2, 3, 4].map((index) => payment(`e${index}`, NOON_MS - index * 30 * 1000));
    expect(ids(groupEventRuns(events))).toEqual([["e0", "e1", "e2", "e3", "e4"]]);
  });

  it("breaks a run at an event of another type in between", () => {
    const events = [
      payment("a", NOON_MS),
      payment("b", NOON_MS - MINUTE_MS),
      payment("deploy", NOON_MS - 2 * MINUTE_MS, { provider: "vercel", type_id: "vercel.deployment_ready" }),
      payment("c", NOON_MS - 3 * MINUTE_MS),
      payment("d", NOON_MS - 4 * MINUTE_MS),
    ];
    expect(ids(groupEventRuns(events))).toEqual([["a", "b"], ["deploy"], ["c", "d"]]);
  });

  it("breaks a run at the London midnight between two events a minute apart", () => {
    // 23:00 UTC is midnight in London in summer time: 22:59:30 is June 15, 23:00:30 is June 16.
    const afterMidnight = payment("after", Date.UTC(2026, 5, 15, 23, 0, 30));
    const beforeMidnight = payment("before", Date.UTC(2026, 5, 15, 22, 59, 30));
    expect(ids(groupEventRuns([afterMidnight, beforeMidnight]))).toEqual([["after"], ["before"]]);
  });

  it("joins neighbors exactly the gap apart and splits them one millisecond further", () => {
    const atGap = [payment("a", NOON_MS), payment("b", NOON_MS - EVENT_RUN_GAP_MS)];
    expect(ids(groupEventRuns(atGap))).toEqual([["a", "b"]]);
    const pastGap = [payment("a", NOON_MS), payment("b", NOON_MS - EVENT_RUN_GAP_MS - 1)];
    expect(ids(groupEventRuns(pastGap))).toEqual([["a"], ["b"]]);
  });

  it("measures the gap between neighbors, so a steady burst stays one run", () => {
    const events = [0, 1, 2, 3].map((index) => payment(`e${index}`, NOON_MS - index * 4 * MINUTE_MS));
    expect(ids(groupEventRuns(events))).toEqual([["e0", "e1", "e2", "e3"]]);
  });

  it.each([
    ["another account", { external_account_id: "account-b" }],
    ["another severity", { severity: "critical" }],
    ["another provider with the same type id", { provider: "fake" }],
  ])("breaks a run at the same type from %s", (_, overrides) => {
    const events = [payment("a", NOON_MS), payment("b", NOON_MS - MINUTE_MS, overrides)];
    expect(ids(groupEventRuns(events))).toEqual([["a"], ["b"]]);
  });

  it("groups events with no account by their connection", () => {
    const own = { external_account_id: null };
    const events = [
      payment("a", NOON_MS, own),
      payment("b", NOON_MS - MINUTE_MS, own),
      payment("c", NOON_MS - 2 * MINUTE_MS, { ...own, connection_id: "connection-b" }),
    ];
    expect(ids(groupEventRuns(events))).toEqual([["a", "b"], ["c"]]);
  });
});
