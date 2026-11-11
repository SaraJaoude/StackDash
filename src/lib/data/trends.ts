import "server-only";

import type { ConnectionInput, SnapshotInput } from "@/lib/dashboard/aggregate";
import { eventCountBucket, markerTypeIds, markerWindowStart, type EventCountRow, type MarkerCategory } from "@/lib/dashboard/markers";
import { trendWindowStart, type TrendGranularity } from "@/lib/dashboard/trends";
import { applyScope, type ScopeFilters } from "@/lib/filters/scope";
import { log } from "@/lib/log/logger";
import { createClient } from "@/lib/supabase/server";

import { getWorkspaceScope, loadDashboardSnapshots, loadSnapshots, snapshotWindowStart } from "./dashboard";
import { resolveTimelineScope } from "./timeline";

export type TrendData = Readonly<{ connections: ConnectionInput[]; snapshots: SnapshotInput[] }>;

/**
 * Snapshot history for the trend charts, narrowed to `scope` with the same rules as the dashboard,
 * newest first. The cards and the charts share one read per row (#263): the dashboard window's
 * rows come from `loadDashboardSnapshots`, the read `getDashboardData` already made with the same
 * `now`. The headline strip still reads its money and signup rows on its own (`getHeadlineSnapshots`
 * says why).
 * - `"daily"` uses only those rows (`SNAPSHOT_WINDOW_DAYS`, which holds the 30 day chart) and issues
 *   no query of its own. An account whose last row is older than that window therefore no longer
 *   counts as expected in a daily bucket, as on the dashboard's cards. The monthly view still
 *   reads 13 months, so it keeps expecting that account and shows the current month as
 *   unavailable: the two views disagree about an account that stopped reporting 45 days to 13
 *   months ago, until #308 gives both views one rule.
 * - `"monthly"` adds one bounded read of the rows from `trendWindowStart(now)` up to, not
 *   including, `snapshotWindowStart(now)`, so the two reads never overlap and older rows simply
 *   follow the newer ones.
 * Both reads are paged on the `(workspace_id, snapshot_date desc)` index and capped separately;
 * past a cap a read loses its oldest days, with a `dashboard.snapshots_truncated` warning. The
 * unique key `(external_account_id, metric_key, snapshot_date)` means each row is already the
 * latest value of its day. Call only after `requireWorkspace` has confirmed membership.
 */
export async function getTrendData(
  workspaceId: string,
  granularity: TrendGranularity,
  now: Date,
  scope: ScopeFilters,
): Promise<TrendData> {
  const windowStart = snapshotWindowStart(now);
  const [workspaceScope, recent, older] = await Promise.all([
    getWorkspaceScope(workspaceId),
    loadDashboardSnapshots(workspaceId, windowStart),
    granularity === "daily"
      ? []
      : loadSnapshots(workspaceId, trendWindowStart(now), "trends before the dashboard window", { beforeDate: windowStart }),
  ]);
  const scoped = applyScope({ ...workspaceScope, snapshots: [...recent, ...older] }, scope);
  return { connections: scoped.connections, snapshots: scoped.snapshots };
}

// The database groups by the chart's bucket, so there is at most one row per bucket and type id
// (each type id belongs to one provider): 30 days or 13 months times about ten types, well under
// PostgREST's 1000 row max_rows. One request; an offset page would run the whole aggregate again.
const EVENT_COUNT_LIMIT = 1000;

/**
 * Event counts for the trend markers (#168) of `categories`, per `granularity` bucket from the first
 * day of its window, filtered by `scope` exactly as the timeline filters it. Counted in the database
 * (`activity_event_counts`), which counts nothing for a non-member. Call only after
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
  const { providers, accountIds } = await resolveTimelineScope(workspaceId, scope);
  // No account can match, so no event can either.
  if (accountIds !== null && accountIds.length === 0) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("activity_event_counts", {
      p_workspace_id: workspaceId,
      p_since: markerWindowStart(granularity, now),
      p_bucket: eventCountBucket(granularity),
      p_type_ids: typeIds,
      p_providers: [...providers],
      ...(accountIds === null ? {} : { p_account_ids: [...accountIds] }),
    })
    .order("bucket_start", { ascending: false })
    .order("provider", { ascending: true })
    .order("type_id", { ascending: true })
    .limit(EVENT_COUNT_LIMIT);
  if (error) throw new Error("Failed to load event counts for the trend markers", { cause: error });
  // Newest first, so if more types ever push past the limit, the oldest buckets are what is lost.
  if (data.length === EVENT_COUNT_LIMIT) log.warn("dashboard.event_counts_truncated", { workspaceId, granularity, rows: data.length });
  return data;
}
