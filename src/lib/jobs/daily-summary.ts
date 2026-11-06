import type { ProviderAdapter } from "@/lib/adapters/types";
import { anomalyEvent, anomalySnapshotRange, findAnomalies } from "@/lib/alerts/anomaly";
import { countedSnapshots, type ProviderId } from "@/lib/dashboard/aggregate";
import { formatMoney, formatQuantity } from "@/lib/format";
import { providerName } from "@/lib/providers";

import { utcDate } from "./ingest";
import type { ClaimedJob, EventRow, SummaryConnection, SummarySnapshot } from "./store";
import type { JobOutcome, SyncDeps } from "./sync-connection";

/*
 * Daily summary (#64): one `devmacro.daily_summary` timeline event per workspace per UTC day,
 * listing the previous UTC day's usage and spending per provider from usage_snapshots.
 *
 * - Each value is labeled verified (reported by the provider), estimated (calculated by DevMacro),
 *   or unavailable (no snapshot that day), never shown as 0 when missing.
 * - Money is summed per provider and currency only, never across currencies, and each amount
 *   once: the day's rows go through the dashboard's `countedSnapshots`, so a GitHub SKU or day
 *   is not added to its product's month again.
 * - The event's dedupe key names the day, so a job that runs twice writes one event.
 * - Anomaly detection (#169) runs in the same job, right after the summary is built: one
 *   `devmacro.anomaly_detected` event per unusual metric, unless the workspace turned it off or
 *   muted the metric. Running totals are checked on the summarized day, one day periods on the
 *   day before, whose row the provider has stored by then. See src/lib/alerts/anomaly.ts.
 */

export const DAILY_SUMMARY_TYPE_ID = "devmacro.daily_summary";
const DAY_MS = 86_400_000;

/** The UTC day a summary job created at `createdAt` reports on: the day before. */
export function summaryDate(createdAt: Date): string {
  return utcDate(new Date(createdAt.getTime() - DAY_MS));
}

export function dailySummaryJobKey(workspaceId: string, date: string): string {
  return `daily_summary:${workspaceId}:${date}`;
}

export function dailySummaryEventKey(date: string): string {
  return `daily_summary:${date}`;
}

type Source = "verified" | "estimated";

type ProviderInfo = Readonly<{ name: string; usage: boolean; spending: boolean }>;

function lines(provider: ProviderInfo, rows: readonly SummarySnapshot[]): string[] {
  const spend = new Map<string, { source: Source; currency: string; amountMinor: number }>();
  const usage = new Map<string, { source: Source; label: string; unit: string; value: number }>();

  for (const row of rows) {
    if ((row.kind === "verified_spend" || row.kind === "estimated_spend") && row.amount_minor !== null && row.currency !== null) {
      const source: Source = row.kind === "verified_spend" ? "verified" : "estimated";
      const key = `${source} ${row.currency}`;
      const current = spend.get(key);
      if (current === undefined) spend.set(key, { source, currency: row.currency, amountMinor: row.amount_minor });
      else current.amountMinor += row.amount_minor;
    } else if (row.kind === "usage" && row.value !== null && row.unit !== null) {
      const source: Source = row.provenance_source === "derived" ? "estimated" : "verified";
      const key = `${source} ${row.metric_key} ${row.unit}`;
      const current = usage.get(key);
      if (current === undefined) usage.set(key, { source, label: row.label, unit: row.unit, value: row.value });
      else current.value += row.value;
    }
  }

  const parts: string[] = [];
  if (spend.size > 0) {
    const sorted = [...spend.values()].sort(
      (a, b) => a.source.localeCompare(b.source) || a.currency.localeCompare(b.currency),
    );
    for (const item of sorted) parts.push(`Spending ${formatMoney(item.amountMinor, item.currency)} (${item.source})`);
  } else if (provider.spending) {
    parts.push("Spending unavailable");
  }
  if (usage.size > 0) {
    const sorted = [...usage.values()].sort((a, b) => a.label.localeCompare(b.label));
    for (const item of sorted) parts.push(`${item.label} ${formatQuantity(item.value, item.unit)} (${item.source})`);
  } else if (provider.usage) {
    parts.push("Usage unavailable");
  }
  if (parts.length === 0) parts.push("Usage and spending unavailable");
  return parts.map((part) => `${provider.name}: ${part}`);
}

