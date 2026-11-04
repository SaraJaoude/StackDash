import "server-only";

import type { ConnectionInput, SnapshotInput } from "@/lib/dashboard/aggregate";
import { trendWindowStart } from "@/lib/dashboard/trends";
import { applyScope, type ScopeFilters } from "@/lib/filters/scope";

import { getWorkspaceScope, loadSnapshots } from "./dashboard";

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
