import { describe, expect, it } from "vitest";

import type { SnapshotPoint, SourceAccount, StoredEvent } from "./engine";
import { MemoryMetricStore } from "./memory-store";
import {
  computeYearSummary,
  hasYearStarted,
  isYearComplete,
  latestCardYear,
  parseCardYear,
  yearCardAltText,
  yearFigures,
  yearLabel,
  yearShareText,
  yearToDateNote,
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

const deploy = (at: string): StoredEvent => ({ typeId: "vercel.deployment.succeeded", occurredAt: new Date(at), accountId: "vercel-acct" });

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

  it("runs this year's card up to now and labels it the year to date (boundary: the year is not over)", async () => {
    const store = new MemoryMetricStore([account("vercel", "2026-01-10T00:00:00Z")], [], [deploy("2026-03-01T00:00:00Z"), deploy("2026-11-05T11:00:00Z")]);
    const summary = await computeYearSummary(store, 2026, NOW);
    expect(summary.asOf).toEqual(NOW);
    expect(summary.stats[0]).toMatchObject({ status: "available", value: 2 });
    expect(yearShareText(summary)).toBe("My stack in 2026 so far on DevMacro: 2 deployments shipped.");
    expect(yearCardAltText(summary)).toMatch(/^DevMacro card: your stack in 2026 so far, 2026-01-01 to 2026-11-05\. /);
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
    expect(yearShareText(summary)).toBe("My stack in 2026 so far on DevMacro: 1 deployment shipped. Simulated data.");
  });

  it("refuses a year that has not started", async () => {
    await expect(computeYearSummary(new MemoryMetricStore([], [], []), 2027, NOW)).rejects.toThrow(RangeError);
  });
});

describe("the year card's words", () => {
  it("lists every figure with its note, then the provider count, and says it all in the alt text of a whole year", async () => {
    const synced = { lastSyncedAt: new Date("2026-12-01T23:00:00Z") };
    const store = new MemoryMetricStore([account("vercel", "2025-08-07T10:00:00Z", synced)], [], [deploy("2025-09-01T00:00:00Z")]);
    const summary = await computeYearSummary(store, 2025, NOW);
    expect(yearFigures(summary)).toEqual([
      { label: "Deployments shipped", value: "1", note: "since 2025-08-07" },
      { label: "Stars gained", value: "Not connected", note: null },
      { label: "Signups", value: "Not connected", note: null },
      { label: "Providers connected", value: "1", note: null },
    ]);
    expect(yearCardAltText(summary)).toBe(
      "DevMacro card: your stack in 2025, 2025-01-01 to 2025-12-31. Deployments shipped: 1, since 2025-08-07. Stars gained: Not connected. Signups: Not connected. Providers connected: 1. Counted by DevMacro from stored data.",
    );
    expect(yearShareText(summary)).toBe("My stack in 2025 on DevMacro: 1 deployment shipped.");
  });
});

describe("which years have a card", () => {
  it("shows a year from its first moment and the current year at any time (boundary: midnight on 1 January)", () => {
    expect(hasYearStarted(2027, new Date("2027-01-01T00:00:00.000Z"))).toBe(false);
    expect(hasYearStarted(2027, new Date("2027-01-01T00:00:00.001Z"))).toBe(true);
    expect(hasYearStarted(2026, NOW)).toBe(true);
    expect(latestCardYear(NOW)).toBe(2026);
    expect(latestCardYear(new Date("2027-01-01T00:00:00.000Z"))).toBe(2026);
  });

  it("labels the year to date until the year ends, then the whole year (boundary: the last millisecond of December)", () => {
    expect(isYearComplete(2026, new Date("2026-12-31T23:59:59.999Z"))).toBe(false);
    expect(yearLabel(2026, new Date("2026-12-31T23:59:59.999Z"))).toBe("2026 so far");
    expect(isYearComplete(2026, new Date("2027-01-01T00:00:00.000Z"))).toBe(true);
    expect(yearLabel(2026, new Date("2027-01-01T00:00:00.000Z"))).toBe("2026");
    expect(yearLabel(2025, NOW)).toBe("2025");
  });

  it("dates the end of the year to date as the next 1 January in ISO form (boundary: 2099 rolls into 2100)", () => {
    expect(yearToDateNote(2026)).toBe("2026 is not over yet. This card counts up to today and covers the whole year from 2027-01-01.");
    expect(yearToDateNote(2099)).toContain("covers the whole year from 2100-01-01.");
    expect(yearToDateNote(2026)).not.toContain("January");
  });

  it.each([
    ["2025", 2025],
    ["2026", 2026],
    ["2027", null],
    ["0999", null],
    ["25", null],
    ["2025.png", null],
    ["", null],
  ])("parses the URL segment %s as %s", (segment, expected) => {
    expect(parseCardYear(segment, NOW)).toBe(expected);
  });
});
