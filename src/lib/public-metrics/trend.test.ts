import { describe, expect, it } from "vitest";

import type { PublicMetricId } from "./definitions";
import { computePublicMetrics, STREAK_EVENT_LIMIT, type PublicMetricStore, type SnapshotPoint, type SourceAccount, type StoredEvent } from "./engine";
import { MemoryMetricStore } from "./memory-store";
import { computeTrend, TREND_EVENTS_LIMIT } from "./trend";

const AS_OF = new Date("2026-11-05T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function account(provider: SourceAccount["provider"], accountId: string): SourceAccount {
  return { accountId, provider, connectionCreatedAt: new Date("2026-01-01T00:00:00Z"), lastSyncedAt: AS_OF, simulated: false };
}

const ACCOUNTS = [account("github", "gh-1"), account("github", "gh-2"), account("vercel", "vc-1")];

/** One star count per GitHub account per day for 45 days, rising by a few each day. */
function starPoints(): SnapshotPoint[] {
  return Array.from({ length: 45 }, (_, day) =>
    ["gh-1", "gh-2"].map((accountId, index): SnapshotPoint => {
      const retrievedAt = new Date(AS_OF.getTime() - day * DAY_MS - HOUR_MS);
      return {
        accountId,
        metricKey: "github.stars.total",
        snapshotDate: retrievedAt.toISOString().slice(0, 10),
        value: 1000 * (index + 1) - day * (3 + index),
        periodStart: null,
        periodEnd: null,
        resetsAt: null,
        retrievedAt,
      };
    }),
  ).flat();
}

function deployment(at: number, failed = false): StoredEvent {
  return { accountId: "vc-1", typeId: failed ? "vercel.deployment.failed" : "vercel.deployment.succeeded", occurredAt: new Date(at) };
}

/** Deployments every 7 hours for 45 days, with a failure every 40th. */
function deployments(): StoredEvent[] {
  return Array.from({ length: Math.floor((45 * DAY_MS) / (7 * HOUR_MS)) }, (_, index) => deployment(AS_OF.getTime() - index * 7 * HOUR_MS - 1000, index % 40 === 39));
}

/** A store that counts the reads it answers, by method. */
class CountingStore implements PublicMetricStore {
  reads: Record<string, number> = {};

  constructor(private readonly inner: PublicMetricStore) {}

  private count(method: string): void {
    this.reads[method] = (this.reads[method] ?? 0) + 1;
  }

  accounts() {
    this.count("accounts");
    return this.inner.accounts();
  }

  snapshots(query: Parameters<PublicMetricStore["snapshots"]>[0]) {
    this.count("snapshots");
    return this.inner.snapshots(query);
  }

  earliestSnapshotDate(query: Parameters<PublicMetricStore["earliestSnapshotDate"]>[0]) {
    this.count("earliestSnapshotDate");
    return this.inner.earliestSnapshotDate(query);
  }

  countEvents(query: Parameters<PublicMetricStore["countEvents"]>[0]) {
    this.count("countEvents");
    return this.inner.countEvents(query);
  }

  earliestEvent(query: Parameters<PublicMetricStore["earliestEvent"]>[0]) {
    this.count("earliestEvent");
    return this.inner.earliestEvent(query);
  }

  recentEvents(query: Parameters<PublicMetricStore["recentEvents"]>[0]) {
    this.count("recentEvents");
    return this.inner.recentEvents(query);
  }
}

function days(count: number, asOf = AS_OF): Date[] {
  return Array.from({ length: count + 1 }, (_, index) => new Date(asOf.getTime() - (count - index) * DAY_MS));
}

/** What the engine gives at each moment, asked directly of the full store. */
async function direct(store: PublicMetricStore, metricId: PublicMetricId, moments: readonly Date[]) {
  return computePublicMetrics(
    store,
    moments.map((asOf) => ({ metricId, asOf })),
  );
}

