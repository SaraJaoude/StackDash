import { describe, expect, it } from "vitest";

import type { SnapshotPoint, SourceAccount } from "./engine";
import { MemoryMetricStore, type MemoryEvent } from "./memory-store";
import {
  computeYearSummary,
  isYearCardOpen,
  latestOpenYear,
  parseCardYear,
  yearCardAltText,
  yearFigures,
  yearShareText,
} from "./yearly";

const NOW = new Date("2026-11-05T12:00:00Z");
const SYNCED = new Date("2026-11-05T11:50:00Z");

function account(provider: SourceAccount["provider"], connectedAt: string, overrides: Partial<SourceAccount> = {}): SourceAccount {
  return {
    accountId: `${provider}-acct`,
    provider,
    connectionCreatedAt: new Date(connectedAt),
    lastSyncedAt: SYNCED,
    simulated: false,
    ...overrides,
  };
}

function stars(retrievedAt: string, value: number): SnapshotPoint {
  return {
    accountId: "github-acct",
    metricKey: "github.stars.total",
    snapshotDate: retrievedAt.slice(0, 10),
    value,
    periodStart: null,
    periodEnd: null,
    resetsAt: null,
    retrievedAt: new Date(retrievedAt),
  };
}

const deploy = (at: string): MemoryEvent => ({ typeId: "vercel.deployment.succeeded", occurredAt: new Date(at), accountId: "vercel-acct" });

describe("computeYearSummary", () => {
  it("counts a past year from where its history starts, says since when, and ignores the next year", async () => {
    const store = new MemoryMetricStore(
      [account("vercel", "2025-08-07T10:00:00Z"), account("github", "2025-03-09T12:00:00Z"), account("stripe", "2026-02-01T00:00:00Z")],
      [stars("2025-03-10T06:00:00Z", 20), stars("2025-12-31T23:00:00Z", 50), stars("2026-01-01T05:00:00Z", 90)],
      // The June deployment is history the adapter backfilled on connecting in August.
      [deploy("2025-06-01T09:00:00Z"), deploy("2025-09-01T09:00:00Z"), deploy("2026-01-05T09:00:00Z")],
    );

    const summary = await computeYearSummary(store, 2025, NOW);

    expect(summary.asOf).toEqual(new Date("2026-01-01T00:00:00Z"));
    expect(summary.stats).toEqual([
      { label: "Deployments shipped", status: "available", value: 2, since: new Date("2025-06-01T09:00:00Z"), simulated: false },
      { label: "Stars gained", status: "available", value: 30, since: new Date("2025-03-10T00:00:00Z"), simulated: false },
      { label: "Signups", status: "unavailable", text: "Not connected" },
    ]);
    // Stripe was connected after the year ended, so it is not one of the year's providers.
    expect(summary.providers).toBe(2);
    expect(summary.simulated).toBe(false);
  });

  it("counts from 1 January with no since note when the history starts earlier", async () => {
    const store = new MemoryMetricStore(
      [account("vercel", "2024-05-01T00:00:00Z")],
      [],
      [deploy("2024-12-31T23:59:59Z"), deploy("2025-01-01T00:00:00Z"), deploy("2025-07-01T00:00:00Z")],
    );
    const [deployments] = (await computeYearSummary(store, 2025, NOW)).stats;
    expect(deployments).toEqual({ label: "Deployments shipped", status: "available", value: 2, since: null, simulated: false });
  });

  it("runs this year's card up to now (boundary: the year is not over)", async () => {
    const store = new MemoryMetricStore([account("vercel", "2026-01-10T00:00:00Z")], [], [deploy("2026-03-01T00:00:00Z"), deploy("2026-11-05T11:00:00Z")]);
    const summary = await computeYearSummary(store, 2026, NOW);
    expect(summary.asOf).toEqual(NOW);
    expect(summary.stats[0]).toMatchObject({ status: "available", value: 2 });
  });

  it("says there is no data in the year when the provider was connected after it (boundary: history after the year)", async () => {
    const store = new MemoryMetricStore([account("supabase", "2026-02-01T00:00:00Z")], [], []);
    const summary = await computeYearSummary(store, 2025, NOW);
    expect(summary.stats[2]).toEqual({ label: "Signups", status: "unavailable", text: "No data in 2025" });
    expect(summary.providers).toBe(0);
  });

  it("marks the whole card simulated when any figure rests on simulated data", async () => {
    const store = new MemoryMetricStore([account("vercel", "2026-01-10T00:00:00Z", { simulated: true })], [], [deploy("2026-03-01T00:00:00Z")]);
    const summary = await computeYearSummary(store, 2026, NOW);
    expect(summary.simulated).toBe(true);
    expect(yearShareText(summary)).toBe("My stack in 2026 on DevMacro: 1 deployment shipped. Simulated data.");
  });

  it("refuses a year that has not started", async () => {
    await expect(computeYearSummary(new MemoryMetricStore([], [], []), 2027, NOW)).rejects.toThrow(RangeError);
  });
});

describe("the year card's words", () => {
  it("lists every figure with its note, then the provider count, and says it all in the alt text", async () => {
    const synced = { lastSyncedAt: new Date("2026-12-01T23:00:00Z") };
    const store = new MemoryMetricStore([account("vercel", "2026-08-07T10:00:00Z", synced)], [], [deploy("2026-09-01T00:00:00Z")]);
    const summary = await computeYearSummary(store, 2026, new Date("2026-12-02T00:00:00Z"));
    expect(yearFigures(summary)).toEqual([
      { label: "Deployments shipped", value: "1", note: "since 2026-08-07" },
      { label: "Stars gained", value: "Not connected", note: null },
      { label: "Signups", value: "Not connected", note: null },
      { label: "Providers connected", value: "1", note: null },
    ]);
    expect(yearCardAltText(summary)).toBe(
      "DevMacro card: your stack in 2026, 2026-01-01 to 2026-12-01. Deployments shipped: 1, since 2026-08-07. Stars gained: Not connected. Signups: Not connected. Providers connected: 1. Counted by DevMacro from stored data.",
    );
    expect(yearShareText(summary)).toBe("My stack in 2026 on DevMacro: 1 deployment shipped.");
  });
});

describe("when a year's card opens", () => {
  it("opens on 1 December and stays open (boundary: the last millisecond of November)", () => {
    expect(isYearCardOpen(2026, new Date("2026-11-30T23:59:59.999Z"))).toBe(false);
    expect(isYearCardOpen(2026, new Date("2026-12-01T00:00:00.000Z"))).toBe(true);
    expect(isYearCardOpen(2025, NOW)).toBe(true);
  });

  it("offers last year's card until this year's opens", () => {
    expect(latestOpenYear(NOW)).toBe(2025);
    expect(latestOpenYear(new Date("2026-12-01T00:00:00Z"))).toBe(2026);
    expect(latestOpenYear(new Date("2027-01-01T00:00:00Z"))).toBe(2026);
  });

  it.each([
    ["2025", 2025],
    ["2026", null],
    ["2027", null],
    ["0999", null],
    ["25", null],
    ["2025.png", null],
    ["", null],
  ])("parses the URL segment %s as %s", (segment, expected) => {
    expect(parseCardYear(segment, NOW)).toBe(expected);
  });
});
