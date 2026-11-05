import { describe, expect, it } from "vitest";

import type { SnapshotInput } from "./aggregate";
import {
  periodEndOf,
  projectAllowances,
  projectDashboard,
  projectedMinor,
  projectedToCross,
  projectMetric,
  projectSeries,
  projectSpend,
  quotaProjectionText,
  spendProjectionText,
  type PeriodEnd,
  type Projection,
  type SeriesPoint,
  type SpendProjection,
} from "./projection";

const NOW = new Date("2026-11-05T12:00:00.000Z");
const NOVEMBER = { period_start: "2026-11-01T00:00:00.000Z", period_end: "2026-12-01T00:00:00.000Z" } as const;
const MONTH_END: PeriodEnd = { at: "2026-12-01T00:00:00.000Z", assumed: false };
const DASHES = /[\u2013\u2014]/;

/** `YYYY-MM-DD` for day `day` of November 2026. */
function november(day: number): string {
  return `2026-11-${String(day).padStart(2, "0")}`;
}

/** Readings at 06:00 UTC on consecutive November days, starting on `firstDay`. */
function points(values: readonly number[], firstDay = 1): SeriesPoint[] {
  return values.map((value, index) => {
    const date = november(firstDay + index);
    return { date, at: `${date}T06:00:00.000Z`, value };
  });
}

function row(date: string, overrides: Partial<SnapshotInput> & Pick<SnapshotInput, "metric_key">): SnapshotInput {
  return {
    connection_id: "c1",
    external_account_id: "a1",
    kind: "verified_spend",
    label: "Spend this month",
    snapshot_date: date,
    value: null,
    unit: null,
    amount_minor: null,
    currency: "USD",
    ...NOVEMBER,
    point_at: null,
    resets_at: null,
    retrieved_at: `${date}T06:00:00.000Z`,
    provenance_source: "provider_api",
    pricing_source: null,
    ...overrides,
  };
}

/** Month to date spend for one account, one row a day from November 1. */
function spendRows(amounts: readonly number[], overrides: Partial<SnapshotInput> = {}): SnapshotInput[] {
  return amounts.map((amount, index) => row(november(1 + index), { metric_key: "fake.spend.month", amount_minor: amount, ...overrides }));
}

function projected(projection: Projection) {
  if (projection.status !== "projected") throw new Error(`expected a projection, got ${projection.reason}`);
  return projection;
}

describe("projectSeries", () => {
  it("continues the recent daily rate from the last reading to the end of the period", () => {
    const result = projected(projectSeries(points([100, 200, 300, 400, 500]), MONTH_END, NOW));
    // From 2026-11-05 06:00 to 2026-12-01 00:00 is 25.75 days at 100 a day.
    expect(result.projected).toBeCloseTo(3075, 9);
    expect(result.current).toBe(500);
    expect(result.basis).toEqual({ from: "2026-11-01", to: "2026-11-05", days: 5, ratePerDay: 100, lastReadAt: "2026-11-05T06:00:00.000Z" });
  });

  it.each([
    { name: "no points", values: [] },
    { name: "one point", values: [100] },
    { name: "two points (fewer than 3)", values: [100, 200] },
  ])("projects nothing from $name", ({ values }) => {
    expect(projectSeries(points(values), MONTH_END, NOW)).toEqual({ status: "unavailable", reason: "too_few_days" });
  });

  it("projects from exactly 3 days of data", () => {
    expect(projected(projectSeries(points([0, 10, 20], 3), MONTH_END, NOW)).basis.days).toBe(3);
  });

  it("projects nothing when the period end is unknown", () => {
    expect(projectSeries(points([1, 2, 3]), null, NOW)).toEqual({ status: "unavailable", reason: "unknown_period" });
  });

  it("projects nothing for a period that ends now or has ended", () => {
    expect(projectSeries(points([1, 2, 3]), { at: NOW.toISOString(), assumed: false }, NOW)).toEqual({
      status: "unavailable",
      reason: "period_ended",
    });
  });

  it("projects zero usage as staying at zero", () => {
    const result = projected(projectSeries(points([0, 0, 0, 0]), MONTH_END, NOW));
    expect(result.projected).toBe(0);
    expect(result.basis.ratePerDay).toBe(0);
  });

  it("starts again after a value falls, so the rate is never negative", () => {
    const result = projected(projectSeries(points([100, 200, 50, 60, 70]), MONTH_END, NOW));
    expect(result.basis).toMatchObject({ from: "2026-11-03", days: 3, ratePerDay: 10 });
  });

  it("projects nothing when a fall leaves fewer than 3 days", () => {
    expect(projectSeries(points([100, 200, 300, 10, 20]), MONTH_END, NOW)).toEqual({ status: "unavailable", reason: "too_few_days" });
  });

  it("uses only the latest 7 days of data", () => {
    // Slow for the first three days, then 10 a day: only the last 7 readings count.
    const result = projected(projectSeries(points([0, 1, 2, 10, 20, 30, 40, 50, 60, 70], 1), { at: "2026-12-01T00:00:00.000Z", assumed: false }, new Date("2026-11-10T12:00:00.000Z")));
    expect(result.basis).toMatchObject({ from: "2026-11-04", to: "2026-11-10", days: 7, ratePerDay: 10 });
  });

  it("keeps the newest reading when a date appears twice", () => {
    const twice = [...points([0, 10, 20]), { date: "2026-11-03", at: "2026-11-03T05:00:00.000Z", value: 999 }];
    expect(projected(projectSeries(twice, MONTH_END, NOW)).current).toBe(20);
  });
});

