import "server-only";

import { cache } from "react";

import { SUGGESTED_PERCENTS, type AlertRuleValues, type ProviderId } from "@/lib/alerts/rule-schema";
import { afterCursorFilter, decodeCursor, encodeCursor, type Page } from "@/lib/data/cursor";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/**
 * Alert rules and the lookups the alerts page needs. Reads and writes run as the signed-in user,
 * so row level security (viewer reads, admin writes) and the column grants apply on top of the
 * role check every Server Action makes first. Every write is filtered by `workspace_id`, so an id
 * from another workspace matches nothing and reads exactly like a missing one.
 */

type Tables = Database["public"]["Tables"];

export type AlertRule = Pick<
  Tables["alert_rules"]["Row"],
  | "id"
  | "kind"
  | "scope"
  | "provider"
  | "project_id"
  | "connection_id"
  | "metric_key"
  | "budget_id"
  | "threshold_percent"
  | "threshold_amount_minor"
  | "currency"
  | "paused"
  | "created_at"
>;

export type ProjectOption = Pick<Tables["projects"]["Row"], "id" | "name">;
export type ConnectionOption = Pick<Tables["connections"]["Row"], "id" | "provider" | "display_name">;

export type ScopeTargets = { projects: ProjectOption[]; connections: ConnectionOption[] };

/** An allowance metric seen in this workspace's snapshots, offered as an optional rule filter. */
export type AllowanceMetric = { metricKey: string; label: string; connectionIds: string[] };

const RULE_COLUMNS =
  "id, kind, scope, provider, project_id, connection_id, metric_key, budget_id, threshold_percent, threshold_amount_minor, currency, paused, created_at" as const;

export const RULES_PAGE_SIZE = 50;
// Pickers list every project and connection; workspaces in the MVP have a handful of each.
const TARGET_LIMIT = 200;
// Recent snapshot rows scanned for allowance metric keys. Each sync writes one row per metric per
// account per day, so this covers the current metrics of any MVP-sized workspace.
const SNAPSHOT_SCAN_LIMIT = 1000;
const COVERAGE_LIMIT = 500;

const ALLOWANCE_KINDS = ["included_allowance", "remaining_allowance"] as const satisfies readonly Database["public"]["Enums"]["metric_kind"][];

// ── Reads ───────────────────────────────────────────────────────────────────────────────────────

/** One page of the workspace's alert rules, oldest first. */
export const listAlertRules = cache(
  async (workspaceId: string, after: string | null): Promise<Page<AlertRule>> => {
    const supabase = await createClient();
    let query = supabase.from("alert_rules").select(RULE_COLUMNS).eq("workspace_id", workspaceId);
    const cursor = decodeCursor(after);
    if (cursor !== null) query = query.or(afterCursorFilter("created_at", cursor));
    const { data, error } = await query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(RULES_PAGE_SIZE + 1);
    if (error) throw new Error("Failed to list alert rules", { cause: error });
    const items = data.slice(0, RULES_PAGE_SIZE);
    const last = items.at(-1);
    return {
      items,
      nextCursor: data.length > RULES_PAGE_SIZE && last !== undefined ? encodeCursor([last.created_at, last.id]) : null,
    };
  },
);

// Every rule, for the channel form's rule picker (#153); the same bound the alert evaluation reads.
const RULE_CHOICES_LIMIT = 500;

/** Every alert rule of the workspace, oldest first, for choosing which ones a channel receives. */
export const listAlertRuleChoices = cache(async (workspaceId: string): Promise<AlertRule[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .select(RULE_COLUMNS)
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(RULE_CHOICES_LIMIT);
  if (error) throw new Error("Failed to list alert rules", { cause: error });
  return data;
});

/** The ids among `ids` that are rules of this workspace; anything else (deleted, foreign) is dropped. */
export async function existingRuleIds(workspaceId: string, ids: readonly string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .select("id")
    .eq("workspace_id", workspaceId)
    .in("id", [...ids])
    .limit(RULE_CHOICES_LIMIT);
  if (error) throw new Error("Failed to check alert rules", { cause: error });
  return data.map((row) => row.id);
}

/** Projects and connections a rule or budget can be scoped to. */
export const listScopeTargets = cache(async (workspaceId: string): Promise<ScopeTargets> => {
  const supabase = await createClient();
  const [projects, connections] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      .limit(TARGET_LIMIT),
    supabase
      .from("connections")
      .select("id, provider, display_name")
      .eq("workspace_id", workspaceId)
      .order("display_name", { ascending: true })
      .order("id", { ascending: true })
      .limit(TARGET_LIMIT),
  ]);
  if (projects.error) throw new Error("Failed to list projects", { cause: projects.error });
  if (connections.error) throw new Error("Failed to list connections", { cause: connections.error });
  return { projects: projects.data, connections: connections.data };
});

