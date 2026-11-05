import Link from "next/link";

import { AlertSeverityLabel, AlertTime, EstimatedBadge } from "@/components/alerts/triggered-alerts";
import { ANOMALY_TYPE_ID } from "@/lib/alerts/anomaly";
import { RECENT_ANOMALY_DAYS, type RecentAnomalies } from "@/lib/data/anomalies";
import type { UnacknowledgedSummary } from "@/lib/data/triggered-alerts";
import type { WorkspaceRef } from "@/lib/data/workspaces";
import { workspacePath } from "@/lib/workspaces/paths";

const TITLE_ID = "alerts-summary-title";

/**
 * Unacknowledged alerts on the dashboard: how many, the newest three, and the way to the full
 * list, followed by the unusual days anomaly detection found in the last week (#169). One plain
 * line with no panel when there is nothing to act on, so it never pushes the numbers down. Zero is
 * said in words, so "no alerts" never looks like "not loaded".
 */
export function AlertsSummary({
  workspace,
  summary,
  anomalies,
}: {
  workspace: WorkspaceRef;
  summary: UnacknowledgedSummary;
  anomalies: RecentAnomalies;
}) {
  const { count, newest } = summary;
  const allAlertsLink = (
    <Link
      href={workspacePath(workspace.slug, "alerts")}
      className="ml-auto inline-flex min-h-6 items-center text-accent underline underline-offset-2"
    >
      View all alerts
    </Link>
  );
  if (count === 0 && anomalies.count === 0) {
    return (
      <section aria-labelledby={TITLE_ID} className="mt-4 flex flex-wrap items-center gap-x-3 text-sm">
        <h2 id={TITLE_ID} className="text-sm font-semibold">
          Alerts
        </h2>
        <p className="text-muted">No unacknowledged alerts</p>
        {allAlertsLink}
      </section>
    );
  }
  return (
    <section aria-labelledby={TITLE_ID} className="mt-6 rounded-xl border border-line bg-panel">
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <h2 id={TITLE_ID} className="font-semibold">
          Alerts
        </h2>
        <p className={count === 0 ? "text-muted" : "font-medium"}>
          {count === 0
            ? "No unacknowledged alerts"
            : count === 1
              ? "1 unacknowledged alert"
              : `${count} unacknowledged alerts`}
        </p>
        {allAlertsLink}
      </div>
      {newest.length === 0 ? null : (
        <ul aria-label="Newest unacknowledged alerts" className="divide-y divide-line border-t border-line">
          {newest.map((alert) => (
            <li key={alert.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <AlertSeverityLabel severity={alert.severity} />
                {alert.is_estimated ? <EstimatedBadge /> : null}
                <span className="text-xs text-muted">
                  Triggered <AlertTime iso={alert.triggered_at} />
                </span>
              </div>
              <p className="mt-1 break-words text-sm leading-6">{alert.message}</p>
            </li>
          ))}
        </ul>
      )}
      {anomalies.count === 0 ? null : <UnusualDays workspace={workspace} anomalies={anomalies} />}
    </section>
  );
}

function UnusualDays({ workspace, anomalies }: { workspace: WorkspaceRef; anomalies: RecentAnomalies }) {
  const headingId = `${TITLE_ID}-unusual`;
  const countText =
    anomalies.count === 1
      ? `1 unusual day in the last ${RECENT_ANOMALY_DAYS} days`
      : `${anomalies.count} unusual days in the last ${RECENT_ANOMALY_DAYS} days`;
  return (
    <div className="border-t border-line">
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <h3 id={headingId} className="font-semibold">
          Unusual spend and usage
        </h3>
        <p className="font-medium">{countText}</p>
        <Link
          href={`${workspacePath(workspace.slug, "timeline")}?type=${ANOMALY_TYPE_ID}`}
          className="ml-auto inline-flex min-h-6 items-center text-accent underline underline-offset-2"
        >
          Show unusual days on the timeline
        </Link>
      </div>
      <ul aria-labelledby={headingId} className="divide-y divide-line border-t border-line">
        {anomalies.newest.map((anomaly) => (
          <li key={anomaly.id} className="px-4 py-3">
            <AlertSeverityLabel severity="warning" />
            <p className="mt-1 break-words text-sm font-medium leading-6">{anomaly.title}</p>
            {anomaly.body === null ? null : (
              <p className="whitespace-pre-line break-words text-sm leading-6 text-muted">{anomaly.body}</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
