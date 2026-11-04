import Link from "next/link";
import { Suspense } from "react";

import { AlertSeverityLabel, AlertTime, EstimatedBadge } from "@/components/alerts/triggered-alerts";
import { getUnacknowledgedSummary } from "@/lib/data/triggered-alerts";
import type { WorkspaceRef } from "@/lib/data/workspaces";
import { workspacePath } from "@/lib/workspaces/access";

const TITLE_ID = "alerts-summary-title";

/**
 * Unacknowledged alerts on the dashboard: how many, the newest three, and the way to the full
 * list. Zero is said in words, so "no alerts" never looks like "not loaded".
 */
export function AlertsSummary({ workspace }: { workspace: WorkspaceRef }) {
  return (
    <Suspense
      fallback={
        <p role="status" className="mt-8 text-sm text-muted">
          Loading alerts
        </p>
      }
    >
      <AlertsSummaryContent workspace={workspace} />
    </Suspense>
  );
}

async function AlertsSummaryContent({ workspace }: { workspace: WorkspaceRef }) {
  const { count, newest } = await getUnacknowledgedSummary(workspace.id);
  return (
    <section aria-labelledby={TITLE_ID} className="mt-8 rounded-xl border border-line bg-panel">
      <div className="flex flex-wrap items-baseline justify-between gap-3 border-b border-line px-5 py-4">
        <h2 id={TITLE_ID} className="text-sm font-semibold">
          Alerts
        </h2>
        <Link
          href={workspacePath(workspace.slug, "alerts")}
          className="inline-flex min-h-6 items-center text-sm text-accent underline underline-offset-2"
        >
          View all alerts
        </Link>
      </div>
      {count === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">No unacknowledged alerts</p>
      ) : (
        <>
          <p className="px-5 pt-4 text-sm">
            {count === 1 ? "1 unacknowledged alert" : `${count} unacknowledged alerts`}
          </p>
          <ul aria-label="Newest unacknowledged alerts" className="divide-y divide-line">
            {newest.map((alert) => (
              <li key={alert.id} className="px-5 py-3">
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
        </>
      )}
    </section>
  );
}
