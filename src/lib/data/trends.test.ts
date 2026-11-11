import type * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { trendWindowStart, type TrendGranularity } from "@/lib/dashboard/trends";
import { EMPTY_SCOPE } from "@/lib/filters/scope";

import { getDashboardData, snapshotWindowStart } from "./dashboard";
import { getTrendData } from "./trends";

/*
 * One dashboard request reads each snapshot row once (#263), against in-memory tables that apply
 * the filters, order, and range the data layer asks for. Every `usage_snapshots` request is
 * recorded with its date bounds, so the tests check what was read rather than which builder
 * methods were called.
 */

type Value = string | number | boolean | null;
type Row = Record<string, Value>;
type Result = { data: Row[]; error: null };
type SnapshotRequest = { since: string | null; before: string | null };

const db = vi.hoisted(() => ({
  tables: {} as Record<string, Row[]>,
  snapshotRequests: [] as SnapshotRequest[],
  /** Bumped per test: React's `cache` memoizes for one server request, so each test is one request. */
  request: 0,
}));

// Vitest resolves the client build of React, whose `cache` does not memoize outside a server
// render. This stands in for the server build: one memo per cached function and request, keyed by
// the primitive arguments.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    cache: <Args extends Value[], Output>(fn: (...args: Args) => Output) => {
      let memo = new Map<string, Output>();
      let request = db.request;
      return (...args: Args): Output => {
        if (request !== db.request) {
          memo = new Map();
          request = db.request;
        }
        const key = JSON.stringify(args);
        const hit = memo.get(key);
        if (hit !== undefined) return hit;
        const result = fn(...args);
        memo.set(key, result);
        return result;
      };
    },
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from(table: string) {
      const rows = db.tables[table];
      if (rows === undefined) throw new Error(`Unexpected table ${table}`);
      const filters: Array<(row: Row) => boolean> = [];
      const bounds: SnapshotRequest = { since: null, before: null };
      const orderBy: Array<{ column: string; ascending: boolean }> = [];
      let from = 0;
      let to = Number.POSITIVE_INFINITY;
      const builder = {
        select: () => builder,
        eq(column: string, value: Value) {
          filters.push((row) => row[column] === value);
          return builder;
        },
        gte(column: string, value: string) {
          if (column === "snapshot_date") bounds.since = value;
          filters.push((row) => String(row[column]) >= value);
          return builder;
        },
        lt(column: string, value: string) {
          if (column === "snapshot_date") bounds.before = value;
          filters.push((row) => String(row[column]) < value);
          return builder;
        },
        in(column: string, values: readonly Value[]) {
          filters.push((row) => values.includes(row[column] ?? null));
          return builder;
        },
        order(column: string, { ascending }: { ascending: boolean }) {
          orderBy.push({ column, ascending });
          return builder;
        },
        limit(count: number) {
          to = count - 1;
          return builder;
        },
        range(start: number, end: number) {
          from = start;
          to = end;
          return builder;
        },
        then(resolve: (value: Result) => unknown) {
          if (table === "usage_snapshots") db.snapshotRequests.push(bounds);
          const matched = rows
            .filter((row) => filters.every((keep) => keep(row)))
            .sort((a, b) => {
              for (const { column, ascending } of orderBy) {
                const compared = String(a[column] ?? "").localeCompare(String(b[column] ?? ""));
                if (compared !== 0) return ascending ? compared : -compared;
              }
              return 0;
            })
            .slice(from, to + 1);
          return Promise.resolve({ data: matched, error: null }).then(resolve);
        },
      };
      return builder;
    },
  }),
}));

const WORKSPACE = "26300000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE = "26300000-0000-4000-8000-000000000002";
const CONNECTION = "26300000-0000-4000-8000-0000000000c1";
const ACCOUNT = "26300000-0000-4000-8000-0000000000a1";

