import "server-only";

import { cache } from "react";

import { severityFor, type AlertSeverity } from "@/lib/alerts/evaluate";
import { beforeCursorFilter, decodeCursor, encodeCursor, type Page } from "@/lib/data/cursor";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Triggered alerts (#69): the history the evaluator records, read as the signed-in user, plus the
 * one write members make to it, acknowledging. Row level security lets viewers read and admins
 * update, and the column grant limits that update to `acknowledged_at` and `acknowledged_by`, so
 * nothing here can change or delete an alert's history. Lists read newest first through the
 * `triggered_alerts_workspace_triggered_at_idx` index (workspace_id, triggered_at desc).
 */

type Row = Database["public"]["Tables"]["triggered_alerts"]["Row"];

export type TriggeredAlert = Pick<
  Row,
  "id" | "triggered_at" | "threshold_label" | "is_estimated" | "message" | "acknowledged_at" | "acknowledged_by"
> & { severity: AlertSeverity };

export type UnacknowledgedSummary = { count: number; newest: TriggeredAlert[] };

export const TRIGGERED_ALERTS_PAGE_SIZE = 50;
export const SUMMARY_NEWEST_COUNT = 3;

// The rule's threshold decides the severity, the same way the evaluator decides it.
const COLUMNS =
  "id, triggered_at, threshold_label, is_estimated, message, acknowledged_at, acknowledged_by, alert_rules!triggered_alerts_rule_fkey(threshold_percent)" as const;

type SelectedRow = Pick<
  Row,
  "id" | "triggered_at" | "threshold_label" | "is_estimated" | "message" | "acknowledged_at" | "acknowledged_by"
> & { alert_rules: { threshold_percent: number | null } | null };

function toAlert({ alert_rules: rule, ...row }: SelectedRow): TriggeredAlert {
  return { ...row, severity: severityFor(rule?.threshold_percent ?? null) };
}

/**
 * One page of the workspace's triggered alerts, newest first. Acknowledged alerts are left out
 * unless `includeAcknowledged`; a missing or malformed `after` cursor means the first page.
 */
export const listTriggeredAlerts = cache(
  async (workspaceId: string, includeAcknowledged: boolean, after: string | null): Promise<Page<TriggeredAlert>> => {
    const supabase = await createClient();
    let query = supabase.from("triggered_alerts").select(COLUMNS).eq("workspace_id", workspaceId);
    if (!includeAcknowledged) query = query.is("acknowledged_at", null);
    const cursor = decodeCursor(after);
    if (cursor !== null) query = query.or(beforeCursorFilter("triggered_at", cursor));
    const { data, error } = await query
      .order("triggered_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(TRIGGERED_ALERTS_PAGE_SIZE + 1);
    if (error) throw new Error("Failed to list triggered alerts", { cause: error });
    const items = data.slice(0, TRIGGERED_ALERTS_PAGE_SIZE).map(toAlert);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        data.length > TRIGGERED_ALERTS_PAGE_SIZE && last !== undefined
          ? encodeCursor([last.triggered_at, last.id])
          : null,
    };
  },
);

/** True when any alert has ever fired in this workspace, acknowledged or not. */
export const hasTriggeredAlerts = cache(async (workspaceId: string): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.from("triggered_alerts").select("id").eq("workspace_id", workspaceId).limit(1);
  if (error) throw new Error("Failed to check for triggered alerts", { cause: error });
  return data.length > 0;
});

/** How many alerts nobody has acknowledged yet, and the newest few of them, for the dashboard. */
export const getUnacknowledgedSummary = cache(async (workspaceId: string): Promise<UnacknowledgedSummary> => {
  const supabase = await createClient();
  const [counted, newest] = await Promise.all([
    supabase
      .from("triggered_alerts")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .is("acknowledged_at", null),
    supabase
      .from("triggered_alerts")
      .select(COLUMNS)
      .eq("workspace_id", workspaceId)
      .is("acknowledged_at", null)
      .order("triggered_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(SUMMARY_NEWEST_COUNT),
  ]);
  if (counted.error) throw new Error("Failed to count unacknowledged alerts", { cause: counted.error });
  if (newest.error) throw new Error("Failed to list unacknowledged alerts", { cause: newest.error });
  return { count: counted.count ?? newest.data.length, newest: newest.data.map(toAlert) };
});

/**
 * Marks an alert acknowledged by `userId`, now. Idempotent: an alert that is already acknowledged
 * keeps its first acknowledgement and still counts as success. False when no alert with `id`
 * exists in this workspace, so another workspace's id reads exactly like a missing one.
 */
export async function acknowledgeTriggeredAlert(workspaceId: string, id: string, userId: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("triggered_alerts")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: userId })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .is("acknowledged_at", null)
    .select("id");
  if (error) throw new Error("Failed to acknowledge alert", { cause: error });
  if (data.length > 0) return true;
  // Nothing updated: either someone acknowledged it first, or it does not exist here.
  const { data: existing, error: readError } = await supabase
    .from("triggered_alerts")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .maybeSingle();
  if (readError) throw new Error("Failed to read alert", { cause: readError });
  return existing !== null;
}
