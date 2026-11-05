import { describe, expect, it } from "vitest";

import type { PublicMetricId } from "./definitions";
import {
  computePublicMetrics,
  historyStart,
  STALE_AFTER_MS,
  STREAK_EVENT_LIMIT,
  type MetricValue,
  type SnapshotPoint,
  type SourceAccount,
} from "./engine";
import { MemoryMetricStore, type MemoryAccount, type MemoryEvent } from "./memory-store";

const AS_OF = new Date("2026-11-05T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function account(overrides: Partial<SourceAccount> = {}): SourceAccount {
  return {
    accountId: "acct-1",
    provider: "github",
    connectionCreatedAt: new Date(AS_OF.getTime() - 60 * DAY_MS),
    lastSyncedAt: new Date(AS_OF.getTime() - 10 * 60_000),
    simulated: false,
    ...overrides,
  };
}

function point(overrides: Partial<SnapshotPoint> & Pick<SnapshotPoint, "value">): SnapshotPoint {
  const retrievedAt = overrides.retrievedAt ?? new Date(AS_OF.getTime() - 10 * 60_000);
  return {
    accountId: "acct-1",
    metricKey: "github.stars.total",
    snapshotDate: retrievedAt.toISOString().slice(0, 10),
    periodStart: null,
    periodEnd: null,
    resetsAt: null,
    retrievedAt,
    ...overrides,
  };
}

/** The end-of-day reading `daysAgo` UTC days before AS_OF. */
function dayPoint(daysAgo: number, value: number, overrides: Partial<SnapshotPoint> = {}): SnapshotPoint {
  const day = new Date(Date.parse(`${AS_OF.toISOString().slice(0, 10)}T23:00:00Z`) - daysAgo * DAY_MS);
  return point({ value, retrievedAt: day, snapshotDate: day.toISOString().slice(0, 10), ...overrides });
}

function event(typeId: string, at: Date, accountId = "acct-1"): MemoryEvent {
  return { typeId, occurredAt: at, accountId };
}

async function compute(
  metricId: PublicMetricId,
  data: { accounts?: MemoryAccount[]; points?: SnapshotPoint[]; events?: MemoryEvent[] },
  asOf: Date = AS_OF,
): Promise<MetricValue> {
  const store = new MemoryMetricStore(data.accounts ?? [account()], data.points ?? [], data.events ?? []);
  const [result] = await computePublicMetrics(store, [{ metricId, asOf }]);
  if (result === undefined) throw new Error("no result");
  return result.result;
}

const valueOf = (result: MetricValue) => (result.status === "available" ? result.value : result.reason);

describe("computePublicMetrics: shared rules", () => {
  it("answers not connected when the project has no account of the metric's provider", async () => {
    expect(await compute("github-stars", { accounts: [account({ provider: "vercel" })] })).toEqual({
      status: "unavailable",
      reason: "not_connected",
    });
  });

  it("leaves out a disconnected (revoked) connection's accounts and keeps the rest", async () => {
    const result = await compute("github-stars", {
      accounts: [account(), account({ accountId: "acct-2" }), { ...account({ accountId: "acct-3" }), connectionStatus: "revoked" }],
      points: [point({ value: 5 }), point({ accountId: "acct-2", value: 7 }), point({ accountId: "acct-3", value: 100 })],
    });
    expect(valueOf(result)).toBe(12);
  });

  it("answers not connected when the only connection is revoked, and keeps one that needs attention", async () => {
    const points = [point({ value: 5 })];
    expect(await compute("github-stars", { accounts: [{ ...account(), connectionStatus: "revoked" }], points })).toEqual({
      status: "unavailable",
      reason: "not_connected",
    });
    expect(valueOf(await compute("github-stars", { accounts: [{ ...account(), connectionStatus: "needs_attention" }], points }))).toBe(5);
  });

  it("returns results in request order and nothing for no requests", async () => {
    const store = new MemoryMetricStore([account()], [point({ value: 5 })], []);
    expect(await computePublicMetrics(store, [])).toEqual([]);
    const results = await computePublicMetrics(store, [
      { metricId: "vercel-deployments-7d", asOf: AS_OF },
      { metricId: "github-stars", asOf: AS_OF },
    ]);
    expect(results.map((result) => [result.metricId, valueOf(result.result)])).toEqual([
      ["vercel-deployments-7d", "not_connected"],
      ["github-stars", 5],
    ]);
  });

  it("marks a value simulated when any account behind it is simulated", async () => {
    const result = await compute("github-stars", {
      accounts: [account(), account({ accountId: "acct-2", simulated: true })],
      points: [point({ value: 5 }), point({ accountId: "acct-2", value: 7 })],
    });
    expect(result).toMatchObject({ status: "available", value: 12, simulated: true });
  });
});

