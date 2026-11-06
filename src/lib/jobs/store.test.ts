import { afterEach, describe, expect, it, vi } from "vitest";

import { addUtcDays, anomalySnapshotRange, findAnomalies, type AnomalyConnection, type AnomalyRow } from "@/lib/alerts/anomaly";
import { log } from "@/lib/log/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { fakeSupabase, MAX_ROWS, type Row } from "@/lib/supabase/fake-postgrest";

import { ANOMALY_ROW_LIMIT, createSupabaseJobStore } from "./store";

/*
 * The Supabase job store's anomaly read (#219) against the fake PostgREST
 * (src/lib/supabase/fake-postgrest.ts), which answers at most `max_rows` rows per request like the
 * real Data API. The rows then go through findAnomalies, the way the daily summary job uses them.
 */

vi.mock("@/lib/supabase/admin");

const WORKSPACE_ID = "21900000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE_ID = "21900000-0000-4000-8000-000000000002";
const VERCEL: AnomalyConnection = { id: "21900000-0000-4000-8000-000000000003", provider: "vercel" };
// The summarized day. Its month to date total is checked on it, against 2026-10-02 to 2026-10-13.
const DATE = "2026-10-14";
const USUAL_DAILY_MINOR = 10_000;
const SPIKE_DAILY_MINOR = 40_000;

type StoredRow = AnomalyRow & Readonly<{ id: string; workspace_id: string }>;

function uuid(prefix: number, index: number): string {
  return `${String(prefix).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/**
 * `accountCount` Vercel accounts, each with a month to date spend total from 2026-10-01 to DATE
 * that grows $100.00 a day and $400.00 on DATE: one series, summed over the accounts, that spikes
 * on DATE. Row ids follow the account, so within one day the store's id order is account order.
 */
function vercelSpend(accountCount: number): StoredRow[] {
  return Array.from({ length: accountCount }, (_, account) => {
    const rows: StoredRow[] = [];
    let total = 0;
    for (let day = 0, date = "2026-10-01"; date <= DATE; day += 1, date = addUtcDays(date, 1)) {
      total += date === DATE ? SPIKE_DAILY_MINOR : USUAL_DAILY_MINOR;
      rows.push({
        id: uuid(account + 1, day),
        workspace_id: WORKSPACE_ID,
        connection_id: VERCEL.id,
        external_account_id: uuid(0, account),
        metric_key: "vercel.spend.total",
        kind: "verified_spend",
        label: "Vercel billed spend, month to date",
        snapshot_date: date,
        value: null,
        unit: null,
        amount_minor: total,
        currency: "USD",
        period_start: "2026-10-01T00:00:00.000Z",
        period_end: "2026-11-01T00:00:00.000Z",
        point_at: null,
        resets_at: null,
        retrieved_at: `${date}T23:59:50.000Z`,
        provenance_source: "provider_api",
        pricing_source: null,
      });
    }
    return rows;
  }).flat();
}

/** The columns the store selects, so a stored row compares with what the read returns. */
function asRead({ id: _id, workspace_id: _workspace, ...row }: StoredRow): AnomalyRow {
  return row;
}

/** Oldest day first, then by id: the order a complete read hands to findAnomalies. */
function oldestFirst(rows: readonly StoredRow[]): StoredRow[] {
  return rows.toSorted((a, b) => a.snapshot_date.localeCompare(b.snapshot_date) || a.id.localeCompare(b.id));
}

function storeOver(rows: readonly Row[]) {
  const { db, requests } = fakeSupabase({ usage_snapshots: rows });
  vi.mocked(createAdminClient).mockReturnValue(db);
  return { store: createSupabaseJobStore(), requests };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSupabaseJobStore listAnomalySnapshots", () => {
  it("returns every spend and usage row of the range once, oldest day first, and the spike on the checked day fires", async () => {
    const spend = vercelSpend(3);
    const [first] = spend;
    if (first === undefined) throw new Error("expected spend rows");
    const kept: StoredRow[] = [
      ...spend,
      // One reading of each other kind detection reads; a single day has no history, so neither fires.
      { ...first, id: uuid(8, 1), metric_key: "vercel.spend.estimate", kind: "estimated_spend", label: "Vercel estimated spend", snapshot_date: "2026-10-05" },
      {
        ...first,
        id: uuid(8, 2),
        metric_key: "vercel.usage.bandwidth",
        kind: "usage",
        label: "Vercel bandwidth",
        value: 12,
        unit: "GB",
        amount_minor: null,
        currency: null,
      },
    ];
    const skipped: StoredRow[] = [
      // Another workspace, a point in time reading, a level, and a day before the range.
      { ...first, id: uuid(9, 1), workspace_id: OTHER_WORKSPACE_ID },
      { ...first, id: uuid(9, 2), point_at: `${DATE}T12:00:00.000Z` },
      { ...first, id: uuid(9, 3), kind: "credit_balance" },
      { ...first, id: uuid(9, 4), snapshot_date: addUtcDays(anomalySnapshotRange(DATE).from, -1) },
    ];
    const { store } = storeOver([...skipped, ...kept].toReversed());
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const range = anomalySnapshotRange(DATE);

    const rows = await store.listAnomalySnapshots(WORKSPACE_ID, range.from, range.to);

    expect(rows).toEqual(oldestFirst(kept).map(asRead));
    expect(warn).not.toHaveBeenCalled();
    expect(findAnomalies({ date: DATE, rows, connections: [VERCEL], mutes: [] })).toEqual([
      expect.objectContaining({ date: DATE, metricKey: "vercel.spend.total", value: 3 * SPIKE_DAILY_MINOR, usual: 3 * USUAL_DAILY_MINOR }),
    ]);
  });

  it("keeps the newest day when the range holds more rows than the bound, logs the cut, and the spike on that day still fires (boundary: ANOMALY_ROW_LIMIT)", async () => {
    // 1500 accounts over 14 days: 21,000 rows, so the read stops 1000 rows short. Read oldest first,
    // those 1000 were DATE's rows of 1000 accounts, so the checked day had no total to compare.
    const spend = vercelSpend(1500);
    expect(spend.length).toBe(ANOMALY_ROW_LIMIT + 1000);
    const { store, requests } = storeOver(spend);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const range = anomalySnapshotRange(DATE);

    const rows = await store.listAnomalySnapshots(WORKSPACE_ID, range.from, range.to);

    // Newest first, then by id, the read leaves out 2026-10-01's rows of the last 1000 accounts.
    const left = new Set(spend.filter((row) => row.snapshot_date === "2026-10-01").slice(-1000));
    expect(rows).toEqual(oldestFirst(spend.filter((row) => !left.has(row))).map(asRead));
    expect(rows.filter((row) => row.snapshot_date === DATE)).toHaveLength(1500);
    expect(requests).toHaveLength(ANOMALY_ROW_LIMIT / MAX_ROWS);
    expect(warn).toHaveBeenCalledExactlyOnceWith("anomaly.snapshots_truncated", { workspaceId: WORKSPACE_ID, rows: ANOMALY_ROW_LIMIT });
    // 2026-10-02 loses its day before for those accounts and is unavailable, leaving 11 history days.
    expect(findAnomalies({ date: DATE, rows, connections: [VERCEL], mutes: [] })).toEqual([
      expect.objectContaining({
        date: DATE,
        metricKey: "vercel.spend.total",
        value: 1500 * SPIKE_DAILY_MINOR,
        usual: 1500 * USUAL_DAILY_MINOR,
        historyDays: 11,
      }),
    ]);
  });
});