/** Allowance metric keys present in recent snapshots, with the connections that report them. */
export const listAllowanceMetrics = cache(async (workspaceId: string): Promise<AllowanceMetric[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("usage_snapshots")
    .select("metric_key, label, connection_id")
    .eq("workspace_id", workspaceId)
    .in("kind", [...ALLOWANCE_KINDS])
    .order("snapshot_date", { ascending: false })
    .order("id", { ascending: true })
    .limit(SNAPSHOT_SCAN_LIMIT);
  if (error) throw new Error("Failed to list allowance metrics", { cause: error });
  const byKey = new Map<string, { label: string; connectionIds: Set<string> }>();
  for (const row of data) {
    const entry = byKey.get(row.metric_key);
    // Newest first, so the first label seen is the current one.
    if (entry === undefined) byKey.set(row.metric_key, { label: row.label, connectionIds: new Set([row.connection_id]) });
    else entry.connectionIds.add(row.connection_id);
  }
  return [...byKey]
    .map(([metricKey, { label, connectionIds }]) => ({ metricKey, label, connectionIds: [...connectionIds] }))
    .sort((a, b) => a.label.localeCompare(b.label, "en-US") || a.metricKey.localeCompare(b.metricKey));
});

/** What existing allowance rules cover, for deciding which providers get suggested alerts. */
export const listAllowanceRuleCoverage = cache(async (workspaceId: string) => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .select("scope, provider, connection_id")
    .eq("workspace_id", workspaceId)
    .eq("kind", "allowance_percent")
    .limit(COVERAGE_LIMIT);
  if (error) throw new Error("Failed to list allowance rules", { cause: error });
  return data;
});

/**
 * Which of the given project, connection, and budget ids do not belong to this workspace. Ids
 * come from the browser, so they are re-read here rather than trusted; a missing id and another
 * workspace's id give the same answer.
 */
export async function findForeignTargets(
  workspaceId: string,
  ids: { projectId: string | null; connectionId: string | null; budgetId: string | null },
): Promise<Array<"projectId" | "connectionId" | "budgetId">> {
  const supabase = await createClient();
  const [project, connection, budget] = await Promise.all([
    ids.projectId === null
      ? null
      : supabase.from("projects").select("id").eq("workspace_id", workspaceId).eq("id", ids.projectId).maybeSingle(),
    ids.connectionId === null
      ? null
      : supabase
          .from("connections")
          .select("id")
          .eq("workspace_id", workspaceId)
          .eq("id", ids.connectionId)
          .maybeSingle(),
    ids.budgetId === null
      ? null
      : supabase.from("budgets").select("id").eq("workspace_id", workspaceId).eq("id", ids.budgetId).maybeSingle(),
  ]);
  const foreign: Array<"projectId" | "connectionId" | "budgetId"> = [];
  for (const [field, result] of [
    ["projectId", project],
    ["connectionId", connection],
    ["budgetId", budget],
  ] as const) {
    if (result === null) continue;
    if (result.error) throw new Error(`Failed to check the ${field} target`, { cause: result.error });
    if (result.data === null) foreign.push(field);
  }
  return foreign;
}

// ── Writes ──────────────────────────────────────────────────────────────────────────────────────

export async function insertAlertRule(workspaceId: string, values: AlertRuleValues): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.from("alert_rules").insert({ ...values, workspace_id: workspaceId });
  if (error) throw new Error("Failed to create alert rule", { cause: error });
}

/** Replaces a rule's settings. False when no rule with `id` exists in this workspace. */
export async function updateAlertRule(workspaceId: string, id: string, values: AlertRuleValues): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .update(values)
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error("Failed to update alert rule", { cause: error });
  return data.length > 0;
}

export async function setAlertRulePaused(workspaceId: string, id: string, paused: boolean): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .update({ paused })
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error("Failed to pause or resume alert rule", { cause: error });
  return data.length > 0;
}

export async function deleteAlertRule(workspaceId: string, id: string): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("alert_rules")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("id", id)
    .select("id");
  if (error) throw new Error("Failed to delete alert rule", { cause: error });
  return data.length > 0;
}

/**
 * Adds the suggested allowance rules (75, 90, and 100 percent of every allowance) for one
 * provider, skipping thresholds that already have a provider-wide rule, so a double click never
 * creates duplicates. Returns how many were added.
 */
export async function insertSuggestedAllowanceRules(workspaceId: string, provider: ProviderId): Promise<number> {
  const supabase = await createClient();
  const { data: existing, error: readError } = await supabase
    .from("alert_rules")
    .select("threshold_percent")
    .eq("workspace_id", workspaceId)
    .eq("kind", "allowance_percent")
    .eq("scope", "provider")
    .eq("provider", provider)
    .is("metric_key", null)
    .limit(COVERAGE_LIMIT);
  if (readError) throw new Error("Failed to read existing allowance rules", { cause: readError });
  const taken = new Set(existing.map((row) => row.threshold_percent));
  const rows = SUGGESTED_PERCENTS.filter((percent) => !taken.has(percent)).map((percent) => ({
    workspace_id: workspaceId,
    kind: "allowance_percent" as const,
    scope: "provider" as const,
    provider,
    threshold_percent: percent,
  }));
  if (rows.length === 0) return 0;
  const { error } = await supabase.from("alert_rules").insert(rows);
  if (error) throw new Error("Failed to add suggested alert rules", { cause: error });
  return rows.length;
}
