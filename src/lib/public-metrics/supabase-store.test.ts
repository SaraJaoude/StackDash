import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log/logger";
import { fakeSupabase, MAX_ROWS, type Row } from "@/lib/supabase/fake-postgrest";

import { computePublicMetrics, SNAPSHOT_READ_MAX_ROWS, type SnapshotPoint } from "./engine";
import { MemoryMetricStore } from "./memory-store";
import { createSupabaseMetricStore } from "./supabase-store";
import { computeTrend } from "./trend";

/*
 * The Supabase store against the fake PostgREST (src/lib/supabase/fake-postgrest.ts), which answers
 * at most `max_rows` rows per request and says nothing about the rows it left out (#209). Every
 * result is compared with the in-memory store holding the same rows: the engine's own answer for
 * that data.
 */

const AS_OF = new Date("2026-11-05T12:00:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WORKSPACE_ID = "20900000-0000-4000-8000-000000000001";
const PROJECT_ID = "20900000-0000-4000-8000-000000000002";
const CONNECTION_ID = "20900000-0000-4000-8000-000000000003";
const STARS = "github.stars.total";

function uuid(prefix: number, index: number): string {
  return `${String(prefix).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** `accountCount` GitHub accounts of one project, each with a star count per day for `dayCount` days. */
function starWorkspace(accountCount: number, dayCount: number) {
  const accountIds = Array.from({ length: accountCount }, (_, index) => uuid(1, index));
  const points: SnapshotPoint[] = accountIds.flatMap((accountId, index) =>
    Array.from({ length: dayCount }, (_, day): SnapshotPoint => {
      const retrievedAt = new Date(AS_OF.getTime() - day * DAY_MS - HOUR_MS);
      return {
        accountId,
        metricKey: STARS,
        snapshotDate: retrievedAt.toISOString().slice(0, 10),
        value: 5000 + index * 10 - day * (1 + (index % 3)),
        periodStart: null,
        periodEnd: null,
        resetsAt: null,
        retrievedAt,
      };
    }),
  );
  const snapshotRows: Row[] = points.map((point, index) => ({
    id: uuid(2, index),
    workspace_id: WORKSPACE_ID,
    external_account_id: point.accountId,
    metric_key: point.metricKey,
    kind: "usage",
    snapshot_date: point.snapshotDate,
    value: point.value,
    period_start: null,
    period_end: null,
    resets_at: null,
    retrieved_at: point.retrievedAt.toISOString(),
  }));
  const { db, requests } = fakeSupabase({
    external_accounts: accountIds.map((id) => ({ id, connection_id: CONNECTION_ID, workspace_id: WORKSPACE_ID, project_id: PROJECT_ID, included: true })),
    connections: [
      {
        id: CONNECTION_ID,
        workspace_id: WORKSPACE_ID,
        provider: "github",
        status: "active",
        created_at: "2026-01-01T00:00:00.000Z",
        last_synced_at: AS_OF.toISOString(),
        granted_scopes: [],
      },
    ],
    usage_snapshots: snapshotRows,
  });
  const store = createSupabaseMetricStore(db, WORKSPACE_ID, PROJECT_ID);
  return { store, points, accountIds, requests };
}

/** `count` daily moments ending at AS_OF, oldest first. */
function days(count: number): Date[] {
  return Array.from({ length: count }, (_, index) => new Date(AS_OF.getTime() - (count - 1 - index) * DAY_MS));
}

/** Every row of the workspace in the store's order: newest day first, then by id (account order here). */
function newestFirst(points: readonly SnapshotPoint[]): SnapshotPoint[] {
  return points.toSorted((a, b) => b.snapshotDate.localeCompare(a.snapshotDate));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSupabaseMetricStore snapshots", () => {
  it("gives a card trend the same numbers as the rows hold when its window has more rows than one request returns (boundary: max_rows)", async () => {
    // 30 accounts over 37 days: 1110 rows, so one request is cut part way through a day.
    const { store, points } = starWorkspace(30, 37);
    expect(points.length).toBeGreaterThan(MAX_ROWS);
    const truth = new MemoryMetricStore(await store.accounts(), points, []);
    const moments = days(7);
    expect(await computeTrend(store, "github-stars-gained-30d", moments)).toEqual(await computeTrend(truth, "github-stars-gained-30d", moments));
  });

  it.each([
    { name: "empty", accounts: 5, days: 0, requests: 1 },
    { name: "one short page", accounts: 10, days: 37, requests: 1 },
    { name: "exactly max_rows", accounts: 25, days: 40, requests: 2 },
    { name: "one row past max_rows", accounts: 7, days: 143, requests: 2 },
    { name: "several pages", accounts: 25, days: 100, requests: 3 },
  ])("returns every row of the window once, newest first, in requests of at most max_rows (boundary: $name)", async ({ accounts, days: dayCount, requests: expected }) => {
    const { store, points, accountIds, requests } = starWorkspace(accounts, dayCount);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const rows = await store.snapshots({ accountIds, metricKeys: [STARS], fromDate: "2026-01-01", toDate: "2026-11-05" });
    expect(rows).toEqual(newestFirst(points));
    const reads = requests.filter((request) => request.table === "usage_snapshots");
    expect(reads).toHaveLength(expected);
    expect(reads.every((request) => request.limit !== null && request.limit <= MAX_ROWS)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops at SNAPSHOT_READ_MAX_ROWS, keeps the newest days, and logs the cut (boundary: more rows than the bound)", async () => {
    // 150 accounts over 70 days: 10,500 rows.
    const { store, points, accountIds, requests } = starWorkspace(150, 70);
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const rows = await store.snapshots({ accountIds, metricKeys: [STARS], fromDate: "2026-01-01", toDate: "2026-11-05" });
    expect(rows).toEqual(newestFirst(points).slice(0, SNAPSHOT_READ_MAX_ROWS));
    expect(requests.filter((request) => request.table === "usage_snapshots")).toHaveLength(SNAPSHOT_READ_MAX_ROWS / MAX_ROWS);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "public_metrics.snapshots_truncated",
      expect.objectContaining({ workspaceId: WORKSPACE_ID, projectId: PROJECT_ID, rows: SNAPSHOT_READ_MAX_ROWS }),
    );
  });

  it("gives no trend point where a window reaches the day the bound cut, and the rows' own number elsewhere (boundary: SNAPSHOT_READ_MAX_ROWS)", async () => {
    // 150 accounts over 70 days: the read stops after 66 whole days and 100 accounts of the next.
    const { store, points } = starWorkspace(150, 70);
    vi.spyOn(log, "warn").mockImplementation(() => undefined);
    const truth = new MemoryMetricStore(await store.accounts(), points, []);
    const moments = days(40);
    const trend = await computeTrend(store, "github-stars-gained-30d", moments);
    const expected = await Promise.all(
      moments.map(async (asOf, index) => {
        // The four oldest moments' 30 day windows start on the cut day or before it.
        if (index < 4) return null;
        const [computed] = await computePublicMetrics(truth, [{ metricId: "github-stars-gained-30d", asOf }]);
        return computed;
      }),
    );
    expect(trend).toEqual(expected);
    expect(trend[4]?.result).toMatchObject({ status: "available" });
  });
});
