import "server-only";

import { cache } from "react";

import type { AccountInput, ConnectionInput, ProjectInput, SnapshotInput } from "@/lib/dashboard/aggregate";
import { applyScope, type ScopeFilters } from "@/lib/filters/scope";
import { log } from "@/lib/log/logger";
import { readAllPages } from "@/lib/supabase/paging";
import { createClient } from "@/lib/supabase/server";

/** The workspace's connections, included accounts, and projects: what the scope filter offers. */
export type WorkspaceScope = Readonly<{
  connections: ConnectionInput[];
  accounts: AccountInput[];
  projects: ProjectInput[];
}>;

export type DashboardData = WorkspaceScope & Readonly<{ snapshots: SnapshotInput[] }>;

/**
 * Snapshots older than this cannot hold a current value worth showing; retention keeps 13 months.
 * The daily trends read this same window (#263); their 30 day chart sits inside it.
 */
export const SNAPSHOT_WINDOW_DAYS = 45;

// Snapshots are read in pages of PostgREST's row cap (readAllPages), up to a hard cap. The monthly
// trend's rollup (`loadMonthlySnapshots`) has the same cap, but counts one row per account, metric,
// and month, so it is reached only past about 770 account and metric pairs.
const SNAPSHOT_MAX_ROWS = 10_000;

// Bounds for the small lists. A workspace in the MVP has a handful of each. The dashboard's "Sync
// now" (#267) queues at most as many connections as it lists.
export const CONNECTIONS_LIMIT = 100;
const ACCOUNTS_LIMIT = 1000;
const PROJECTS_LIMIT = 500;

// granted_scopes says whether the provider simulator made the connection (#131); last_sync_requested_at
// drives the stale notice's Sync now cooldown (#267).
const CONNECTION_COLUMNS =
  "id, provider, display_name, status, last_synced_at, last_sync_requested_at, poll_interval_seconds, granted_scopes";
const ACCOUNT_COLUMNS = "id, connection_id, display_name, project_id";
const PROJECT_COLUMNS = "id, name";
const SNAPSHOT_COLUMNS =
  "connection_id, external_account_id, metric_key, kind, label, snapshot_date, value, unit, amount_minor, currency, period_start, period_end, point_at, resets_at, retrieved_at, provenance_source, pricing_source";