// 45 days before 2026-11-11 is 2026-09-27; 13 months of trends start on 2025-11-01.
const NOW = new Date("2026-11-11T12:00:00.000Z");
const WINDOW_START = "2026-09-27";
const TREND_START = "2025-11-01";

function snapshot(date: string, workspaceId = WORKSPACE): Row {
  return {
    id: `${workspaceId}-${date}`,
    workspace_id: workspaceId,
    connection_id: CONNECTION,
    external_account_id: ACCOUNT,
    metric_key: "spend",
    kind: "verified_spend",
    snapshot_date: date,
    amount_minor: 100,
    currency: "USD",
  };
}

const SNAPSHOT_DATES = ["2026-11-11", WINDOW_START, "2026-09-26", "2026-01-15", TREND_START, "2025-10-31"];

function dates(rows: ReadonlyArray<{ snapshot_date: string }>): string[] {
  return rows.map((row) => row.snapshot_date);
}

/** The page's reads for one request: the dashboard window and the trends, with the same `now`. */
async function dashboardRequest(granularity: TrendGranularity) {
  const [dashboard, trends] = await Promise.all([
    getDashboardData(WORKSPACE, snapshotWindowStart(NOW), EMPTY_SCOPE),
    getTrendData(WORKSPACE, granularity, NOW, EMPTY_SCOPE),
  ]);
  return { dashboard, trends };
}

beforeEach(() => {
  db.request += 1;
  db.snapshotRequests = [];
  db.tables = {
    connections: [{ id: CONNECTION, workspace_id: WORKSPACE, provider: "github", created_at: "2026-01-01T00:00:00.000Z" }],
    external_accounts: [{ id: ACCOUNT, workspace_id: WORKSPACE, connection_id: CONNECTION, included: true, project_id: null }],
    projects: [],
    usage_snapshots: [...SNAPSHOT_DATES.map((date) => snapshot(date)), snapshot("2026-11-10", OTHER_WORKSPACE)],
  };
});

describe("getTrendData", () => {
  it("matches the windows the page computes from the same now", () => {
    expect(snapshotWindowStart(NOW)).toBe(WINDOW_START);
    expect(trendWindowStart(NOW)).toBe(TREND_START);
  });

  it("daily: shares the dashboard's one read and reads nothing older than the window start", async () => {
    const { dashboard, trends } = await dashboardRequest("daily");
    expect(db.snapshotRequests).toEqual([{ since: WINDOW_START, before: null }]);
    // The window's first day is in; the day before it is not.
    expect(dates(trends.snapshots)).toEqual(["2026-11-11", WINDOW_START]);
    expect(dates(dashboard.snapshots)).toEqual(dates(trends.snapshots));
  });

  it("monthly: adds one read that stops before the window start, newest first, with no row twice", async () => {
    const { dashboard, trends } = await dashboardRequest("monthly");
    expect(db.snapshotRequests).toHaveLength(2);
    expect(db.snapshotRequests).toEqual(
      expect.arrayContaining([
        { since: WINDOW_START, before: null },
        { since: TREND_START, before: WINDOW_START },
      ]),
    );
    // Both window edges are in, each once; the day before the trend window is not.
    expect(dates(trends.snapshots)).toEqual(["2026-11-11", WINDOW_START, "2026-09-26", "2026-01-15", TREND_START]);
    expect(dates(dashboard.snapshots)).toEqual(["2026-11-11", WINDOW_START]);
  });

  it.each<TrendGranularity>(["daily", "monthly"])("%s: returns no rows for a workspace with no snapshots", async (granularity) => {
    db.tables.usage_snapshots = [snapshot("2026-11-10", OTHER_WORKSPACE)];
    const { dashboard, trends } = await dashboardRequest(granularity);
    expect(trends.snapshots).toEqual([]);
    expect(dashboard.snapshots).toEqual([]);
    expect(db.snapshotRequests).toHaveLength(granularity === "daily" ? 1 : 2);
  });
});