describe("computePublicMetrics: current snapshot totals (github-stars, resend-emails-month, actions minutes)", () => {
  it("adds up each account's newest reading and reports the oldest retrieval as last synced", async () => {
    const older = new Date(AS_OF.getTime() - 3 * HOUR_MS);
    const result = await compute("github-stars", {
      accounts: [account(), account({ accountId: "acct-2" })],
      points: [
        point({ value: 100, retrievedAt: new Date(AS_OF.getTime() - 26 * HOUR_MS) }),
        point({ value: 120 }),
        point({ accountId: "acct-2", value: 30, retrievedAt: older }),
      ],
    });
    expect(result).toEqual({ status: "available", value: 150, lowerBound: false, lastSyncedAt: older, simulated: false });
  });

  it("is no data before the first snapshot", async () => {
    expect(valueOf(await compute("github-stars", {}))).toBe("no_data");
  });

  it.each([
    ["exactly 48 hours old is still fresh", 0, 9],
    ["one millisecond past 48 hours is stale", 1, "stale"],
  ])("%s", async (_title, extraMs, expected) => {
    const retrievedAt = new Date(AS_OF.getTime() - STALE_AFTER_MS - extraMs);
    expect(valueOf(await compute("github-stars", { points: [point({ value: 9, retrievedAt })] }))).toBe(expected);
  });

  it("is stale when the newest reading and the last sync are three days old, older than the rows read", async () => {
    const threeDaysAgo = new Date(AS_OF.getTime() - 3 * DAY_MS);
    const result = await compute("github-stars", {
      accounts: [account({ lastSyncedAt: threeDaysAgo })],
      points: [point({ value: 9, retrievedAt: threeDaysAgo })],
    });
    expect(valueOf(result)).toBe("stale");
  });

  it("is no data when a fresh sync stored no recent reading (the provider stopped reporting it)", async () => {
    const threeDaysAgo = new Date(AS_OF.getTime() - 3 * DAY_MS);
    expect(valueOf(await compute("github-stars", { points: [point({ value: 9, retrievedAt: threeDaysAgo })] }))).toBe("no_data");
  });

  it("is stale when no account has a reading and one of them has not synced for two days", async () => {
    const old = account({ accountId: "acct-2", lastSyncedAt: new Date(AS_OF.getTime() - STALE_AFTER_MS - 1) });
    expect(valueOf(await compute("github-stars", { accounts: [account(), old] }))).toBe("stale");
  });

  it("ignores readings retrieved after asOf, so a delayed value never sees later data", async () => {
    const asOf = new Date(AS_OF.getTime() - 7 * DAY_MS);
    const result = await compute(
      "github-stars",
      { points: [point({ value: 50, retrievedAt: new Date(asOf.getTime() - HOUR_MS) }), point({ value: 90 })] },
      asOf,
    );
    expect(valueOf(result)).toBe(50);
  });

  it("drops a reading whose billing period has ended (no data until the next sync)", async () => {
    const minutes = "github.usage.actions.minutes";
    const period = { periodStart: new Date("2026-11-01T00:00:00Z"), periodEnd: new Date("2026-12-01T00:00:00Z") };
    expect(valueOf(await compute("github-actions-minutes-month", { points: [point({ metricKey: minutes, value: 420, ...period })] }))).toBe(420);
    const lastMonth = { periodStart: new Date("2026-10-01T00:00:00Z"), periodEnd: new Date("2026-11-01T00:00:00Z") };
    const atMonthStart = new Date("2026-11-01T00:30:00Z");
    expect(
      valueOf(
        await compute(
          "github-actions-minutes-month",
          { points: [point({ metricKey: minutes, value: 9000, retrievedAt: new Date("2026-10-31T23:50:00Z"), ...lastMonth })] },
          atMonthStart,
        ),
      ),
    ).toBe("no_data");
  });

  it("drops a quota reading once its reset time has passed", async () => {
    const used = "resend.emails.monthly.used";
    const resetsAt = new Date("2026-11-05T12:00:00Z");
    expect(valueOf(await compute("resend-emails-month", { accounts: [account({ provider: "resend" })], points: [point({ metricKey: used, value: 10, resetsAt })] }))).toBe(
      "no_data",
    );
    const later = new Date(resetsAt.getTime() + 1);
    expect(
      valueOf(await compute("resend-emails-month", { accounts: [account({ provider: "resend" })], points: [point({ metricKey: used, value: 10, resetsAt: later })] })),
    ).toBe(10);
  });
});

