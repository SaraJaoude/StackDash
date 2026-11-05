import "server-only";

import type { ConnectionInput, SnapshotInput } from "@/lib/dashboard/aggregate";
import { eventCountBucket, markerTypeIds, markerWindowStart, type EventCountRow, type MarkerCategory } from "@/lib/dashboard/markers";
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
  const { providers, accountIds } = timelineScope(scope, await accountIdsInProjects(workspaceId, scope));
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
