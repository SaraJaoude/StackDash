import "server-only";

import { cache } from "react";

import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";
import {
  occurredRange,
  TIMELINE_PAGE_SIZE,
  type EventSeverity,
  type TimelineCursor,
} from "@/lib/timeline/query";

type ActivityEventRow = Database["public"]["Tables"]["activity_events"]["Row"];

export type TimelineEvent = Pick<
  ActivityEventRow,
  "id" | "type_id" | "severity" | "title" | "body" | "url" | "occurred_at" | "provider"
> & {
  accountName: string | null;
  connectionName: string | null;
};

export type TimelineFilters = {
  types: readonly string[];
  severities: readonly EventSeverity[];
  /** London calendar dates, inclusive; converted to UTC instants here. */
  from: string | null;
  to: string | null;
  /** Event types the viewer chose to hide (#119); excluded from every page. */
  hiddenTypeIds: readonly string[];
  cursor: TimelineCursor | null;
};

export type TimelinePage = {
  events: TimelineEvent[];
  /** Position after the last event, or null when this is the oldest page. */
  nextCursor: TimelineCursor | null;
};

// Postgres timestamps hold commas and colons, so the values in the `or` filter are quoted. The
// cursor was validated by `decodeCursor`, so it never contains a quote.
function olderThan(cursor: TimelineCursor): string {
  const at = `"${cursor.occurredAt}"`;
  return `occurred_at.lt.${at},and(occurred_at.eq.${at},id.lt.${cursor.id})`;
}

/**
 * One page of the workspace's activity, newest first, keyset paginated on
 * (occurred_at desc, id desc) to match the table's index. Provider account and connection names
 * come from the same request as embedded resources, so a page is always one round trip. Type ids
 * in `types` and `hiddenTypeIds` must have passed `isEventTypeId`.
 */
export async function listTimelineEvents(workspaceId: string, filters: TimelineFilters): Promise<TimelinePage> {
  const supabase = await createClient();
  let query = supabase
    .from("activity_events")
    .select(
      "id, type_id, severity, title, body, url, occurred_at, provider, external_accounts(display_name), connections(display_name)",
    )
    .eq("workspace_id", workspaceId);

  if (filters.types.length > 0) query = query.in("type_id", [...filters.types]);
  if (filters.hiddenTypeIds.length > 0) query = query.not("type_id", "in", `(${filters.hiddenTypeIds.join(",")})`);
  if (filters.severities.length > 0) query = query.in("severity", [...filters.severities]);
  const range = occurredRange(filters.from, filters.to);
  if (range.from !== null) query = query.gte("occurred_at", range.from);
  if (range.toExclusive !== null) query = query.lt("occurred_at", range.toExclusive);
  if (filters.cursor !== null) query = query.or(olderThan(filters.cursor));

  // One extra row says whether an older page exists without a count query.
  const { data, error } = await query
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(TIMELINE_PAGE_SIZE + 1);
  if (error) throw new Error("Failed to load timeline events", { cause: error });

  const page = data.slice(0, TIMELINE_PAGE_SIZE);
  const last = page.at(-1);
  return {
    events: page.map(({ external_accounts, connections, ...event }) => ({
      ...event,
      accountName: external_accounts?.display_name ?? null,
      connectionName: connections?.display_name ?? null,
    })),
    nextCursor:
      data.length > TIMELINE_PAGE_SIZE && last !== undefined ? { occurredAt: last.occurred_at, id: last.id } : null,
  };
}

// PostgREST has no DISTINCT, so the type picker samples the newest events. Types older than the
// sample are rare in practice and still filterable through the URL.
const TYPE_SAMPLE_SIZE = 1000;
const MAX_TYPE_OPTIONS = 50;

/**
 * Up to 50 distinct event type ids seen in the workspace's newest 1,000 events, sorted. Empty
 * exactly when the workspace has no activity at all.
 */
export const listTimelineTypeIds = cache(async (workspaceId: string): Promise<string[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("activity_events")
    .select("type_id")
    .eq("workspace_id", workspaceId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(TYPE_SAMPLE_SIZE);
  if (error) throw new Error("Failed to load timeline event types", { cause: error });
  return [...new Set(data.map((row) => row.type_id))].sort().slice(0, MAX_TYPE_OPTIONS);
});
