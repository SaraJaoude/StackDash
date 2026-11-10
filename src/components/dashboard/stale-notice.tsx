import { useId } from "react";

import { SyncNowForm } from "@/components/connections/connection-controls";
import { cooldownRemainingSeconds, syncCooldownNotice } from "@/components/connections/cooldown";
import { LockIcon } from "@/components/icons";
import { staleNoticeText, type StaleNotice as Notice } from "@/lib/dashboard/aggregate";
import { MANUAL_SYNC_COOLDOWN_SECONDS } from "@/lib/jobs/queue";
import { actionDeniedReason } from "@/lib/workspaces/permissions";

import { StaleIcon } from "./value-meta";

/**
 * The dashboard's one stale notice (#267), in place of a stale line on every value: since when
 * most or all connections have not synced, and the same "Sync now" as a connection's page, for
 * every stale connection at once. While every one of them is in its Sync now cooldown, the button
 * is unavailable with the same hint as on a connection's page (#161). Members who cannot manage
 * connections are told why there is no button. The warning is in words and an icon, never in color
 * alone.
 */
export function StaleNotice({
  notice,
  now,
  workspaceSlug,
  canSync,
}: {
  notice: Notice;
  now: Date;
  workspaceSlug: string;
  canSync: boolean;
}) {
  const titleId = useId();
  const { title, body } = staleNoticeText(notice, now);
  return (
    <section aria-labelledby={titleId} className="mt-6 rounded-xl border border-warning/50 bg-panel px-5 py-4 text-sm">
      <h2 id={titleId} className="flex items-center gap-2 font-semibold text-warning">
        <StaleIcon className="shrink-0" />
        {title}
      </h2>
      <p className="mt-1 max-w-3xl leading-6 text-muted">{body}</p>
      {canSync ? (
        <div className="mt-3 flex">
          <SyncNowForm
            workspaceSlug={workspaceSlug}
            connectionIds={notice.connections.map((connection) => connection.connectionId)}
            cooldownNotice={syncCooldownNotice(
              cooldownRemainingSeconds(
                notice.syncRequestedAt === null ? null : new Date(notice.syncRequestedAt),
                MANUAL_SYNC_COOLDOWN_SECONDS,
                now,
              ),
            )}
          />
        </div>
      ) : (
        <p className="mt-3 flex items-center gap-2 text-muted">
          <LockIcon className="shrink-0" />
          <span>{actionDeniedReason("manage_connections")}</span>
        </p>
      )}
    </section>
  );
}