describe("periodEndOf", () => {
  const read = { retrieved_at: "2026-11-05T06:00:00.000Z", resets_at: null } as const;

  it("uses the reset time first", () => {
    expect(periodEndOf({ ...read, period_start: null, period_end: null, resets_at: "2026-11-06T00:00:00+00:00" })).toEqual({
      at: "2026-11-06T00:00:00.000Z",
      assumed: false,
    });
  });

  it("uses a stored end that runs past the day of the reading", () => {
    expect(periodEndOf({ ...read, ...NOVEMBER })).toEqual(MONTH_END);
  });

  it("takes a month to date window to end with the calendar month, and says it assumed so", () => {
    // Vercel stores the end of today; Stripe stores the reading time.
    expect(periodEndOf({ ...read, period_start: NOVEMBER.period_start, period_end: "2026-11-06T00:00:00.000Z" })).toEqual({
      at: MONTH_END.at,
      assumed: true,
    });
    expect(periodEndOf({ ...read, period_start: NOVEMBER.period_start, period_end: read.retrieved_at })).toEqual({ at: MONTH_END.at, assumed: true });
  });

  it("does not call a whole month assumed when it is read on its last day", () => {
    expect(periodEndOf({ ...NOVEMBER, resets_at: null, retrieved_at: "2026-11-30T06:00:00.000Z" })).toEqual(MONTH_END);
  });

  it.each([
    { name: "a to date window that starts mid-month", period_start: "2026-11-05T00:00:00.000Z", period_end: "2026-11-06T00:00:00.000Z" },
    { name: "a point reading with no reset", period_start: null, period_end: null },
  ])("has no known end for $name", (fields) => {
    expect(periodEndOf({ ...read, ...fields })).toBeNull();
  });
});