describe("computeTrend (#149)", () => {
  const store = new MemoryMetricStore(ACCOUNTS, starPoints(), deployments());

  it.each([
    ["github-stars", { accounts: 1, snapshots: 1 }],
    ["github-stars-gained-7d", { accounts: 1, snapshots: 1 }],
    ["github-stars-gained-30d", { accounts: 1, snapshots: 1 }],
    ["vercel-deployments-30d", { accounts: 1, recentEvents: 1, earliestEvent: 1 }],
    ["vercel-deployment-streak", { accounts: 1, recentEvents: 1 }],
  ] as const)("computes %s at every moment as the engine does, from the same few reads for 1 or 30 days", async (metricId, reads) => {
    for (const count of [1, 30]) {
      const moments = days(count);
      const counting = new CountingStore(store);
      const trend = await computeTrend(counting, metricId, moments);
      expect(trend).toEqual(await direct(store, metricId, moments));
      expect(counting.reads).toEqual(reads);
    }
  });

  it("takes where history starts from the database's oldest event, not the oldest event read (boundary: a backfilled event older than every window)", async () => {
    // Connected 20 days ago with one deployment backfilled from 100 days ago, which no window reaches.
    const vercel = { ...account("vercel", "vc-1"), connectionCreatedAt: new Date(AS_OF.getTime() - 20 * DAY_MS) };
    const backfilled = new MemoryMetricStore([vercel], [], [deployment(AS_OF.getTime() - 100 * DAY_MS), ...deployments().slice(0, 60)]);
    const moments = days(30);
    const trend = await computeTrend(backfilled, "vercel-deployments-30d", moments);
    expect(trend).toEqual(await direct(backfilled, "vercel-deployments-30d", moments));
    expect(trend.every((point) => point?.result.status === "available")).toBe(true);
  });

  it("gives no value where a cut event read cannot hold a count's window (boundary: TREND_EVENTS_LIMIT events)", async () => {
    // TREND_EVENTS_LIMIT deployments over the last seven and a half days, and older ones the cut read leaves out.
    const span = 7.5 * DAY_MS;
    const recent = Array.from({ length: TREND_EVENTS_LIMIT }, (_, index) => deployment(AS_OF.getTime() - 1 - Math.floor((index * span) / TREND_EVENTS_LIMIT)));
    const older = [8.5, 9.5, 10.5].map((daysAgo) => deployment(AS_OF.getTime() - daysAgo * DAY_MS));
    const busy = new MemoryMetricStore(ACCOUNTS, [], [...recent, ...older]);
    const moments = days(2);
    const trend = await computeTrend(busy, "vercel-deployments-7d", moments);
    // Only today's window starts after the oldest event read; it is exact.
    expect(trend.slice(0, 2)).toEqual([null, null]);
    const [today] = await direct(busy, "vercel-deployments-7d", [AS_OF]);
    expect(trend[2]).toEqual(today);
  });

  it("gives no value where a cut event read cannot hold a streak's newest events (boundary: TREND_EVENTS_LIMIT events)", async () => {
    // TREND_EVENTS_LIMIT successes in the last day, after a failure two days ago.
    const recent = Array.from({ length: TREND_EVENTS_LIMIT }, (_, index) => deployment(AS_OF.getTime() - 1 - Math.floor((index * DAY_MS) / TREND_EVENTS_LIMIT)));
    const busy = new MemoryMetricStore(ACCOUNTS, [], [...recent, deployment(AS_OF.getTime() - 2 * DAY_MS, true)]);
    const trend = await computeTrend(busy, "vercel-deployment-streak", days(2));
    // Two days ago the streak was 0 after the failure, but the read was cut before it.
    expect(trend[0]).toBeNull();
    // Today the newest STREAK_EVENT_LIMIT events were all read: at least that many in a row.
    expect(trend[2]?.result).toMatchObject({ status: "available", value: STREAK_EVENT_LIMIT, lowerBound: true });
  });
});