/** First UTC date (`YYYY-MM-DD`) of the snapshot window ending at `now`; snapshot dates are UTC dates. */
export function snapshotWindowStart(now: Date): string {
  return new Date(now.getTime() - SNAPSHOT_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** Optional narrowing of a snapshot read on top of the workspace and `sinceDate`. */
export type SnapshotReadFilters = Readonly<{
  /** Only rows of these kinds. */
  kinds?: readonly SnapshotInput["kind"][];
  /** Only rows of these metrics. */
  metricKeys?: readonly string[];
}>;

/**
 * The workspace's snapshots dated `sinceDate` or later, newest first, as one paged query on the
 * `(workspace_id, snapshot_date desc)` index. `purpose` names the caller in the truncation warning.
 */
export async function loadSnapshots(
  workspaceId: string,
  sinceDate: string,
  purpose: string,
  { kinds, metricKeys }: SnapshotReadFilters = {},
): Promise<SnapshotInput[]> {
  const supabase = await createClient();
  const { rows, complete } = await readAllPages(async (from, to) => {
    let query = supabase
      .from("usage_snapshots")
      .select(SNAPSHOT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .gte("snapshot_date", sinceDate);
    if (kinds !== undefined) query = query.in("kind", kinds);
    if (metricKeys !== undefined) query = query.in("metric_key", metricKeys);
    const { data, error } = await query
      .order("snapshot_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error("Failed to load usage snapshots", { cause: error });
    return data;
  }, SNAPSHOT_MAX_ROWS);
  // Newest first, so what was left out is the oldest history; current values are still shown.
  if (!complete) log.warn("dashboard.snapshots_truncated", { workspaceId, purpose, rows: rows.length });
  return rows;
}

/**
 * Each account's latest snapshot per metric, currency or unit, and UTC month from `sinceDate`, newest
 * first: everything the monthly trend sums (#317). Grouped in the database
 * (`usage_snapshot_monthly_latest`), so the read grows with months, not days, and a long history no
 * longer pushes the oldest months past the cap. The function reads nothing for a non-member. Every
 * page runs the grouping again, about 15 ms for 13 months of 105 daily metrics (#317).
 */
export async function loadMonthlySnapshots(workspaceId: string, sinceDate: string): Promise<SnapshotInput[]> {
  const supabase = await createClient();
  const { rows, complete } = await readAllPages(async (from, to) => {
    const { data, error } = await supabase
      .rpc("usage_snapshot_monthly_latest", { p_workspace_id: workspaceId, p_since: sinceDate })
      // PostgREST orders a function's rows only by selected columns, so the tiebreak needs `id`.
      .select(`${SNAPSHOT_COLUMNS}, id`)
      .order("snapshot_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to);
    if (error) throw new Error("Failed to load the monthly snapshots", { cause: error });
    return data;
  }, SNAPSHOT_MAX_ROWS);
  // Newest first, so what was left out is the oldest months.
  if (!complete) log.warn("dashboard.snapshots_truncated", { workspaceId, purpose: "monthly trend", rows: rows.length });
  return rows;
}

/**
 * Every snapshot of the dashboard window starting at `sinceDate`, unscoped, read once per request
 * (#263). The dashboard's cards and the daily trend charts both need these rows, so
 * `getDashboardData` and `getTrendData` share this one read instead of each issuing their own; the
 * key is the primitive pair, so callers must pass the same `snapshotWindowStart(now)` string.
 * Callers must not mutate the returned array, which every caller in the request shares.
 */
export const loadDashboardSnapshots = cache(
  (workspaceId: string, sinceDate: string): Promise<SnapshotInput[]> => loadSnapshots(workspaceId, sinceDate, "dashboard"),
);

/**
 * Connections, the accounts included in the workspace's views, and projects, unfiltered. Row level
 * security limits every query to members; the explicit workspace filter keeps each one on its
 * index. Call only after `requireWorkspace` has confirmed membership.
 */
export const getWorkspaceScope = cache(async (workspaceId: string): Promise<WorkspaceScope> => {
  const supabase = await createClient();
  const [connections, accounts, projects] = await Promise.all([
    supabase
      .from("connections")
      .select(CONNECTION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(CONNECTIONS_LIMIT),
    supabase
      .from("external_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("included", true)
      .order("display_name", { ascending: true })
      .order("id", { ascending: true })
      .limit(ACCOUNTS_LIMIT),
    supabase
      .from("projects")
      .select(PROJECT_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .limit(PROJECTS_LIMIT),
  ]);
  if (connections.error) throw new Error("Failed to load connections", { cause: connections.error });
  if (accounts.error) throw new Error("Failed to load external accounts", { cause: accounts.error });
  if (projects.error) throw new Error("Failed to load projects", { cause: projects.error });
  return { connections: connections.data, accounts: accounts.data, projects: projects.data };
});

/**
 * Everything the dashboard reduces, narrowed to `scope`: connections, included accounts, projects
 * (all of them, for names), and snapshots dated `sinceDate` or later (see `snapshotWindowStart`).
 * The snapshots come from `loadDashboardSnapshots`, so the trend charts reuse them without a second
 * query (#263). Call only after `requireWorkspace` has confirmed membership.
 */
export async function getDashboardData(workspaceId: string, sinceDate: string, scope: ScopeFilters): Promise<DashboardData> {
  const [workspaceScope, snapshots] = await Promise.all([
    getWorkspaceScope(workspaceId),
    loadDashboardSnapshots(workspaceId, sinceDate),
  ]);
  return { ...applyScope({ ...workspaceScope, snapshots }, scope), projects: workspaceScope.projects };
}