describe("projectMetric", () => {
  const amount = (candidate: SnapshotInput) => candidate.amount_minor;

  it("ignores readings from the previous period when the period resets mid-window", () => {
    const october = { period_start: "2026-10-01T00:00:00.000Z", period_end: "2026-11-01T00:00:00.000Z" };
    const rows = [
      row("2026-10-29", { metric_key: "m", amount_minor: 9000, ...october }),
      row("2026-10-30", { metric_key: "m", amount_minor: 9500, ...october }),
      row("2026-10-31", { metric_key: "m", amount_minor: 9900, ...october }),
      ...spendRows([100, 200, 300, 400, 500]).map((candidate) => ({ ...candidate, metric_key: "m" })),
    ];
    expect(projected(projectMetric(rows, amount, NOW)).basis).toMatchObject({ from: "2026-11-01", days: 5, ratePerDay: 100 });
  });

  it("projects nothing two days after a reset, however much history came before it", () => {
    const october = { period_start: "2026-10-01T00:00:00.000Z", period_end: "2026-11-01T00:00:00.000Z" };
    const rows = [
      ...[27, 28, 29, 30, 31].map((day) => row(`2026-10-${day}`, { metric_key: "m", amount_minor: day * 100, ...october })),
      row("2026-11-01", { metric_key: "m", amount_minor: 100 }),
      row("2026-11-02", { metric_key: "m", amount_minor: 200 }),
    ];
    expect(projectMetric(rows, amount, new Date("2026-11-02T12:00:00.000Z"))).toEqual({ status: "unavailable", reason: "too_few_days" });
  });

  it("keys a point reading's period by its reset time", () => {
    const point = (date: string, value: number, resets: string) =>
      row(date, { metric_key: "q.used", kind: "usage", value, unit: "emails", currency: null, period_start: null, period_end: null, point_at: `${date}T06:00:00.000Z`, resets_at: resets });
    const rows = [
      point("2026-10-31", 2900, "2026-11-01T00:00:00.000Z"),
      point("2026-11-01", 90, "2026-12-01T00:00:00.000Z"),
      point("2026-11-02", 180, "2026-12-01T00:00:00.000Z"),
      point("2026-11-03", 270, "2026-12-01T00:00:00.000Z"),
    ];
    const result = projected(projectMetric(rows, (candidate) => candidate.value, NOW));
    expect(result.basis).toMatchObject({ from: "2026-11-01", days: 3, ratePerDay: 90 });
    expect(result.periodEnd).toEqual(MONTH_END);
  });

  it("has no known period for a point reading with no reset", () => {
    const rows = [1, 2, 3].map((day) =>
      row(november(day), { metric_key: "m", amount_minor: day, period_start: null, period_end: null, point_at: `${november(day)}T06:00:00.000Z` }),
    );
    expect(projectMetric(rows, amount, NOW)).toEqual({ status: "unavailable", reason: "unknown_period" });
  });
});

describe("projectSpend", () => {
  it("projects verified spend and leaves an estimate for the same account out", () => {
    const rows = [
      ...spendRows([100, 200, 300, 400, 500]),
      ...spendRows([9000, 9000, 9000, 9000, 9000], { metric_key: "fake.cost.estimate", kind: "estimated_spend", provenance_source: "derived" }),
    ];
    const [usd] = projectSpend(rows, NOW);
    expect(usd?.includesEstimates).toBe(false);
    expect(projectedMinor(projected(usd?.projection ?? { status: "unavailable", reason: "too_few_days" }))).toBe(3075);
  });

  it("projects an account's estimate when it has no verified spend, and says it includes estimates", () => {
    const rows = [
      ...spendRows([100, 200, 300, 400, 500]),
      ...spendRows([10, 20, 30, 40, 50], { external_account_id: "a2", metric_key: "fake.cost.estimate", kind: "estimated_spend", provenance_source: "derived" }),
    ];
    const [usd] = projectSpend(rows, NOW);
    expect(usd?.includesEstimates).toBe(true);
    // 3075 for a1 plus 307.5 for a2, rounded once.
    expect(projectedMinor(projected(usd?.projection ?? { status: "unavailable", reason: "too_few_days" }))).toBe(3383);
  });

  it("sums unrounded and rounds once", () => {
    // Each account projects 29.75 cents; three of them are 89.25, so 89, not 3 times 30.
    const rows = ["a1", "a2", "a3"].flatMap((account) =>
      [0, 1, 2].map((amount, index) => row(november(1 + index), { external_account_id: account, metric_key: "m", amount_minor: amount })),
    );
    const [usd] = projectSpend(rows, new Date("2026-11-03T12:00:00.000Z"));
    expect(projectedMinor(projected(usd?.projection ?? { status: "unavailable", reason: "too_few_days" }))).toBe(89);
  });

  it("keeps currencies apart", () => {
    const rows = [...spendRows([100, 200, 300]), ...spendRows([1, 2, 3], { metric_key: "fake.spend.eur", currency: "EUR" })];
    expect(projectSpend(rows, NOW).map((spend) => spend.currency)).toEqual(["EUR", "USD"]);
  });

  it("is unavailable when any counted amount cannot be projected", () => {
    const rows = [...spendRows([100, 200, 300, 400, 500]), ...spendRows([5, 6], { external_account_id: "a2" })];
    expect(projectSpend(rows, NOW)[0]?.projection).toEqual({ status: "unavailable", reason: "too_few_days" });
  });

  it("says the period has ended when the latest spend is from a period that is over", () => {
    // The dashboard still shows the last reading of October until November is read.
    const october = { period_start: "2026-10-01T00:00:00.000Z", period_end: "2026-11-01T00:00:00.000Z" };
    const rows = [28, 29, 30].map((day) => row(`2026-10-${day}`, { metric_key: "m", amount_minor: day, ...october }));
    expect(projectSpend(rows, NOW)[0]?.projection).toEqual({ status: "unavailable", reason: "period_ended" });
  });
});

