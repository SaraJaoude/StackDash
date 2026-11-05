import "server-only";

import { z } from "zod";

import { formatQuantity } from "@/lib/format";
import { createAdminClient } from "@/lib/supabase/admin";

import {
  formulaPath,
  PUBLIC_METRIC_IDS,
  PUBLISHED_METRIC_ROUNDINGS,
  publicMetricDefinition,
  type MetricProvenance,
  type MetricUnit,
  type PublicMetricId,
  type PublishedMetricDelay,
  type PublishedMetricRounding,
} from "./definitions";
import { publishedDisplay, UNAVAILABLE_LABELS } from "./display";
import { computePublicMetrics, type ComputedMetric, type PublicMetricStore, type UnavailableReason } from "./engine";
import { createSupabaseMetricStore } from "./supabase-store";

/*
 * The public read API of the metric engine (#148). Badges and cards (#149), public project pages
 * (#150), the yearly card (#151), and the leaderboard read published values only through here:
 *
 * - `loadPublishedProjectMetrics(projectId)`: every live publication of a project, computed now.
 * - `loadPublishedMetric(projectId, metricId)`: one engine metric, for a badge or a card. Takes a
 *   `PublicMetricId`, so a self-reported value can never become a badge.
 *
 * Both read `public_published_metrics()` (live rows only) with the service role and compute each
 * value from stored snapshots and events. Nothing here calls a provider, and nothing returned
 * names an account, a repository, or an amount of money. Both return null for a project that does
 * not exist and for one with nothing published, so a caller cannot tell the two apart.
 */

// Generated types mark every column of a set-returning function as non-null, but a row is either
// an engine metric or a self-reported value (published_metrics_source), so the rows are parsed.
const liveRowShape = {
  id: z.string(),
  workspace_id: z.string(),
  rounding: z.enum(PUBLISHED_METRIC_ROUNDINGS),
  delay_days: z.number(),
  published_at: z.string(),
};
const LiveRowSchema = z.union([
  z.object({
    ...liveRowShape,
    metric_id: z.enum(PUBLIC_METRIC_IDS),
    self_reported_label: z.null(),
    self_reported_value: z.null(),
    self_reported_unit: z.null(),
  }),
  z.object({
    ...liveRowShape,
    metric_id: z.null(),
    self_reported_label: z.string(),
    self_reported_value: z.number(),
    self_reported_unit: z.string(),
  }),
]);
type LiveRow = z.infer<typeof LiveRowSchema>;

export type PublishedValue =
  | Readonly<{
      status: "available";
      /** After the publication's rounding. */
      value: number;
      /** "1,204 stars", or "at least 1,200 stars" when rounded or a lower bound. */
      text: string;
      /** True when the value is rounded down or a lower bound: show it as "at least". */
      atLeast: boolean;
      /** The value is complete up to this sync. Show it beside the value. */
      lastSyncedAt: Date;
      /** Made up by the provider simulator (#131). Never show a simulated value as verified. */
      simulated: boolean;
    }>
  | Readonly<{ status: "unavailable"; reason: UnavailableReason; text: string }>;

export type PublishedEngineMetric = Readonly<{
  kind: "engine";
  /** The `published_metrics` row. */
  publicationId: string;
  metricId: PublicMetricId;
  label: string;
  unit: MetricUnit;
  provenance: MetricProvenance;
  /** Path of this metric's formula on the formulas page. */
  formulaPath: string;
  rounding: PublishedMetricRounding;
  delayDays: PublishedMetricDelay;
  publishedAt: Date;
  /** The moment the value describes: now, or `delayDays` before now. */
  asOf: Date;
  value: PublishedValue;
}>;

/** A value a person typed (#147). Project pages only: never a badge, never on a leaderboard. */
export type PublishedSelfReportedMetric = Readonly<{
  kind: "self_reported";
  publicationId: string;
  label: string;
  unit: string;
  provenance: "self_reported";
  value: number;
  text: string;
  publishedAt: Date;
}>;

export type PublishedMetric = PublishedEngineMetric | PublishedSelfReportedMetric;

export type PublishedProjectMetrics = Readonly<{
  projectId: string;
  workspaceId: string;
  /** Engine metrics in definition order, then self-reported values by label. */
  metrics: readonly PublishedMetric[];
}>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** `delay_days` is checked by the database to be 0 or 7. */
function asDelay(days: number): PublishedMetricDelay {
  if (days === 0 || days === 7) return days;
  throw new Error(`Unexpected published metric delay: ${days}`);
}

