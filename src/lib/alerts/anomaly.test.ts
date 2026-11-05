import { describe, expect, it } from "vitest";

import type { TrendMeasure } from "@/lib/dashboard/trends";

import {
  addUtcDays,
  ANOMALY_TYPE_ID,
  anomalyEvent,
  anomalySnapshotRange,
  detectSpike,
  findAnomalies,
  minimumChange,
  unusualWords,
  type AnomalyConnection,
  type AnomalyRow,
} from "./anomaly";

const USD: TrendMeasure = { type: "money", currency: "USD" };
const EMAILS: TrendMeasure = { type: "quantity", unit: "emails" };
const WORKSPACE_ID = "22222222-2222-4222-8222-222222222222";
const VERCEL: AnomalyConnection = { id: "c0000000-0000-4000-8000-000000000001", provider: "vercel" };
const RESEND: AnomalyConnection = { id: "c0000000-0000-4000-8000-000000000002", provider: "resend" };
const ACCOUNT = "a0000000-0000-4000-8000-000000000001";
const DATE = "2026-10-20";

/** Runs detection on the last day of `series`, with every earlier day (up to 14) as history. */
function lastDay(series: readonly (number | null)[], measure: TrendMeasure = USD) {
  return detectSpike(series.slice(-15, -1), series.at(-1) ?? null, measure);
}

/** Which days of `series` fire, checking each day against the 14 before it. */
function firingDays(series: readonly number[], measure: TrendMeasure = USD): number[] {
  const fired: number[] = [];
  for (let day = 0; day < series.length; day += 1) {
    if (detectSpike(series.slice(Math.max(0, day - 14), day), series[day] ?? null, measure) !== null) fired.push(day);
  }
  return fired;
}

describe("detectSpike", () => {
  it("never fires on a flat series, with or without small noise", () => {
    expect(firingDays(Array.from({ length: 30 }, () => 10_000))).toEqual([]);
    expect(firingDays(Array.from({ length: 30 }, (_, day) => 10_000 + ((day * 37) % 7) * 150))).toEqual([]);
    expect(firingDays(Array.from({ length: 30 }, () => 0))).toEqual([]);
  });

  it("fires once for a single spike, and a past spike does not hide the next one", () => {
    const series = Array.from({ length: 40 }, (_, day) => (day === 20 ? 40_000 : 10_000 + (day % 3) * 200));
    expect(firingDays(series)).toEqual([20]);
    const twoSpikes = series.map((value, day) => (day === 25 ? 40_000 : value));
    expect(firingDays(twoSpikes)).toEqual([20, 25]);
  });

  it("does not fire on a gradual ramp, linear or compounding", () => {
    expect(firingDays(Array.from({ length: 40 }, (_, day) => 10_000 + day * 500))).toEqual([]);
    expect(firingDays(Array.from({ length: 40 }, (_, day) => Math.round(10_000 * 1.08 ** day)))).toEqual([]);
  });

  it("does not fire on a weekly rhythm of quiet weekends", () => {
    expect(firingDays(Array.from({ length: 40 }, (_, day) => (day % 7 >= 5 ? 4_000 : 10_000)))).toEqual([]);
  });

  it("needs at least 7 days of history: 6 never fire, 7 do", () => {
    expect(lastDay([1000, 1000, 1000, 1000, 1000, 1000, 9000])).toBeNull();
    expect(lastDay([1000, 1000, 1000, 1000, 1000, 1000, 1000, 9000])).toMatchObject({ value: 9000, usual: 1000, historyDays: 7 });
    // Unavailable days do not count toward the 7.
    expect(lastDay([1000, null, 1000, 1000, 1000, 1000, 1000, 1000, 9000])).toMatchObject({ historyDays: 7 });
    expect(lastDay([1000, null, null, 1000, 1000, 1000, 1000, 1000, 9000])).toBeNull();
  });

  it("never fires when the day itself is unavailable", () => {
    expect(lastDay([...Array.from({ length: 14 }, () => 1000), null])).toBeNull();
  });

  it("does not fire under the minimum change, and fires at exactly the minimum", () => {
    // $0.10 a day jumping to $4.99 is fifty times the usual and still not worth an alert.
    expect(lastDay([...Array.from({ length: 14 }, () => 10), 509])).toBeNull();
    expect(lastDay([...Array.from({ length: 14 }, () => 10), 510])).toMatchObject({ value: 510, usual: 10 });
    expect(lastDay([...Array.from({ length: 14 }, () => 5), 54], EMAILS)).toBeNull();
    expect(lastDay([...Array.from({ length: 14 }, () => 5), 55], EMAILS)).not.toBeNull();
  });

  it("needs at least twice the usual amount", () => {
    const history = Array.from({ length: 14 }, () => 100_000);
    expect(lastDay([...history, 199_999])).toBeNull();
    expect(lastDay([...history, 200_000])).toMatchObject({ ratio: 2 });
  });

  it("reports no ratio when the usual amount is zero", () => {
    expect(lastDay([...Array.from({ length: 14 }, () => 0), 600], EMAILS)).toMatchObject({ usual: 0, ratio: null });
  });
});