describe("projectAllowances", () => {
  function quota(usedValues: readonly number[], included = 3000) {
    return [
      ...usedValues.map((value, index) =>
        row(november(1 + index), { metric_key: "fake.requests.month", kind: "usage", value, unit: "requests", currency: null, resets_at: MONTH_END.at }),
      ),
      row(november(usedValues.length), {
        metric_key: "fake.requests.included",
        kind: "included_allowance",
        label: "Requests included in the plan",
        value: included,
        unit: "requests",
        currency: null,
        resets_at: MONTH_END.at,
      }),
    ];
  }
  const KEY = "a1:fake.requests";

  it("gives the run-out date when usage reaches the allowance before the reset", () => {
    // 400 a day from 2,000 on 2026-11-05 06:00 reaches 3,000 two and a half days later.
    const result = projectAllowances(quota([400, 800, 1200, 1600, 2000]), NOW).get(KEY);
    expect(result?.label).toBe("Requests included in the plan");
    expect(result?.quota).toMatchObject({ status: "runs_out", at: "2026-11-07T18:00:00.000Z", included: 3000 });
  });

  it("says the allowance lasts when usage stays below it until the reset", () => {
    expect(projectAllowances(quota([10, 20, 30, 40, 50]), NOW).get(KEY)?.quota).toMatchObject({ status: "within" });
  });

  it("projects zero usage as lasting", () => {
    expect(projectAllowances(quota([0, 0, 0]), NOW).get(KEY)?.quota).toMatchObject({ status: "within", projection: { projected: 0 } });
  });

  it.each([
    { name: "exactly at", used: 3000 },
    { name: "over", used: 3500 },
  ])("reports a quota $name its limit as used up, without projecting", ({ used }) => {
    expect(projectAllowances(quota([used]), NOW).get(KEY)?.quota).toEqual({ status: "used_up", used, included: 3000, unit: "requests" });
  });

  it("projects a quota one unit below its limit", () => {
    expect(projectAllowances(quota([2997, 2998, 2999]), NOW).get(KEY)?.quota.status).toBe("runs_out");
  });

  it("projects nothing from fewer than 3 days", () => {
    expect(projectAllowances(quota([10, 20]), NOW).get(KEY)?.quota).toEqual({ status: "unavailable", reason: "too_few_days" });
  });

  it("leaves out an allowance of zero and one with no usage reading", () => {
    expect(projectAllowances(quota([1, 2, 3], 0), NOW).has(KEY)).toBe(false);
    const included = quota([1]).filter((candidate) => candidate.kind === "included_allowance");
    expect(projectAllowances(included, NOW).has(KEY)).toBe(false);
  });
});

describe("projectedToCross", () => {
  const spend = (amount: number): SpendProjection => ({
    currency: "USD",
    includesEstimates: false,
    projection: projected(projectSeries(points([0, amount / 2, amount], 1), { at: "2026-11-03T06:00:00.000Z", assumed: false }, new Date("2026-11-03T00:00:00.000Z"))),
  });

  it.each([
    { name: "above", amount: 10001, expected: true },
    { name: "exactly at", amount: 10000, expected: true },
    { name: "below", amount: 9999, expected: false },
  ])("is $expected for a projection $name the budget", ({ amount, expected }) => {
    expect(projectedToCross(spend(amount), 10000)).toBe(expected);
  });

  it("is null when nothing is projected", () => {
    expect(projectedToCross({ currency: "USD", includesEstimates: false, projection: { status: "unavailable", reason: "too_few_days" } }, 1)).toBeNull();
  });
});

