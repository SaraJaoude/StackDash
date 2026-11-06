import "server-only";

import type { SnapshotInput } from "@/lib/dashboard/aggregate";
import type { DateRange, EventCount, HeadlineEvents, HeadlineEventTypes, HeadlineWindows } from "@/lib/dashboard/headline";
import { applyScope, type ScopeFilters } from "@/lib/filters/scope";
import { createClient } from "@/lib/supabase/server";

import { getWorkspaceScope, loadSnapshots } from "./dashboard";

const DAY_MS = 86_400_000;

/**
 * The snapshot rows the headline's money and daily signup totals read, narrowed to `scope`: the
 * money kinds and the declared daily totals, from the day before the previous window (that day's
 * reading is where the window's first amount starts) to today. Read on their own rather than
 * from the trend history, so the allowance and usage rows that make up most of a busy workspace's
 * history do not count toward the read cap. The cap still applies (`loadSnapshots`, 10,000 rows
 * each, newest first): past it the oldest days are left out, so the previous window is named
 * unavailable and the figures lose their comparison, with a `dashboard.snapshots_truncated`
 * warning. Call only after `requireWorkspace` has confirmed membership.
 */
export async function getHeadlineSnapshots(
  workspaceId: string,
  scope: ScopeFilters,
  windows: HeadlineWindows,
  eventTypes: HeadlineEventTypes,
): Promise<SnapshotInput[]> {
  const since = new Date(Date.parse(`${windows.previous.start}T00:00:00.000Z`) - DAY_MS).toISOString().slice(0, 10);
  const [workspaceScope, money, dailyTotals] = await Promise.all([
    getWorkspaceScope(workspaceId),
    loadSnapshots(workspaceId, since, "headline money", ["revenue", "verified_spend", "estimated_spend"]),
    eventTypes.signupDailyTotals.length === 0
      ? []
      : loadSnapshots(workspaceId, since, "headline signups", ["usage"], eventTypes.signupDailyTotals),
  ]);
  return applyScope({ ...workspaceScope, snapshots: [...money, ...dailyTotals] }, scope).snapshots;
}

/**
 * Signup and deploy counts per connection and event type for both headline windows, and each
 * connection's oldest reading, for the included accounts the scope leaves in view. One
 * `count_activity_events` call per window, each returning at most one row per connection and type,
 * and one single row snapshot read per connection with accounts in view, all run together. The
 * oldest reading is read on its own rather than from the trend history, whose newest first page
 * cap would otherwise move it forward in a busy workspace. Call only after `requireWorkspace` has
 * confirmed membership.
 */
export async function getHeadlineEvents(
  workspaceId: string,
  scope: ScopeFilters,
  windows: HeadlineWindows,
  eventTypes: HeadlineEventTypes,
): Promise<HeadlineEvents> {
  const { accounts } = applyScope({ ...(await getWorkspaceScope(workspaceId)), snapshots: [] }, scope);
  if (accounts.length === 0) return { current: [], previous: [], firstReadings: new Map() };
  const accountIds = accounts.map((account) => account.id);
  const supabase = await createClient();
  const count = async (range: DateRange): Promise<EventCount[]> => {
    const { data, error } = await supabase.rpc("count_activity_events", {
      p_workspace_id: workspaceId,
      p_account_ids: accountIds,
      p_type_ids: [...eventTypes.signups, ...eventTypes.deploys],
      p_from: `${range.start}T00:00:00.000Z`,
      // Window dates are inclusive; the query's end is the next day's first instant, exclusive.
      p_until: new Date(Date.parse(`${range.end}T00:00:00.000Z`) + DAY_MS).toISOString(),
    });
    if (error) throw new Error("Failed to count activity events", { cause: error });
    return data;
  };
  // Only "on or before the current window's first day" matters, so later readings are not read.
  const firstReading = async (connectionId: string, connectionAccounts: readonly string[]) => {
    const { data, error } = await supabase
      .from("usage_snapshots")
      .select("snapshot_date")
      .eq("workspace_id", workspaceId)
      .eq("connection_id", connectionId)
      .in("external_account_id", [...connectionAccounts])
      .lte("snapshot_date", windows.current.start)
      .order("snapshot_date", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error("Failed to read a connection's first snapshot", { cause: error });
    return data === null ? [] : [[connectionId, data.snapshot_date] as const];
  };
  const accountsByConnection = Map.groupBy(accounts, (account) => account.connection_id);
  const [current, previous, readings] = await Promise.all([
    count(windows.current),
    count(windows.previous),
    Promise.all(
      [...accountsByConnection].map(([connectionId, list]) => firstReading(connectionId, list.map((account) => account.id))),
    ),
  ]);
  return { current, previous, firstReadings: new Map(readings.flat()) };
}
