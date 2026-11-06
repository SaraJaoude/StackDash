import "server-only";

import { cache } from "react";

import { declaredProjectedSpend } from "@/lib/adapters/registry";
import { ANOMALY_TYPE_ID, checkedRows } from "@/lib/alerts/anomaly";
import type { ProviderId } from "@/lib/dashboard/aggregate";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Anomaly detection settings and results (#169), read and written as the signed-in user, so row
 * level security (viewer reads, admin writes) and the column grants apply on top of the role check
 * every Server Action makes first. Every write is filtered by `workspace_id`, so an id from another
 * workspace matches nothing and reads exactly like a missing one.
 */

type Tables = Database["public"]["Tables"];

export type AnomalyMuteItem = Pick<Tables["anomaly_mutes"]["Row"], "id" | "provider" | "metric_key" | "created_at">;

export type AnomalyControls = { enabled: boolean; mutes: AnomalyMuteItem[] };

/** A spend or usage metric this workspace reports, which a person can mute. */
export type AnomalyMetric = { provider: ProviderId; metricKey: string; label: string };

export type RecentAnomaly = Pick<Tables["activity_events"]["Row"], "id" | "title" | "body">;

export type RecentAnomalies = { count: number; newest: RecentAnomaly[] };

/** The dashboard's alerts summary shows anomalies from this many days back. */
export const RECENT_ANOMALY_DAYS = 7;
export const RECENT_ANOMALY_COUNT = 3;

// Mutes per workspace: one per metric a person chose to silence, a handful in practice.
const MUTE_LIMIT = 200;
// Recent snapshot rows scanned for spend and usage metric keys. Each sync writes one row per metric
// per account per day, so this covers the current metrics of any MVP-sized workspace.
const SNAPSHOT_SCAN_LIMIT = 1000;
const ANOMALY_KINDS = ["verified_spend", "estimated_spend", "usage"] as const satisfies readonly Database["public"]["Enums"]["metric_kind"][];

// ── Reads ───────────────────────────────────────────────────────────────────────────────────────

/** Whether detection is on, and the muted metrics, oldest mute first. */
export const getAnomalyControls = cache(async (workspaceId: string): Promise<AnomalyControls> => {
  const supabase = await createClient();
  const [workspace, mutes] = await Promise.all([
    supabase.from("workspaces").select("anomaly_detection_enabled").eq("id", workspaceId).single(),
    supabase
      .from("anomaly_mutes")
      .select("id, provider, metric_key, created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(MUTE_LIMIT),
  ]);
  if (workspace.error) throw new Error("Failed to read the anomaly detection setting", { cause: workspace.error });
  if (mutes.error) throw new Error("Failed to list muted metrics", { cause: mutes.error });
  return { enabled: workspace.data.anomaly_detection_enabled, mutes: mutes.data };
});

/**
 * The metrics detection checks in recent snapshots, sorted by label: the rows `checkedRows` keeps,
 * so a breakdown beside its total (a GitHub SKU), a day inside a billing month
 * (`github.daily_spend.<product>`), or a provider's declared projection (#223) is not offered,
 * because muting it would silence nothing.
 */
export const listAnomalyMetrics = cache(async (workspaceId: string): Promise<AnomalyMetric[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("usage_snapshots")
    .select(
      "connection_id, external_account_id, metric_key, kind, label, snapshot_date, value, unit, amount_minor, currency, period_start, period_end, point_at, resets_at, retrieved_at, provenance_source, pricing_source, connections(provider)",
    )
    .eq("workspace_id", workspaceId)
    .in("kind", [...ANOMALY_KINDS])
    .is("point_at", null)
    .order("snapshot_date", { ascending: false })
    .order("id", { ascending: true })
    .limit(SNAPSHOT_SCAN_LIMIT);
  if (error) throw new Error("Failed to list spend and usage metrics", { cause: error });
  // The rules run per snapshot date, so a date the limit cut short could keep a row its total
  // would have dropped: leave the oldest date out when the scan was full and holds more than one.
  const oldest = data.at(-1)?.snapshot_date;
  const full = data.length === SNAPSHOT_SCAN_LIMIT && data.some((row) => row.snapshot_date !== oldest);
  const scanned = full ? data.filter((row) => row.snapshot_date !== oldest) : data;
  const byKey = new Map<string, AnomalyMetric>();
  for (const row of checkedRows(scanned, declaredProjectedSpend)) {
    if (row.connections === null) continue;
    const key = `${row.connections.provider} ${row.metric_key}`;
    // Newest first, so the first label seen is the current one.
    if (!byKey.has(key)) byKey.set(key, { provider: row.connections.provider, metricKey: row.metric_key, label: row.label });
  }
  return [...byKey.values()].sort((a, b) => a.label.localeCompare(b.label, "en-US") || a.metricKey.localeCompare(b.metricKey));
});

/**
 * How many anomaly events the workspace had since `since`, and the newest few, for the dashboard.
 * Reads through `activity_events_workspace_timeline_idx` (workspace_id, occurred_at desc, id desc).
 */
export const getRecentAnomalies = cache(async (workspaceId: string, since: string): Promise<RecentAnomalies> => {
  const supabase = await createClient();
  const [counted, newest] = await Promise.all([
    supabase
      .from("activity_events")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("type_id", ANOMALY_TYPE_ID)
      .gte("occurred_at", since),
    supabase
      .from("activity_events")
      .select("id, title, body")
      .eq("workspace_id", workspaceId)
      .eq("type_id", ANOMALY_TYPE_ID)
      .gte("occurred_at", since)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(RECENT_ANOMALY_COUNT),
  ]);
  if (counted.error) throw new Error("Failed to count recent anomalies", { cause: counted.error });
  if (newest.error) throw new Error("Failed to list recent anomalies", { cause: newest.error });
  return { count: counted.count ?? newest.data.length, newest: newest.data };
});

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────

/** Turns detection on or off. False when row level security refused (the role changed). */
export async function setAnomalyDetectionEnabled(workspaceId: string, enabled: boolean): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspaces")
    .update({ anomaly_detection_enabled: enabled })
    .eq("id", workspaceId)
    .select("id");
  if (error) throw new Error("Failed to change the anomaly detection setting", { cause: error });
  return data.length > 0;
}

/** Mutes one metric. Muting a metric that is already muted is a success that changes nothing. */
export async function muteAnomalyMetric(workspaceId: string, provider: ProviderId, metricKey: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("anomaly_mutes")
    .upsert(
      { workspace_id: workspaceId, provider, metric_key: metricKey },
      { onConflict: "workspace_id,provider,metric_key", ignoreDuplicates: true },
    );
  if (error) throw new Error("Failed to mute the metric", { cause: error });
}

/** Removes a mute. False when no mute with `id` exists in this workspace. */
export async function unmuteAnomalyMetric(workspaceId: string, id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("anomaly_mutes")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error("Failed to unmute the metric", { cause: error });
  return data.length > 0;
}