describe("minimumChange", () => {
  it("is five whole units of the currency, in its own minor digits", () => {
    expect(minimumChange(USD)).toBe(500);
    expect(minimumChange({ type: "money", currency: "JPY" })).toBe(5);
  });

  it("is 50 for counts and smaller for data sizes", () => {
    expect(minimumChange(EMAILS)).toBe(50);
    expect(minimumChange({ type: "quantity", unit: "GB" })).toBe(1);
  });
});

function row(fields: Partial<AnomalyRow> & Pick<AnomalyRow, "snapshot_date">): AnomalyRow {
  return {
    connection_id: VERCEL.id,
    external_account_id: ACCOUNT,
    metric_key: "vercel.spend.total",
    kind: "verified_spend",
    label: "Vercel billed spend, month to date",
    value: null,
    unit: null,
    amount_minor: null,
    currency: "USD",
    period_start: "2026-10-01T00:00:00.000Z",
    period_end: "2026-11-01T00:00:00.000Z",
    point_at: null,
    retrieved_at: `${fields.snapshot_date}T23:59:50.000Z`,
    provenance_source: "provider_api",
    ...fields,
  };
}

/** Month to date rows from 2026-10-01 to DATE, adding `daily(day)` minor units each day. */
function monthToDate(daily: (date: string) => number, fields: Partial<AnomalyRow> = {}): AnomalyRow[] {
  const rows: AnomalyRow[] = [];
  let total = 0;
  for (let date = "2026-10-01"; date <= DATE; date = addUtcDays(date, 1)) {
    total += daily(date);
    rows.push(row({ snapshot_date: date, amount_minor: total, ...fields }));
  }
  return rows;
}

describe("findAnomalies", () => {
  const spikeOnDate = (date: string) => (date === DATE ? 40_000 : 10_000);

  it("turns a month to date total into daily amounts and names the spike", () => {
    const anomalies = findAnomalies({ date: DATE, rows: monthToDate(spikeOnDate), connections: [VERCEL], mutes: [] });
    expect(anomalies).toEqual([
      expect.objectContaining({
        date: DATE,
        provider: "vercel",
        metricKey: "vercel.spend.total",
        value: 40_000,
        usual: 10_000,
        ratio: 4,
        source: "verified",
        accrual: "period_to_date",
        connectionId: VERCEL.id,
        externalAccountId: ACCOUNT,
      }),
    ]);
  });

  it("finds nothing on a normal day after the spike", () => {
    const rows = monthToDate((date) => (date === "2026-10-18" ? 40_000 : 10_000));
    expect(findAnomalies({ date: DATE, rows, connections: [VERCEL], mutes: [] })).toEqual([]);
  });

  it("skips the first day of a period, where once a period charges land", () => {
    const rows = monthToDate(() => 10_000).map((snapshot) =>
      snapshot.snapshot_date === "2026-10-01" ? { ...snapshot, amount_minor: 90_000 } : snapshot,
    );
    expect(findAnomalies({ date: "2026-10-01", rows, connections: [VERCEL], mutes: [] })).toEqual([]);
  });

  it("reads a running total whose period ends tomorrow, one day long on the 1st, as month to date", () => {
    const rows = monthToDate(spikeOnDate).map((snapshot) => ({
      ...snapshot,
      period_end: `${addUtcDays(snapshot.snapshot_date, 1)}T00:00:00.000Z`,
    }));
    const [anomaly] = findAnomalies({ date: DATE, rows, connections: [VERCEL], mutes: [] });
    expect(anomaly).toMatchObject({ value: 40_000, usual: 10_000, accrual: "period_to_date" });
  });

  it("treats a running total that went down as unavailable, not as a spike the day after", () => {
    const rows = monthToDate(spikeOnDate).map((snapshot) =>
      snapshot.snapshot_date === addUtcDays(DATE, -1) ? { ...snapshot, amount_minor: 0 } : snapshot,
    );
    expect(findAnomalies({ date: DATE, rows, connections: [VERCEL], mutes: [] })).toEqual([]);
  });

  it("dates a one day period by its own day, even when it is read the day after", () => {
    const rows = Array.from({ length: 15 }, (_, index) => {
      const day = addUtcDays(DATE, index - 14);
      return row({
        connection_id: RESEND.id,
        metric_key: "resend.emails.daily",
        kind: "usage",
        label: "Emails sent",
        currency: null,
        unit: "emails",
        value: day === DATE ? 4000 : 1000,
        snapshot_date: addUtcDays(day, 1),
        period_start: `${day}T00:00:00.000Z`,
        period_end: `${addUtcDays(day, 1)}T00:00:00.000Z`,
      });
    });
    const [anomaly] = findAnomalies({ date: DATE, rows, connections: [RESEND], mutes: [] });
    expect(anomaly).toMatchObject({ value: 4000, usual: 1000, accrual: "daily", measure: EMAILS });
  });

  it("keeps verified and estimated values apart and labels which one fired", () => {
    const estimated = monthToDate(spikeOnDate, { kind: "estimated_spend", provenance_source: "derived", metric_key: "vercel.spend.estimate" });
    const verified = monthToDate(() => 10_000);
    const anomalies = findAnomalies({ date: DATE, rows: [...verified, ...estimated], connections: [VERCEL], mutes: [] });
    expect(anomalies.map((anomaly) => [anomaly.metricKey, anomaly.source])).toEqual([["vercel.spend.estimate", "estimated"]]);
  });

  it("never fires a breakdown beside its total or its parent", () => {
    const rows = [
      ...monthToDate(spikeOnDate),
      ...monthToDate(spikeOnDate, { metric_key: "vercel.spend.usage" }),
      ...monthToDate(spikeOnDate, { metric_key: "github.spend.actions", connection_id: "gh" }),
      ...monthToDate(spikeOnDate, { metric_key: "github.spend.actions.actions_linux", connection_id: "gh" }),
    ];
    const github: AnomalyConnection = { id: "gh", provider: "github" };
    const keys = findAnomalies({ date: DATE, rows, connections: [VERCEL, github], mutes: [] }).map((anomaly) => anomaly.metricKey);
    expect(keys).toEqual(["github.spend.actions", "vercel.spend.total"]);
  });

  it("skips muted metrics, allowances, point in time readings, and unknown connections", () => {
    const allowance = monthToDate(spikeOnDate, { kind: "included_allowance", metric_key: "vercel.allowance.included" });
    const point = monthToDate(spikeOnDate, { metric_key: "vercel.spend.point", period_start: null, period_end: null, point_at: `${DATE}T12:00:00.000Z` });
    const stranger = monthToDate(spikeOnDate, { connection_id: "unknown", metric_key: "vercel.spend.other" });
    expect(findAnomalies({ date: DATE, rows: [...allowance, ...point, ...stranger], connections: [VERCEL], mutes: [] })).toEqual([]);
    expect(
      findAnomalies({ date: DATE, rows: monthToDate(spikeOnDate), connections: [VERCEL], mutes: [{ provider: "vercel", metric_key: "vercel.spend.total" }] }),
    ).toEqual([]);
  });

  it("adds accounts up, and a missing account makes the day unavailable", () => {
    const other = "a0000000-0000-4000-8000-000000000002";
    const first = monthToDate(spikeOnDate);
    const second = monthToDate(() => 10_000, { external_account_id: other });
    const [anomaly] = findAnomalies({ date: DATE, rows: [...first, ...second], connections: [VERCEL], mutes: [] });
    expect(anomaly).toMatchObject({ value: 50_000, usual: 20_000, externalAccountId: null, connectionId: VERCEL.id });
    const gap = second.filter((snapshot) => snapshot.snapshot_date !== DATE);
    expect(findAnomalies({ date: DATE, rows: [...first, ...gap], connections: [VERCEL], mutes: [] })).toEqual([]);
  });
});

