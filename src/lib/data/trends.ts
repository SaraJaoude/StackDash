import "server-only";

import type { ConnectionInput, SnapshotInput } from "@/lib/dashboard/aggregate";
import { markerTypeIds, markerWindowStart, type EventCountRow, type MarkerCategory } from "@/lib/dashboard/markers";
import { trendWindowStart, type TrendGranularity } from "@/lib/dashboard/trends";
import { applyScope, timelineScope, type ScopeFilters } from "@/lib/filters/scope";
import { log } from "@/lib/log/logger";
import { createClient } from "@/lib/supabase/server";

import { getWorkspaceScope, loadSnapshots } from "./dashboard";
import { accountIdsInProjects } from "./timeline";

export type TrendData = Readonly<{ connections: ConnectionInput[]; snapshots: SnapshotInput[] }>;

/**
 * Snapshot history for the trend charts: 13 UTC months up to `now`, read as one bounded, paged
 * query on the `(workspace_id, snapshot_date desc)` index and narrowed to `scope` with the same
 * rules as the dashboard. The unique key `(external_account_id, metric_key, snapshot_date)` means
 * each row is already the latest value of its day. Call only after `requireWorkspace` has
 * confirmed membership.
 */
export async function getTrendData(workspaceId: string, now: Date, scope: ScopeFilters): Promise<TrendData> {
  const [workspaceScope, snapshots] = await Promise.all([
    getWorkspaceScope(workspaceId),
    loadSnapshots(workspaceId, trendWindowStart(now), "trends"),
  ]);
  const scoped = applyScope({ ...workspaceScope, snapshots }, scope);
  return { connections: scoped.connections, snapshots: scoped.snapshots };
}

// One row per UTC day, provider, and type with events: about 400 days times a handful of types
// for the monthly window. PostgREST returns at most 1000 rows per request (max_rows), so the
// counts are read in pages of that size, up to a hard cap.
const EVENT_COUNT_PAGE_SIZE = 1000;
const EVENT_COUNT_MAX_PAGES = 10;

/**
 * Daily event counts for the trend markers (#168) of `categories`, from the first day of the
 * `granularity` window, filtered by `scope` exactly as the timeline filters it. Counted in the
 * database (`activity_event_daily_counts`), under row level security. Call only after
 * `requireWorkspace` has confirmed membership.
 */
export async function getTrendEventCounts(
  workspaceId: string,
  granularity: TrendGranularity,
  now: Date,
  scope: ScopeFilters,
  categories: readonly MarkerCategory[],
): Promise<EventCountRow[]> {
  const typeIds = markerTypeIds(categories);
  if (typeIds.length === 0) return [];
  const { providers, accountIds } = timelineScope(scope, await accountIdsInProjects(workspaceId, scope));
  // No account can match, so no event can either.
  if (accountIds !== null && accountIds.length === 0) return [];

  const supabase = await createClient();
  const rows: EventCountRow[] = [];
  for (let page = 0; page < EVENT_COUNT_MAX_PAGES; page += 1) {
    const from = page * EVENT_COUNT_PAGE_SIZE;
    const { data, error } = await supabase
      .rpc("activity_event_daily_counts", {
        p_workspace_id: workspaceId,
        p_since: markerWindowStart(granularity, now),
        p_type_ids: typeIds,
        p_providers: [...providers],
        ...(accountIds === null ? {} : { p_account_ids: [...accountIds] }),
      })
      .order("day", { ascending: false })
      .order("provider", { ascending: true })
      .order("type_id", { ascending: true })
      .range(from, from + EVENT_COUNT_PAGE_SIZE - 1);
    if (error) throw new Error("Failed to load event counts for the trend markers", { cause: error });
    rows.push(...data);
    if (data.length < EVENT_COUNT_PAGE_SIZE) return rows;
  }
  // Newest first, so what was left out is the oldest days; recent markers are still shown.
  log.warn("dashboard.event_counts_truncated", { workspaceId, granularity, rows: rows.length });
  return rows;
}
