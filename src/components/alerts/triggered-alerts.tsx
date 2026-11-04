import Link from "next/link";

import { SeverityBadge } from "@/components/severity-badge";
import type { AlertSeverity } from "@/lib/alerts/evaluate";
import { hasTriggeredAlerts, listTriggeredAlerts, type TriggeredAlert } from "@/lib/data/triggered-alerts";
import type { WorkspaceRef } from "@/lib/data/workspaces";
import { formatDateTime } from "@/lib/format";
import { workspacePath } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform, type WorkspaceRole } from "@/lib/workspaces/permissions";

import { AcknowledgeAnnouncer, AcknowledgeButton } from "./acknowledge-button";
import { DeniedReason } from "./form-controls";

/**
 * Triggered alerts, newest first: what fired, how bad, and whether someone has acknowledged it.
 * Acknowledged alerts stay in the history and show with `?acknowledged=show`.
 */

const HEADING_ID = "triggered-alerts-title";
// Anchors rendered by AlertSettings further down the same page.
const ADD_RULE_ANCHOR = "#add-alert-rule";
const RULES_ANCHOR = "#alert-rules-title";

const linkClass = "text-accent underline underline-offset-2";

function WarningIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-warning">
      <path d="M8 1.75 15 14.25H1L8 1.75Z" strokeLinejoin="round" />
      <path d="M8 6v4M8 12v.01" strokeLinecap="round" />
    </svg>
  );
}

function CriticalIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" className="shrink-0 text-danger">
      <path d="M5.1 1.5h5.8l4.1 4.1v5.8l-4.1 4.1H5.1L1 11.4V5.6l4.1-4.1Z" strokeLinejoin="round" />
      <path d="M8 4.5v4.5M8 11.5v.01" strokeLinecap="round" />
    </svg>
  );
}

/** Severity as an icon and a word, so color never carries it alone. */
export function AlertSeverityLabel({ severity }: { severity: AlertSeverity }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      {severity === "critical" ? <CriticalIcon /> : <WarningIcon />}
      <SeverityBadge severity={severity === "critical" ? "Critical" : "Warning"} />
    </span>
  );
}

export function EstimatedBadge() {
  return (
    <span className="inline-flex min-h-6 items-center rounded-full border border-line-strong px-2.5 text-xs font-medium text-muted">
      Estimated
    </span>
  );
}

/** "2026-10-31 14:05 GMT" in Europe/London, as a machine-readable `<time>`. */
export function AlertTime({ iso }: { iso: string }) {
  return <time dateTime={new Date(iso).toISOString()}>{formatDateTime(iso)}</time>;
}

function acknowledgedByLabel(acknowledgedBy: string | null, userId: string): string {
  if (acknowledgedBy === null) return "a former member";
  return acknowledgedBy === userId ? "you" : "another member";
}

