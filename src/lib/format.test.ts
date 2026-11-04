import { describe, expect, it } from "vitest";

import {
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPeriod,
  formatQuantity,
  formatRelative,
  formatUtcMonth,
} from "./format";

const NOW = new Date("2026-10-15T12:00:00.000Z");
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

function ago(ms: number): Date {
  return new Date(NOW.getTime() - ms);
}

describe("formatMoney", () => {
  it("formats minor units with each currency's own digits", () => {
    expect(formatMoney(12_345, "USD")).toBe("$123.45");
    expect(formatMoney(6_789, "EUR")).toBe("€67.89");
    expect(formatMoney(1_500, "JPY")).toBe("¥1,500");
    // Intl separates the code from the amount with a no-break space.
    expect(formatMoney(1_234, "KWD")).toBe("KWD\u00a01.234");
  });
});

describe("formatQuantity and formatPercent", () => {
  it("groups thousands and keeps up to two decimals before the unit", () => {
    expect(formatQuantity(1_234.567, "requests")).toBe("1,234.57 requests");
  });

  it("formats percent on a 0 to 100 scale", () => {
    expect(formatPercent(25)).toBe("25%");
    expect(formatPercent(33.333)).toBe("33.3%");
  });
});

describe("formatPeriod", () => {
  it("shows an exclusive period end as the previous UTC day, also in British summer time", () => {
    expect(formatPeriod({ start: "2026-10-01T00:00:00.000Z", end: "2026-11-01T00:00:00.000Z" })).toBe(
      "2026-10-01 to 2026-10-31",
    );
    expect(formatPeriod({ start: "2026-06-01T00:00:00.000Z", end: "2026-07-01T00:00:00.000Z" })).toBe(
      "2026-06-01 to 2026-06-30",
    );
  });
});

describe("formatUtcMonth", () => {
  it("names the UTC month, not the London one", () => {
    expect(formatUtcMonth("2026-10-01T00:00:00Z")).toBe("October 2026");
    expect(formatUtcMonth(new Date("2026-10-31T23:30:00.000Z"))).toBe("October 2026");
  });
});

describe("formatDateTime", () => {
  it("shows London summer time an hour ahead of UTC, named BST", () => {
    expect(formatDateTime("2026-07-01T00:00:00.000Z")).toBe("2026-07-01 01:00 BST");
  });

  it("shows GMT after the October clock change, on a 24 hour clock", () => {
    expect(formatDateTime(new Date("2026-10-31T14:05:00.000Z"))).toBe("2026-10-31 14:05 GMT");
  });

  it("uses the London date when it differs from the UTC date", () => {
    expect(formatDateTime("2026-06-30T23:30:00.000Z")).toBe("2026-07-01 00:30 BST");
  });
});

describe("formatRelative", () => {
  it("reads in the largest whole unit, rounded down", () => {
    expect(formatRelative("2026-10-15T07:00:00.000Z", NOW)).toBe("5 hours ago");
    expect(formatRelative(ago(119 * MINUTE_MS), NOW)).toBe("1 hour ago");
    expect(formatRelative(ago(MINUTE_MS), NOW)).toBe("1 minute ago");
    expect(formatRelative(ago(45_000), NOW)).toBe("45 seconds ago");
  });

  it("names yesterday and counts weeks, months, and years", () => {
    expect(formatRelative(ago(DAY_MS), NOW)).toBe("yesterday");
    expect(formatRelative(ago(15 * DAY_MS), NOW)).toBe("2 weeks ago");
    expect(formatRelative(ago(65 * DAY_MS), NOW)).toBe("2 months ago");
    expect(formatRelative(ago(400 * DAY_MS), NOW)).toBe("last year");
  });

  it("reads the present and a future time (clock skew) as now", () => {
    expect(formatRelative(NOW, NOW)).toBe("now");
    expect(formatRelative("2026-10-15T13:00:00.000Z", NOW)).toBe("now");
  });

  it("says unknown for a time that does not parse", () => {
    expect(formatRelative("not a date", NOW)).toBe("unknown");
    expect(formatRelative(new Date(Number.NaN), NOW)).toBe("unknown");
  });
});
