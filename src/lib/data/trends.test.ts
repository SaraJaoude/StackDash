import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import { snapshotWindowStart } from "@/lib/dashboard/aggregate";
import { trendWindowStart, type TrendGranularity } from "@/lib/dashboard/trends";
import { EMPTY_SCOPE } from "@/lib/filters/scope";
import { log } from "@/lib/log/logger";
import { fakeSupabase, type PageRequest, type Row } from "@/lib/supabase/fake-postgrest";

import { getDashboardData } from "./dashboard";
import { getTrendData } from "./trends";

/*
 * One dashboard request reads each snapshot row once (#263), against the fake PostgREST
 * (src/lib/supabase/fake-postgrest.ts) under the real supabase-js client, so the filters, order,
 * and range are the ones the data layer sends. The fake records each request's filters, so the
 * tests check the date bounds of every `usage_snapshots` read rather than which builder methods
 * were called.
 */

type Primitive = string | number | boolean | null;

const state = vi.hoisted(() => ({
  db: null as unknown,
  /** Bumped per test: React's `cache` memoizes for one server request, so each test is one request. */
  request: 0,
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.db }));

// Vitest resolves the client build of React, whose `cache` does not memoize outside a server
// render. This stands in for the server build: one memo per cached function and request, keyed by
// the primitive arguments.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof React>();
  return {
    ...actual,
    cache: <Args extends Primitive[], Output>(fn: (...args: Args) => Output) => {
      let memo = new Map<string, Output>();
      let request = state.request;
      return (...args: Args): Output => {
        if (request !== state.request) {
          memo = new Map();
          request = state.request;
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

let requests: readonly PageRequest[] = [];

const MONTHLY_FUNCTION = "usage_snapshot_monthly_latest";

/**
 * What `usage_snapshot_monthly_latest` returns for `rows`: those of `workspaceId` dated `since` or
 * later, newest per account, metric, UTC month, currency, and unit. The database test
 * (supabase/tests/database/24_usage_snapshot_monthly_latest.test.sql) checks the function itself.
 */
function monthlyLatest(rows: readonly Row[], workspaceId: unknown, since: unknown): Row[] {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const date = String(row.snapshot_date);
    if (row.workspace_id !== workspaceId || typeof since !== "string" || date < since) continue;
    const key = [row.external_account_id, row.metric_key, date.slice(0, 7), row.currency, row.unit].join(" ");
    const current = latest.get(key);
    if (current === undefined || date > String(current.snapshot_date)) latest.set(key, row);
  }
  return [...latest.values()];
}

/**
 * The workspace's connection and account, and `usageSnapshots`, behind the fake PostgREST.
 * `usage_snapshot_monthly_latest` answers from `monthlyRows` as the database would.
 */
function seed(usageSnapshots: readonly Row[], monthlyRows: readonly Row[] = usageSnapshots) {
  const fake = fakeSupabase(
    {
      connections: [{ id: CONNECTION, workspace_id: WORKSPACE, provider: "github", created_at: "2026-01-01T00:00:00.000Z" }],
      external_accounts: [{ id: ACCOUNT, workspace_id: WORKSPACE, connection_id: CONNECTION, included: true, project_id: null, display_name: "Account" }],
      projects: [],
      usage_snapshots: usageSnapshots,
    },
    { [MONTHLY_FUNCTION]: ({ p_workspace_id, p_since }) => monthlyLatest(monthlyRows, p_workspace_id, p_since) },
  );
  state.db = fake.db;
  requests = fake.requests;
}

/** The `snapshot_date` filters of each `usage_snapshots` request, such as `["gte.2025-11-01"]`. */
function snapshotDateFilters(): string[][] {
  return requests
    .filter((request) => request.table === "usage_snapshots")
    .map((request) => request.filters.flatMap(([column, filter]) => (column === "snapshot_date" ? [filter] : [])));
}

/** The arguments of each `usage_snapshot_monthly_latest` request, one per page. */
function monthlyCalls(): PageRequest["args"][] {
  return requests.filter((request) => request.table === `rpc/${MONTHLY_FUNCTION}`).map((request) => request.args);
}

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
  state.request += 1;
  seed([...SNAPSHOT_DATES.map((date) => snapshot(date)), snapshot("2026-11-10", OTHER_WORKSPACE)]);
});

describe("getTrendData", () => {
  it("matches the windows the page computes from the same now", () => {
    expect(snapshotWindowStart(NOW)).toBe(WINDOW_START);
    expect(trendWindowStart(NOW)).toBe(TREND_START);
  });

  it("daily: shares the dashboard's one read and reads nothing older than the window start", async () => {
    const { dashboard, trends } = await dashboardRequest("daily");
    expect(snapshotDateFilters()).toEqual([[`gte.${WINDOW_START}`]]);
    // The window's first day is in; the day before it is not.
    expect(dates(trends.snapshots)).toEqual(["2026-11-11", WINDOW_START]);
    expect(dates(dashboard.snapshots)).toEqual(dates(trends.snapshots));
  });

  it("monthly: reads the monthly rollup from the trend window start, not the dashboard's daily rows", async () => {
    const { dashboard, trends } = await dashboardRequest("monthly");
    // The cards still read their 45 days; the trend reads only the rollup, once.
    expect(snapshotDateFilters()).toEqual([[`gte.${WINDOW_START}`]]);
    expect(monthlyCalls()).toEqual([{ p_workspace_id: WORKSPACE, p_since: TREND_START }]);
    // One row per month, newest first: 2026-09-26 shares September with the newer window start, and
    // the day before the trend window is not read.
    expect(dates(trends.snapshots)).toEqual(["2026-11-11", WINDOW_START, "2026-01-15", TREND_START]);
    expect(dates(dashboard.snapshots)).toEqual(["2026-11-11", WINDOW_START]);
  });

  it.each<TrendGranularity>(["daily", "monthly"])("%s: returns no rows for a workspace with no snapshots", async (granularity) => {
    seed([snapshot("2026-11-10", OTHER_WORKSPACE)]);
    const { dashboard, trends } = await dashboardRequest(granularity);
    expect(trends.snapshots).toEqual([]);
    expect(dashboard.snapshots).toEqual([]);
    expect(snapshotDateFilters()).toHaveLength(1);
    expect(monthlyCalls()).toHaveLength(granularity === "daily" ? 0 : 1);
  });
});

describe("getTrendData monthly rollup paging (#317)", () => {
  /** `count` rollup rows of one month in the trend window: one metric each, so each is its own row. */
  function rollupRows(count: number): Row[] {
    return Array.from({ length: count }, (_, index) => {
      const suffix = String(index).padStart(5, "0");
      return { ...snapshot("2026-10-31"), id: `row-${suffix}`, metric_key: `github.metric_${suffix}.count` };
    });
  }

  let warn: MockInstance<typeof log.warn>;
  beforeEach(() => {
    warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it.each([
    { case: "just under the cap", rows: 9_999, read: 9_999, warned: false },
    // A full last page cannot say whether more rows follow, so the read at the cap is called cut.
    { case: "at the cap", rows: 10_000, read: 10_000, warned: true },
    { case: "over the cap", rows: 10_001, read: 10_000, warned: true },
  ])("$case ($rows rollup rows): reads $read in pages of 1,000", async ({ rows, read, warned }) => {
    seed([], rollupRows(rows));
    const trends = await getTrendData(WORKSPACE, "monthly", NOW, EMPTY_SCOPE);
    expect(trends.snapshots).toHaveLength(read);
    expect(new Set(trends.snapshots.map((row) => row.snapshot_date))).toEqual(new Set(["2026-10-31"]));
    expect(monthlyCalls()).toHaveLength(10);
    expect(warn).toHaveBeenCalledTimes(warned ? 1 : 0);
    if (warned) {
      expect(warn).toHaveBeenCalledWith("dashboard.snapshots_truncated", { workspaceId: WORKSPACE, purpose: "monthly trend", rows: 10_000 });
    }
  });

  it("one row reads one page and does not warn", async () => {
    seed([], rollupRows(1));
    const trends = await getTrendData(WORKSPACE, "monthly", NOW, EMPTY_SCOPE);
    expect(trends.snapshots).toHaveLength(1);
    expect(monthlyCalls()).toHaveLength(1);
    expect(warn).not.toHaveBeenCalled();
  });
});