export function publishedValue(computed: ComputedMetric, unit: MetricUnit, rounding: PublishedMetricRounding): PublishedValue {
  const { result } = computed;
  if (result.status === "unavailable") {
    return { status: "unavailable", reason: result.reason, text: UNAVAILABLE_LABELS[result.reason] };
  }
  const display = publishedDisplay(result.value, unit, rounding, result.lowerBound);
  return {
    status: "available",
    value: display.value,
    text: display.text,
    atLeast: result.lowerBound || rounding !== "exact",
    lastSyncedAt: result.lastSyncedAt,
    simulated: result.simulated,
  };
}

type EngineRow = Readonly<{
  id: string;
  metricId: PublicMetricId;
  rounding: PublishedMetricRounding;
  delayDays: number;
  publishedAt: string;
}>;

/** Computes each live engine row at its own delay. Exported for the in-app settings page. */
export async function computePublishedEngineMetrics(
  store: PublicMetricStore,
  rows: readonly EngineRow[],
  now: Date,
): Promise<PublishedEngineMetric[]> {
  const requests = rows.map((row) => ({
    metricId: row.metricId,
    asOf: new Date(now.getTime() - asDelay(row.delayDays) * DAY_MS),
  }));
  const computed = await computePublicMetrics(store, requests);
  return rows.map((row, index) => {
    const result = computed[index];
    if (result === undefined) throw new Error("computePublicMetrics returned fewer results than requested");
    const definition = publicMetricDefinition(row.metricId);
    return {
      kind: "engine",
      publicationId: row.id,
      metricId: row.metricId,
      label: definition.label,
      unit: definition.unit,
      provenance: definition.provenance,
      formulaPath: formulaPath(row.metricId),
      rounding: row.rounding,
      delayDays: asDelay(row.delayDays),
      publishedAt: new Date(row.publishedAt),
      asOf: result.asOf,
      value: publishedValue(result, definition.unit, row.rounding),
    };
  });
}

export function selfReportedMetric(row: Readonly<{ id: string; label: string; value: number; unit: string; publishedAt: string }>): PublishedSelfReportedMetric {
  return {
    kind: "self_reported",
    publicationId: row.id,
    label: row.label,
    unit: row.unit,
    provenance: "self_reported",
    value: row.value,
    text: formatQuantity(row.value, row.unit),
    publishedAt: new Date(row.publishedAt),
  };
}

async function liveRows(projectId: string): Promise<LiveRow[]> {
  const { data, error } = await createAdminClient().rpc("public_published_metrics", { p_project_id: projectId });
  if (error) throw new Error("Failed to load published metrics", { cause: error });
  return z.array(LiveRowSchema).parse(data);
}

/** Every live publication of the project, computed at `now`, or null when nothing is published. */
export async function loadPublishedProjectMetrics(projectId: string, now: Date): Promise<PublishedProjectMetrics | null> {
  const rows = await liveRows(projectId);
  const first = rows[0];
  if (first === undefined) return null;

  const engineRows: EngineRow[] = [];
  const selfReported: PublishedSelfReportedMetric[] = [];
  for (const row of rows) {
    if (row.metric_id === null) {
      selfReported.push(
        selfReportedMetric({ id: row.id, label: row.self_reported_label, value: row.self_reported_value, unit: row.self_reported_unit, publishedAt: row.published_at }),
      );
    } else {
      engineRows.push({ id: row.id, metricId: row.metric_id, rounding: row.rounding, delayDays: row.delay_days, publishedAt: row.published_at });
    }
  }
  engineRows.sort((a, b) => PUBLIC_METRIC_IDS.indexOf(a.metricId) - PUBLIC_METRIC_IDS.indexOf(b.metricId));
  selfReported.sort((a, b) => a.label.localeCompare(b.label, "en-US"));
  const store = createSupabaseMetricStore(createAdminClient(), first.workspace_id, projectId);
  const engine = await computePublishedEngineMetrics(store, engineRows, now);
  return { projectId, workspaceId: first.workspace_id, metrics: [...engine, ...selfReported] };
}

/** One published engine metric of the project, computed at `now`, or null when it is not published. */
export async function loadPublishedMetric(projectId: string, metricId: PublicMetricId, now: Date): Promise<PublishedEngineMetric | null> {
  const row = (await liveRows(projectId)).find((candidate) => candidate.metric_id === metricId);
  if (row === undefined) return null;
  const store = createSupabaseMetricStore(createAdminClient(), row.workspace_id, projectId);
  const [metric] = await computePublishedEngineMetrics(
    store,
    [{ id: row.id, metricId, rounding: row.rounding, delayDays: row.delay_days, publishedAt: row.published_at }],
    now,
  );
  return metric ?? null;
}
