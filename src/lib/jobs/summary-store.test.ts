import { afterEach, describe, expect, it, vi } from "vitest";

import { log } from "@/lib/log/logger";
import { fakeSupabase, MAX_ROWS, type Row } from "@/lib/supabase/fake-postgrest";

import { createSupabaseJobStore, SUMMARY_ROW_LIMIT } from "./store";

/*
 * The daily summary's reads in the Supabase job store against a fake PostgREST that, like the real
 * one, answers at most max_rows (1000) rows a request and says nothing about the rest (#218).
 */

const { client } = vi.hoisted(() => ({ client: { db: null as unknown } }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => client.db }));

const WORKSPACE_ID = "21800000-0000-4000-8000-000000000001";
const OTHER_WORKSPACE_ID = "21800000-0000-4000-8000-000000000002";
const CONNECTION_ID = "21800000-0000-4000-8000-000000000003";
const ACCOUNT_ID = "21800000-0000-4000-8000-000000000004";
const FROM_DATE = "2026-10-23";
const TO_DATE = "2026-11-05";
const DAY_MS = 24 * 60 * 60 * 1000;

const SNAPSHOT_COLUMNS = [
  "connection_id",
  "external_account_id",
  "metric_key",
  "kind",
  "label",
  "snapshot_date",
  "value",
  "unit",
  "amount_minor",
  "currency",
  "period_start",
  "period_end",
  "point_at",
  "resets_at",
  "retrieved_at",
  "provenance_source",
  "pricing_source",
] as const;

function uuid(prefix: number, index: number): string {
  return `${String(prefix).padStart(8, "0")}-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function store(tables: Readonly<Record<string, readonly Row[]>>) {
  const fake = fakeSupabase(tables);
  client.db = fake.db;
  return { store: createSupabaseJobStore(), requests: fake.requests };
}

/** UTC date `daysBack` days before TO_DATE. */
function dateBack(daysBack: number): string {
  return new Date(Date.parse(`${TO_DATE}T00:00:00.000Z`) - daysBack * DAY_MS).toISOString().slice(0, 10);
}

/** `perDay` usage rows a day for every day of the window, newest day first, then by id. */
function snapshotRows(perDay: number, dayCount: number): Row[] {
  return Array.from({ length: dayCount }, (_, daysBack) =>
    Array.from({ length: perDay }, (_, metric) => {
      const date = dateBack(daysBack);
      return {
        id: uuid(daysBack + 1, metric),
        workspace_id: WORKSPACE_ID,
        connection_id: CONNECTION_ID,
        external_account_id: ACCOUNT_ID,
        metric_key: `simulated.metric.${metric}`,
        kind: "usage",
        label: `Metric ${metric}`,
        snapshot_date: date,
        value: metric,
        unit: "requests",
        amount_minor: null,
        currency: null,
        period_start: `${date}T00:00:00+00:00`,
        period_end: `${date}T23:59:59+00:00`,
        point_at: null,
        resets_at: null,
        retrieved_at: `${date}T23:59:59+00:00`,
        provenance_source: "api",
        pricing_source: null,
      };
    }),
  ).flat();
}

/** A row as the store selects it: its columns and nothing else. */
function selected(row: Row): Row {
  return Object.fromEntries(SNAPSHOT_COLUMNS.map((column) => [column, row[column] ?? null]));
}

function connectionRows(count: number): Row[] {
  return Array.from({ length: count }, (_, index) => ({
    id: uuid(21801, index),
    workspace_id: WORKSPACE_ID,
    provider: "vercel",
    status: "active",
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("createSupabaseJobStore listSnapshotsBetween", () => {
  it.each([
    { name: "empty", perDay: 0, requests: 1 },
    { name: "one short page", perDay: 71, requests: 1 },
    { name: "exactly max_rows", perDay: 125, days: 8, requests: 2 },
    { name: "one row past max_rows", perDay: 77, days: 13, requests: 2 },
    { name: "several pages", perDay: 250, requests: 4 },
  ])("returns every snapshot of the window once, newest first, in requests of at most max_rows (boundary: $name)", async ({ perDay, days = 14, requests: expected }) => {
    const rows = snapshotRows(perDay, days);
    const outside = [
      { ...snapshotRows(1, 1)[0], id: uuid(9, 1), workspace_id: OTHER_WORKSPACE_ID },
      { ...snapshotRows(1, 1)[0], id: uuid(9, 2), snapshot_date: dateBack(14) },
    ];
    const { store: jobs, requests } = store({ usage_snapshots: [...outside, ...rows].toReversed() });
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);

    const read = await jobs.listSnapshotsBetween(WORKSPACE_ID, FROM_DATE, TO_DATE);

    expect(read).toEqual(rows.map(selected));
    expect(requests).toHaveLength(expected);
    expect(requests.every((request) => request.limit !== null && request.limit <= MAX_ROWS)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops at SUMMARY_ROW_LIMIT, keeps the newest days, and logs the cut (boundary: more rows than the bound)", async () => {
    // 400 metrics a day over 14 days: 5600 rows.
    const rows = snapshotRows(400, 14);
    const { store: jobs, requests } = store({ usage_snapshots: rows });
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);

    const read = await jobs.listSnapshotsBetween(WORKSPACE_ID, FROM_DATE, TO_DATE);

    expect(read).toEqual(rows.slice(0, SUMMARY_ROW_LIMIT).map(selected));
    expect(read.at(0)?.snapshot_date).toBe(TO_DATE);
    expect(requests).toHaveLength(SUMMARY_ROW_LIMIT / MAX_ROWS);
    expect(warn).toHaveBeenCalledExactlyOnceWith("daily_summary.snapshots_truncated", { workspaceId: WORKSPACE_ID, rows: SUMMARY_ROW_LIMIT });
  });
});

describe("createSupabaseJobStore listSummaryConnections", () => {
  it("returns every connection but the revoked ones across pages, in id order (boundary: more rows than max_rows)", async () => {
    const rows = connectionRows(1500);
    const revoked = { ...connectionRows(1)[0], id: uuid(21802, 1), status: "revoked" };
    const elsewhere = { ...connectionRows(1)[0], id: uuid(21802, 2), workspace_id: OTHER_WORKSPACE_ID };
    const { store: jobs, requests } = store({ connections: [revoked, elsewhere, ...rows].toReversed() });
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);

    const read = await jobs.listSummaryConnections(WORKSPACE_ID);

    expect(read).toEqual(rows.map((row) => ({ id: row.id, provider: row.provider })));
    expect(requests).toHaveLength(2);
    expect(requests.every((request) => request.limit !== null && request.limit <= MAX_ROWS)).toBe(true);
    expect(warn).not.toHaveBeenCalled();
  });

  it("stops at SUMMARY_ROW_LIMIT and logs the cut (boundary: one row past the bound)", async () => {
    const rows = connectionRows(SUMMARY_ROW_LIMIT + 1);
    const { store: jobs } = store({ connections: rows });
    const warn = vi.spyOn(log, "warn").mockImplementation(() => undefined);

    const read = await jobs.listSummaryConnections(WORKSPACE_ID);

    expect(read).toHaveLength(SUMMARY_ROW_LIMIT);
    expect(read.at(-1)?.id).toBe(rows[SUMMARY_ROW_LIMIT - 1]?.id);
    expect(warn).toHaveBeenCalledExactlyOnceWith("daily_summary.connections_truncated", { workspaceId: WORKSPACE_ID, rows: SUMMARY_ROW_LIMIT });
  });
});