describe("computePublicMetrics: snapshot change (stars gained)", () => {
  it("subtracts the reading at the end of the day the window starts on", async () => {
    const points = [dayPoint(8, 80), dayPoint(7, 100), dayPoint(3, 140), point({ value: 175 })];
    expect(valueOf(await compute("github-stars-gained-7d", { points }))).toBe(75);
  });

  it("falls back to the next day when the start day is missing, never to an earlier day", async () => {
    expect(valueOf(await compute("github-stars-gained-7d", { points: [dayPoint(6, 110), point({ value: 175 })] }))).toBe(65);
    expect(valueOf(await compute("github-stars-gained-7d", { points: [dayPoint(8, 80), point({ value: 175 })] }))).toBe(
      "not_enough_history",
    );
  });

  it("never goes below zero when stars were removed", async () => {
    expect(valueOf(await compute("github-stars-gained-30d", { points: [dayPoint(30, 200), point({ value: 190 })] }))).toBe(0);
  });

  it("adds up only accounts with a baseline, so a new account understates rather than overstates", async () => {
    const result = await compute("github-stars-gained-7d", {
      accounts: [account(), account({ accountId: "acct-new" })],
      points: [dayPoint(7, 100), point({ value: 110 }), point({ accountId: "acct-new", value: 5000 })],
    });
    expect(valueOf(result)).toBe(10);
  });

  it("is stale, not short of history, when the last sync is older than the whole window", async () => {
    const result = await compute("github-stars-gained-7d", {
      accounts: [account({ lastSyncedAt: new Date(AS_OF.getTime() - 9 * DAY_MS) })],
      points: [dayPoint(10, 80), dayPoint(9, 90)],
    });
    expect(valueOf(result)).toBe("stale");
  });
});

describe("computePublicMetrics: quota percent", () => {
  const resend = account({ provider: "resend" });
  const used = (value: number, accountId = "acct-1") => point({ accountId, metricKey: "resend.emails.monthly.used", value });
  const limit = (value: number, accountId = "acct-1") => point({ accountId, metricKey: "resend.emails.monthly.limit", value });

  it("divides summed usage by summed limits and rounds down to a whole percent", async () => {
    expect(valueOf(await compute("resend-quota-percent-month", { accounts: [resend], points: [used(2999), limit(3000)] }))).toBe(99);
    expect(valueOf(await compute("resend-quota-percent-month", { accounts: [resend], points: [used(3300), limit(3000)] }))).toBe(110);
  });

  it("leaves out an account with no limit or a zero limit, and is no data when none has one", async () => {
    const both = [resend, account({ provider: "resend", accountId: "acct-2" })];
    expect(
      valueOf(await compute("resend-quota-percent-month", { accounts: both, points: [used(1500), limit(3000), used(99, "acct-2"), limit(0, "acct-2")] })),
    ).toBe(50);
    expect(valueOf(await compute("resend-quota-percent-month", { accounts: [resend], points: [used(10)] }))).toBe("no_data");
  });
});