describe("anomaly event", () => {
  const [anomaly] = findAnomalies({
    date: DATE,
    rows: monthToDate((date) => (date === DATE ? 41_200 : 10_300)),
    connections: [VERCEL],
    mutes: [],
  });
  if (anomaly === undefined) throw new Error("expected an anomaly");

  it("names the provider, the metric, the day's value, the usual value, and what to do next", () => {
    const event = anomalyEvent(WORKSPACE_ID, anomaly);
    expect(event).toMatchObject({
      workspace_id: WORKSPACE_ID,
      provider: "vercel",
      connection_id: VERCEL.id,
      type_id: ANOMALY_TYPE_ID,
      severity: "warning",
      title: "Unusual spend on Vercel: 4 times the usual daily spend",
      occurred_at: "2026-10-21T00:00:00.000Z",
      dedupe_key: "anomaly:2026-10-20:vercel:vercel.spend.total:money:USD:verified",
    });
    expect(event.body).toBe(
      [
        "Vercel billed spend, month to date (verified) went up by $412.00 on 2026-10-20. The usual amount is $103.00 a day, the median of the 14 days before.",
        "What to do next: open Vercel to see what drove it, check the timeline for deploys on 2026-10-20, or mute this metric on the Alerts page if it was expected.",
      ].join("\n"),
    );
    expect(`${event.title} ${event.body}`).not.toMatch(/[\u2013\u2014]/);
  });

  it("words the ratio plainly at its edges", () => {
    expect(unusualWords({ ratio: 2.54, usual: 100, measure: USD })).toBe("2.5 times the usual daily spend");
    expect(unusualWords({ ratio: 12.6, usual: 100, measure: EMAILS })).toBe("13 times the usual daily usage");
    expect(unusualWords({ ratio: null, usual: 0, measure: USD })).toBe("up from a usual $0.00 a day");
  });

  it("loads one day before the window and one day after the checked day", () => {
    expect(anomalySnapshotRange(DATE)).toEqual({ from: "2026-10-05", to: "2026-10-21" });
  });
});