export async function TriggeredAlerts({
  workspace,
  role,
  userId,
  showAcknowledged,
  after,
}: {
  workspace: WorkspaceRef;
  role: WorkspaceRole;
  userId: string;
  showAcknowledged: boolean;
  after: string | null;
}) {
  const canAcknowledge = canPerform(role, "acknowledge_alert");
  const canManageRules = canPerform(role, "manage_budgets");
  const [page, anyFired] = await Promise.all([
    listTriggeredAlerts(workspace.id, showAcknowledged, after),
    // Only needed to tell "nothing ever fired" from "everything is acknowledged".
    showAcknowledged ? null : hasTriggeredAlerts(workspace.id),
  ]);

  const alertsPath = workspacePath(workspace.slug, "alerts");
  const hrefFor = (show: boolean, cursor: string | null) => {
    const query = new URLSearchParams();
    if (show) query.set("acknowledged", "show");
    if (cursor !== null) query.set("alertsAfter", cursor);
    const text = query.toString();
    return text === "" ? alertsPath : `${alertsPath}?${text}`;
  };
  const successMessage = showAcknowledged
    ? "Alert acknowledged. It stays in the alert history."
    : "Alert acknowledged. It stays in the alert history. Choose Show acknowledged alerts to see it.";
  const nothingFired = page.items.length === 0 && after === null && (showAcknowledged || anyFired === false);

  return (
    <section aria-labelledby={HEADING_ID} className="mt-8 rounded-xl border border-line bg-panel">
      <div className="flex flex-col gap-3 border-b border-line px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id={HEADING_ID} tabIndex={-1} className="text-sm font-semibold">
            Triggered alerts
          </h2>
          <p className="mt-1 text-sm text-muted">
            {showAcknowledged
              ? "Every alert that has fired, newest first, including acknowledged ones."
              : "Alerts nobody has acknowledged yet, newest first. Acknowledged alerts stay in the history."}
          </p>
          {canAcknowledge ? null : <DeniedReason>{actionDeniedReason("acknowledge_alert")}</DeniedReason>}
        </div>
        <Link href={hrefFor(!showAcknowledged, null)} className={`shrink-0 text-sm ${linkClass}`}>
          {showAcknowledged ? "Hide acknowledged alerts" : "Show acknowledged alerts"}
        </Link>
      </div>

      <AcknowledgeAnnouncer>
        {nothingFired ? (
          <div className="px-6 py-5 text-sm">
            <p className="font-medium">No alerts have fired</p>
            <p className="mt-1 text-muted">
              {canManageRules ? (
                <>
                  <a href={ADD_RULE_ANCHOR} className={linkClass}>
                    Add an alert rule
                  </a>{" "}
                  to hear about usage or spend before it becomes a problem.
                </>
              ) : (
                <>
                  Alerts appear here when an{" "}
                  <a href={RULES_ANCHOR} className={linkClass}>
                    alert rule
                  </a>{" "}
                  crosses its threshold.
                </>
              )}
            </p>
          </div>
        ) : page.items.length === 0 ? (
          <div className="px-6 py-5 text-sm">
            <p className="font-medium">No unacknowledged alerts</p>
            <p className="mt-1 text-muted">Every alert that has fired is acknowledged.</p>
          </div>
        ) : (
          <ul aria-label="Triggered alerts" className="divide-y divide-line">
            {page.items.map((alert) => (
              <TriggeredAlertItem
                key={alert.id}
                alert={alert}
                userId={userId}
                acknowledge={
                  canAcknowledge
                    ? { workspaceSlug: workspace.slug, successMessage, afterAcknowledgeFocusId: HEADING_ID }
                    : null
                }
              />
            ))}
          </ul>
        )}
      </AcknowledgeAnnouncer>

      {page.nextCursor === null && after === null ? null : (
        <nav aria-label="Triggered alert pages" className="flex flex-wrap gap-4 border-t border-line px-6 py-3 text-sm">
          {after === null ? null : (
            <Link href={hrefFor(showAcknowledged, null)} className={linkClass}>
              Show the newest alerts
            </Link>
          )}
          {page.nextCursor === null ? null : (
            <Link href={hrefFor(showAcknowledged, page.nextCursor)} className={linkClass}>
              Show older alerts
            </Link>
          )}
        </nav>
      )}
    </section>
  );
}

function TriggeredAlertItem({
  alert,
  userId,
  acknowledge,
}: {
  alert: TriggeredAlert;
  userId: string;
  acknowledge: { workspaceSlug: string; successMessage: string; afterAcknowledgeFocusId: string } | null;
}) {
  return (
    <li className="flex flex-col gap-3 px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
      <article className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <AlertSeverityLabel severity={alert.severity} />
          {alert.is_estimated ? <EstimatedBadge /> : null}
        </div>
        <p className="mt-2 break-words text-sm leading-6">{alert.message}</p>
        <p className="mt-1 text-sm text-muted">
          Threshold {alert.threshold_label}
          <span aria-hidden="true"> · </span>
          <span className="sr-only">. </span>
          Triggered <AlertTime iso={alert.triggered_at} />
        </p>
        <p className="mt-1 text-sm">
          {alert.acknowledged_at === null ? (
            <span className="text-muted">Not acknowledged</span>
          ) : (
            <span className="text-success">
              Acknowledged by {acknowledgedByLabel(alert.acknowledged_by, userId)} on{" "}
              <AlertTime iso={alert.acknowledged_at} />
            </span>
          )}
        </p>
      </article>
      {acknowledge === null || alert.acknowledged_at !== null ? null : (
        <AcknowledgeButton
          workspaceSlug={acknowledge.workspaceSlug}
          alertId={alert.id}
          accessibleSuffix={alert.message}
          successMessage={acknowledge.successMessage}
          afterAcknowledgeFocusId={acknowledge.afterAcknowledgeFocusId}
        />
      )}
    </li>
  );
}