describe("computePublicMetrics: event counts (deployments, signups, customers, payments)", () => {
  const vercel = account({ provider: "vercel" });
  const succeeded = (at: Date, accountId?: string) => event("vercel.deployment.succeeded", at, accountId);

  it("counts events with from <= occurred_at < asOf", async () => {
    const from = new Date(AS_OF.getTime() - 7 * DAY_MS);
    const events = [
      succeeded(new Date(from.getTime() - 1)),
      succeeded(from),
      succeeded(new Date(AS_OF.getTime() - 1)),
      succeeded(AS_OF),
      event("vercel.deployment.failed", new Date(AS_OF.getTime() - HOUR_MS)),
    ];
    expect(valueOf(await compute("vercel-deployments-7d", { accounts: [vercel], events }))).toBe(2);
  });

  it("is not enough history when nothing stored reaches back to the window start", async () => {
    const recent = account({ provider: "vercel", connectionCreatedAt: new Date(AS_OF.getTime() - 3 * DAY_MS) });
    expect(valueOf(await compute("vercel-deployments-30d", { accounts: [recent] }))).toBe("not_enough_history");
    // A backfilled event older than the window start covers it.
    const backfilled = [succeeded(new Date(AS_OF.getTime() - 31 * DAY_MS))];
    expect(valueOf(await compute("vercel-deployments-30d", { accounts: [recent], events: backfilled }))).toBe(0);
  });

  it("is stale when an account never synced or the oldest sync is over two days old", async () => {
    const neverSynced = account({ provider: "vercel", accountId: "acct-2", lastSyncedAt: null });
    expect(valueOf(await compute("vercel-deployments-7d", { accounts: [vercel, neverSynced] }))).toBe("stale");
    expect(valueOf(await compute("vercel-deployments-7d", { accounts: [neverSynced] }))).toBe("no_data");
    const old = account({ provider: "vercel", lastSyncedAt: new Date(AS_OF.getTime() - STALE_AFTER_MS - 1) });
    expect(valueOf(await compute("vercel-deployments-7d", { accounts: [old] }))).toBe("stale");
  });

  it("counts only the project's accounts", async () => {
    const events = [succeeded(new Date(AS_OF.getTime() - HOUR_MS)), succeeded(new Date(AS_OF.getTime() - HOUR_MS), "other-project")];
    expect(valueOf(await compute("vercel-deployments-7d", { accounts: [vercel], events }))).toBe(1);
  });
});

describe("computePublicMetrics: deployment streak", () => {
  const vercel = account({ provider: "vercel" });
  const at = (hoursAgo: number) => new Date(AS_OF.getTime() - hoursAgo * HOUR_MS);

  it("counts successes since the newest failure, in deployments", async () => {
    const events = [
      event("vercel.deployment.succeeded", at(1)),
      event("vercel.deployment.succeeded", at(2)),
      event("vercel.deployment.failed", at(3)),
      event("vercel.deployment.succeeded", at(4)),
    ];
    expect(valueOf(await compute("vercel-deployment-streak", { accounts: [vercel], events }))).toBe(2);
  });

  it("is zero right after a failure and counts every success when none failed", async () => {
    expect(valueOf(await compute("vercel-deployment-streak", { accounts: [vercel], events: [event("vercel.deployment.failed", at(1))] }))).toBe(0);
    const successes = [event("vercel.deployment.succeeded", at(1)), event("vercel.deployment.succeeded", at(2))];
    expect(valueOf(await compute("vercel-deployment-streak", { accounts: [vercel], events: successes }))).toBe(2);
  });

  it("reports a run longer than the read limit as a lower bound", async () => {
    const events = Array.from({ length: STREAK_EVENT_LIMIT + 5 }, (_, index) => event("vercel.deployment.succeeded", at(index + 1)));
    expect(await compute("vercel-deployment-streak", { accounts: [vercel], events })).toMatchObject({
      status: "available",
      value: STREAK_EVENT_LIMIT,
      lowerBound: true,
    });
  });
});