/**
 * Builds the summary event, or null when the workspace has no connections. Pure: the caller
 * passes the connections, the day's snapshots, and the provider lookup.
 */
export function buildDailySummary(input: {
  workspaceId: string;
  date: string;
  connections: readonly SummaryConnection[];
  snapshots: readonly SummarySnapshot[];
  provider: (id: ProviderId) => ProviderInfo;
}): EventRow | null {
  if (input.connections.length === 0) return null;
  const providerOf = new Map(input.connections.map((connection) => [connection.id, connection.provider]));
  const byProvider = new Map<ProviderId, SummarySnapshot[]>();
  for (const connection of input.connections) byProvider.set(connection.provider, []);
  for (const row of countedSnapshots(input.snapshots)) {
    const provider = providerOf.get(row.connection_id);
    if (provider !== undefined) byProvider.get(provider)?.push(row);
  }

  const providers = [...byProvider.entries()]
    .map(([id, rows]) => ({ info: input.provider(id), rows }))
    .sort((a, b) => a.info.name.localeCompare(b.info.name));
  return {
    workspace_id: input.workspaceId,
    connection_id: null,
    external_account_id: null,
    provider: null,
    type_id: DAILY_SUMMARY_TYPE_ID,
    severity: "info",
    title: `Daily summary for ${input.date}`,
    body: providers.flatMap(({ info, rows }) => lines(info, rows)).join("\n"),
    url: null,
    // The end of the summarized day, so the summary sorts after everything it describes.
    occurred_at: new Date(Date.parse(`${input.date}T00:00:00.000Z`) + DAY_MS).toISOString(),
    dedupe_key: dailySummaryEventKey(input.date),
  };
}

function providerInfo(getAdapter: (id: ProviderId) => ProviderAdapter, id: ProviderId): ProviderInfo {
  const name = providerName(id);
  try {
    const { capabilities } = getAdapter(id);
    return { name, usage: capabilities.usage, spending: capabilities.spending };
  } catch {
    // A provider no longer enabled on this instance still gets a line, without capability hints.
    return { name, usage: false, spending: false };
  }
}

export async function runDailySummaryJob(job: ClaimedJob, deps: SyncDeps): Promise<JobOutcome> {
  if (job.workspace_id === null) return { status: "failed", errorCode: "invalid_job", errorReference: null };
  const workspaceId = job.workspace_id;
  // The job key names the summarized day; it is set when the job is queued, so a job created a
  // moment after midnight still reports on the day the scheduler meant.
  const keyed = job.dedupe_key?.match(/^daily_summary:[^:]+:(\d{4}-\d{2}-\d{2})$/)?.[1];
  const date = keyed ?? summaryDate(new Date(job.created_at));
  const range = anomalySnapshotRange(date);
  const [connections, snapshots, anomalySettings, anomalyRows] = await Promise.all([
    deps.store.listSummaryConnections(workspaceId),
    deps.store.listSnapshotsForDate(workspaceId, date),
    deps.store.getAnomalySettings(workspaceId),
    deps.store.listAnomalySnapshots(workspaceId, range.from, range.to),
  ]);
  const event = buildDailySummary({
    workspaceId,
    date,
    connections,
    snapshots,
    provider: (id) => providerInfo(deps.getAdapter, id),
  });
  if (event === null) return { status: "succeeded" };
  const anomalies = anomalySettings.enabled
    ? findAnomalies({ date, rows: anomalyRows, connections, mutes: anomalySettings.mutes })
    : [];
  await deps.store.insertEvents([event, ...anomalies.map((anomaly) => anomalyEvent(workspaceId, anomaly))]);
  if (anomalies.length > 0) deps.log.info("anomalies.detected", { workspaceId, date, count: anomalies.length });
  return { status: "succeeded" };
}
