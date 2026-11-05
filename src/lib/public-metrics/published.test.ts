import { describe, expect, it } from "vitest";

import type { SnapshotPoint } from "./engine";
import { MemoryMetricStore } from "./memory-store";
import { publishedTrend, type PublishedEngineMetric } from "./published";

const AS_OF = new Date("2026-11-05T12:00:00Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function stars(daysAgo: number, value: number): SnapshotPoint {
  const retrievedAt = new Date(AS_OF.getTime() - daysAgo * DAY_MS - 60_000);
  return {
    accountId: "acct-1",
    metricKey: "github.stars.total",
    snapshotDate: retrievedAt.toISOString().slice(0, 10),
    value,
    periodStart: null,
    periodEnd: null,
    resetsAt: null,
    retrievedAt,
  };
}

const store = new MemoryMetricStore(
  [{ accountId: "acct-1", provider: "github", connectionCreatedAt: new Date("2026-01-01T00:00:00Z"), lastSyncedAt: AS_OF, simulated: false }],
  [stars(0, 1290), stars(1, 1204), stars(2, 1180)],
  [],
);

function published(overrides: Partial<PublishedEngineMetric>): PublishedEngineMetric {
  return {
    kind: "engine",
    publicationId: "80000000-0000-4000-8000-000000000001",
    metricId: "github-stars",
    label: "GitHub stars",
    unit: "stars",
    provenance: "verified",
    formulaPath: "/docs/architecture/public-metrics#github-stars",
    rounding: "exact",
    delayDays: 0,
    publishedAt: AS_OF,
    asOf: AS_OF,
    value: { status: "available", value: 1290, text: "1,290 stars", atLeast: false, lastSyncedAt: AS_OF, simulated: false },
    ...overrides,
  };
}

describe("publishedTrend (#149)", () => {
  it("gives one point per day, oldest first, ending with the value itself", async () => {
    const trend = await publishedTrend(store, published({}), 2);
    expect(trend).toEqual([
      { at: new Date(AS_OF.getTime() - 2 * DAY_MS), value: 1180 },
      { at: new Date(AS_OF.getTime() - DAY_MS), value: 1204 },
      { at: AS_OF, value: 1290 },
    ]);
  });

  it("rounds every point as the publication does, so the trend never reveals the exact numbers", async () => {
    const trend = await publishedTrend(store, published({ rounding: "hundreds" }), 2);
    expect(trend.map((point) => point.value)).toEqual([1100, 1200, 1200]);
  });

  it("ends a delayed publication's trend at its own asOf, never later", async () => {
    const asOf = new Date(AS_OF.getTime() - DAY_MS);
    const trend = await publishedTrend(store, published({ delayDays: 7, asOf }), 1);
    expect(trend.map((point) => point.at)).toEqual([new Date(asOf.getTime() - DAY_MS), asOf]);
    expect(trend.map((point) => point.value)).toEqual([1180, 1204]);
  });

  it("leaves a gap for a day with no value (boundary: before the history starts)", async () => {
    const trend = await publishedTrend(store, published({}), 4);
    expect(trend.map((point) => point.value)).toEqual([null, null, 1180, 1204, 1290]);
  });
});
