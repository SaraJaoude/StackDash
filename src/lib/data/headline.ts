import "server-only";

import { HEADLINE_EVENT_TYPES, type DateRange, type EventCount, type HeadlineWindows } from "@/lib/dashboard/headline";
import { applyScope, type ScopeFilters } from "@/lib/filters/scope";
import { createClient } from "@/lib/supabase/server";

import { getWorkspaceScope } from "./dashboard";

export type HeadlineEventCounts = Readonly<{ current: EventCount[]; previous: EventCount[] }>;

const DAY_MS = 86_400_000;

/**
 * Signup and deploy counts per connection and event type for both headline windows, for the
 * included accounts the scope leaves in view. One `count_activity_events` call per window, run
 * together; each returns at most one row per connection and type. Call only after
 * `requireWorkspace` has confirmed membership.
 */
export async function getHeadlineEventCounts(
  workspaceId: string,
  scope: ScopeFilters,
  windows: HeadlineWindows,
): Promise<HeadlineEventCounts> {
  const { accounts } = applyScope({ ...(await getWorkspaceScope(workspaceId)), snapshots: [] }, scope);
  if (accounts.length === 0) return { current: [], previous: [] };
  const accountIds = accounts.map((account) => account.id);
  const supabase = await createClient();
  const count = async (range: DateRange): Promise<EventCount[]> => {
    const { data, error } = await supabase.rpc("count_activity_events", {
      p_workspace_id: workspaceId,
      p_account_ids: accountIds,
      p_type_ids: [...HEADLINE_EVENT_TYPES],
      p_from: `${range.start}T00:00:00.000Z`,
      // Window dates are inclusive; the query's end is the next day's first instant, exclusive.
      p_until: new Date(Date.parse(`${range.end}T00:00:00.000Z`) + DAY_MS).toISOString(),
    });
    if (error) throw new Error("Failed to count activity events", { cause: error });
    return data;
  };
  const [current, previous] = await Promise.all([count(windows.current), count(windows.previous)]);
  return { current, previous };
}