describe("computePublicMetrics: a request's own window start (the yearly card)", () => {
  const vercel = account({ provider: "vercel", connectionCreatedAt: new Date("2025-12-01T00:00:00Z") });
  const yearStart = new Date("2026-01-01T00:00:00Z");

  async function computeFrom(metricId: PublicMetricId, data: { accounts: MemoryAccount[]; points?: SnapshotPoint[]; events?: MemoryEvent[] }, from: Date) {
    const store = new MemoryMetricStore(data.accounts, data.points ?? [], data.events ?? []);
    const [result] = await computePublicMetrics(store, [{ metricId, asOf: AS_OF, from }]);
    if (result === undefined) throw new Error("no result");
    return result.result;
  }

  it("counts events from the requested start instead of the definition's window", async () => {
    const events = [
      event("vercel.deployment.succeeded", new Date("2025-12-31T23:59:59Z")),
      event("vercel.deployment.succeeded", yearStart),
      event("vercel.deployment.succeeded", new Date("2026-06-01T00:00:00Z")),
      event("vercel.deployment.succeeded", new Date(AS_OF.getTime() - HOUR_MS)),
    ];
    expect(valueOf(await computeFrom("vercel-deployments-7d", { accounts: [vercel], events }, yearStart))).toBe(3);
    // The same request without a start keeps the 7 day window, as publications do.
    expect(valueOf(await compute("vercel-deployments-7d", { accounts: [vercel], events }))).toBe(1);
  });

  it("subtracts the reading of the requested start day for a change", async () => {
    const points = [point({ value: 400, retrievedAt: new Date("2026-01-01T23:00:00Z"), snapshotDate: "2026-01-01" }), dayPoint(7, 900), point({ value: 1000 })];
    expect(valueOf(await computeFrom("github-stars-gained-30d", { accounts: [account()], points }, yearStart))).toBe(600);
  });

  it("reads only the start days and the last two days for a year, never the days in between", async () => {
    const store = new MemoryMetricStore([account()], [], []);
    const ranges: string[] = [];
    const snapshots = store.snapshots.bind(store);
    store.snapshots = async (query) => {
      ranges.push(`${query.fromDate}..${query.toDate}`);
      return snapshots(query);
    };
    await computePublicMetrics(store, [{ metricId: "github-stars-gained-30d", asOf: AS_OF, from: yearStart }]);
    expect(ranges.sort()).toEqual(["2026-01-01..2026-01-02", "2026-11-03..2026-11-05"]);
  });

  it("is not enough history when the data does not reach back to the requested start", async () => {
    const lateConnection = account({ provider: "vercel", connectionCreatedAt: new Date("2026-03-01T00:00:00Z") });
    expect(valueOf(await computeFrom("vercel-deployments-30d", { accounts: [lateConnection] }, yearStart))).toBe("not_enough_history");
  });

  it("refuses a start for a metric without a window and a start that is not before asOf", async () => {
    await expect(computeFrom("github-stars", { accounts: [account()] }, yearStart)).rejects.toThrow(RangeError);
    await expect(computeFrom("vercel-deployments-7d", { accounts: [vercel] }, AS_OF)).rejects.toThrow(RangeError);
  });
});

describe("historyStart (#151)", () => {
  const vercel = account({ provider: "vercel", connectionCreatedAt: new Date("2026-08-07T10:00:00Z") });

  it("starts an event count at the oldest stored event when it is older than the connection (backfill)", async () => {
    const store = new MemoryMetricStore([vercel], [], [event("vercel.deployment.succeeded", new Date("2026-07-01T09:00:00Z"))]);
    expect(await historyStart(store, "vercel-deployments-30d")).toEqual(new Date("2026-07-01T09:00:00Z"));
  });

  it("starts an event count at the connection when no event is older (boundary: no events at all)", async () => {
    const store = new MemoryMetricStore([vercel], [], []);
    expect(await historyStart(store, "vercel-deployments-30d")).toEqual(new Date("2026-08-07T10:00:00Z"));
  });

  it("starts a snapshot change at the start of the oldest stored day, ignoring other metric keys", async () => {
    const store = new MemoryMetricStore(
      [account()],
      [dayPoint(3, 10), dayPoint(40, 2, { metricKey: "github.forks.total" }), dayPoint(20, 5)],
      [],
    );
    expect(await historyStart(store, "github-stars-gained-30d")).toEqual(new Date("2026-10-16T00:00:00Z"));
  });

  it("is null without an account of the provider, or for a snapshot metric with nothing stored", async () => {
    expect(await historyStart(new MemoryMetricStore([account()], [], []), "vercel-deployments-30d")).toBeNull();
    expect(await historyStart(new MemoryMetricStore([account()], [], []), "github-stars-gained-30d")).toBeNull();
  });

  it("refuses a metric with no window, which has no history start", async () => {
    await expect(historyStart(new MemoryMetricStore([account()], [], []), "github-stars")).rejects.toThrow(RangeError);
  });

  it("counts an event exactly at the history start once the window starts there (boundary: from equals the start)", async () => {
    const at = new Date("2026-08-07T10:00:00Z");
    const store = new MemoryMetricStore([vercel], [], [event("vercel.deployment.succeeded", at)]);
    const from = await historyStart(store, "vercel-deployments-30d");
    if (from === null) throw new Error("expected a history start");
    const [result] = await computePublicMetrics(store, [{ metricId: "vercel-deployments-30d", asOf: AS_OF, from }]);
    expect(result?.result).toMatchObject({ status: "available", value: 1 });
  });
});