describe("projectDashboard", () => {
  it("projects per connection and in total, skipping accounts that are not included", () => {
    const rows = [
      ...spendRows([100, 200, 300, 400, 500]),
      ...spendRows([1000, 2000, 3000], { connection_id: "c2", external_account_id: "a2" }),
      ...spendRows([5, 6, 7], { external_account_id: "excluded" }),
    ];
    const result = projectDashboard({
      snapshots: rows,
      connections: [
        { id: "c1", provider: "fake", display_name: "One", status: "active", last_synced_at: null, poll_interval_seconds: 3600, granted_scopes: [] },
        { id: "c2", provider: "vercel", display_name: "Two", status: "active", last_synced_at: null, poll_interval_seconds: 3600, granted_scopes: [] },
      ],
      accounts: [
        { id: "a1", connection_id: "c1", display_name: "A1", project_id: null },
        { id: "a2", connection_id: "c2", display_name: "A2", project_id: null },
      ],
      projects: [],
      now: NOW,
    });
    const minor = (list: readonly SpendProjection[] | undefined) =>
      projectedMinor(projected(list?.[0]?.projection ?? { status: "unavailable", reason: "too_few_days" }));
    expect(minor(result.byConnection.get("c1"))).toBe(3075);
    // c2: 3000 on 2026-11-03 06:00 plus 1000 a day for 27.75 days.
    expect(minor(result.byConnection.get("c2"))).toBe(30750);
    expect(minor(result.totals)).toBe(33825);
  });
});

describe("wording", () => {
  it("states the projection, the end date, and how it was calculated, without dashes", () => {
    const [usd] = projectSpend(spendRows([100, 200, 300, 400, 500]), NOW);
    if (usd === undefined) throw new Error("no projection");
    const text = spendProjectionText(usd);
    expect(text.headline).toBe("On track for $30.75 by 2026-11-30");
    expect(text.explanation).toBe(
      "Calculated by DevMacro, not reported by the provider: the average daily increase over the last 5 days with data (2026-11-01 to 2026-11-05), $1.00 a day, continued to the end of the period. It is never added to the spend shown.",
    );
    expect(`${text.headline} ${text.explanation}`).not.toMatch(DASHES);
  });

  it("names the calendar month assumption for a window to date", () => {
    // Stripe style: the stored window ends at the reading.
    const rows = spendRows([100, 200, 300]).map((candidate) => ({ ...candidate, period_end: candidate.retrieved_at }));
    const [usd] = projectSpend(rows, NOW);
    if (usd === undefined) throw new Error("no projection");
    expect(spendProjectionText(usd).explanation).toContain("DevMacro assumes it ends with the calendar month");
  });

  it("says why there is no projection", () => {
    expect(spendProjectionText({ currency: "USD", includesEstimates: false, projection: { status: "unavailable", reason: "too_few_days" } })).toEqual({
      headline: "Projection unavailable",
      explanation: "DevMacro needs at least 3 days of data in the current period to project it.",
    });
  });

  it("gives a run-out date as a UTC date and the reset in Europe/London", () => {
    const quota = projectAllowances(
      [400, 800, 1200, 1600, 2000]
        .map((value, index) =>
          row(november(1 + index), { metric_key: "fake.requests.month", kind: "usage", value, unit: "requests", currency: null, resets_at: MONTH_END.at }),
        )
        .concat(row(november(5), { metric_key: "fake.requests.included", kind: "included_allowance", value: 3000, unit: "requests", currency: null, resets_at: MONTH_END.at })),
      NOW,
    ).get("a1:fake.requests")?.quota;
    if (quota === undefined) throw new Error("no quota projection");
    const text = quotaProjectionText(quota);
    expect(text.headline).toBe("Runs out around 2026-11-07");
    expect(text.explanation).toContain("400 requests a day");
    expect(text.explanation).toContain("resets on 2026-12-01 00:00 GMT");
    expect(`${text.headline} ${text.explanation}`).not.toMatch(DASHES);
  });

  it("calls a used up allowance a reading, not an estimate", () => {
    expect(quotaProjectionText({ status: "used_up", used: 3000, included: 3000, unit: "emails" })).toEqual({
      headline: "Allowance used up",
      explanation: "3,000 emails used of 3,000 emails before the reset. This is the latest reading, not an estimate.",
    });
  });
});
