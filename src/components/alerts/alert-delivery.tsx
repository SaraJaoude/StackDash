import { listDestinations } from "@/lib/data/notification-destinations";
import { getEmailFrequency } from "@/lib/data/notification-preferences";
import type { WorkspaceRef } from "@/lib/data/workspaces";
import { emailEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { logError } from "@/lib/log/logger";
import { describeFailure } from "@/lib/notifications/channels";
import { ALERT_EMAILS_SECTION_ID } from "@/lib/notifications/links";
import { actionDeniedReason, canPerform, type WorkspaceRole } from "@/lib/workspaces/permissions";

import { AlertEmailsForm } from "./alert-emails";
import { ChannelForm, ChannelListItem, type ChannelRow } from "./alert-channels";
import { DeniedReason } from "./form-controls";
import { defaultChannelValues, type Option } from "./labels";

/*
 * Where alerts go (#152, #153): the signed-in member's alert emails, and the workspace's channels.
 * Part of the alerts page, below rules and budgets, because a channel picks the rules it receives.
 */

const CHANNELS_HEADING_ID = "alert-channels";
const ADD_CHANNEL_HEADING_ID = "add-alert-channel";

/** Whether this instance can send email. A broken configuration is logged once per render with a reference. */
function emailStatus(): { kind: "ready" } | { kind: "off" } | { kind: "broken"; referenceId: string } {
  try {
    return emailEnv() === null ? { kind: "off" } : { kind: "ready" };
  } catch (error) {
    return { kind: "broken", referenceId: logError("alerts.email_config_invalid", error) };
  }
}

export async function AlertDelivery({
  workspace,
  role,
  userId,
  ruleOptions,
}: {
  workspace: WorkspaceRef;
  role: WorkspaceRole;
  userId: string;
  ruleOptions: Option[];
}) {
  const canReceive = canPerform(role, "receive_alert_email");
  const canManage = canPerform(role, "manage_alert_channels");
  const [frequency, destinations] = await Promise.all([
    canReceive ? getEmailFrequency(workspace.id, userId) : Promise.resolve(null),
    listDestinations(workspace.id),
  ]);
  const email = emailStatus();

  const rows: ChannelRow[] = destinations.map((destination) => ({
    id: destination.id,
    kind: destination.kind,
    name: destination.name,
    host: destination.url_host,
    allRules: destination.all_rules,
    ruleIds: destination.rule_ids,
    digest: destination.digest,
    needsAttention: destination.status === "needs_attention",
    problem:
      destination.last_error_code === null
        ? null
        : `${describeFailure(destination.last_error_code)}.${destination.last_error_reference === null ? "" : ` Reference ${destination.last_error_reference}.`}${
            destination.status === "needs_attention" ? " Fix the webhook, then send a test message to turn it back on." : ""
          }`,
    lastDelivered: destination.last_delivered_at === null ? null : formatDateTime(destination.last_delivered_at),
  }));

  return (
    <>
      <section aria-labelledby={ALERT_EMAILS_SECTION_ID} className="mt-8 rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-6 py-4">
          <h2 id={ALERT_EMAILS_SECTION_ID} tabIndex={-1} className="text-sm font-semibold">
            Alert emails
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Alerts are emailed to the owners and admins of this workspace, each at most once per billing period. Several
            alerts found at the same time arrive in one email. Every email has a link to unsubscribe.
          </p>
        </div>
        <div className="px-6 py-5">
          {email.kind === "off" ? (
            <p className="mb-4 text-sm text-muted">
              Email is not set up on this instance, so nothing is sent yet. Your choice is kept for when it is. Channels
              below still work.
            </p>
          ) : email.kind === "broken" ? (
            <p className="mb-4 text-sm text-danger">
              Email is set up incorrectly on this instance, so nothing is sent. Ask whoever runs it to check the email
              settings. Reference <code className="font-mono text-xs text-foreground">{email.referenceId}</code>.
            </p>
          ) : null}
          {frequency === null ? (
            <DeniedReason>{actionDeniedReason("receive_alert_email")}</DeniedReason>
          ) : (
            <AlertEmailsForm workspaceSlug={workspace.slug} current={frequency} />
          )}
        </div>
      </section>

      <section aria-labelledby={CHANNELS_HEADING_ID} className="mt-8 rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-6 py-4">
          <h2 id={CHANNELS_HEADING_ID} tabIndex={-1} className="text-sm font-semibold">
            Channels
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Post alerts and the digest to a Discord or Slack channel, or to any service that accepts a signed webhook. A
            channel that keeps failing is marked as needing attention and stops receiving alerts until a test message
            gets through.
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="px-6 py-5 text-sm">
            <p className="font-medium">No channels yet</p>
            {canManage ? (
              <p className="mt-1 text-muted">
                <a href={`#${ADD_CHANNEL_HEADING_ID}`} className="text-accent underline underline-offset-2">
                  Add a channel
                </a>{" "}
                to post alerts where your team already is.
              </p>
            ) : (
              <DeniedReason>{actionDeniedReason("manage_alert_channels")}</DeniedReason>
            )}
          </div>
        ) : (
          <ul aria-label="Channels" className="divide-y divide-line">
            {rows.map((row) => (
              <ChannelListItem
                key={row.id}
                row={row}
                workspaceSlug={workspace.slug}
                ruleOptions={ruleOptions}
                canManage={canManage}
                afterDeleteFocusId={CHANNELS_HEADING_ID}
              />
            ))}
          </ul>
        )}

        {canManage ? (
          <div className="border-t border-line px-6 py-5">
            <h3 id={ADD_CHANNEL_HEADING_ID} className="mb-4 text-sm font-semibold">
              Add a channel
            </h3>
            <ChannelForm
              workspaceSlug={workspace.slug}
              ruleOptions={ruleOptions}
              initial={defaultChannelValues()}
              title="Add a channel"
            />
          </div>
        ) : rows.length === 0 ? null : (
          <div className="border-t border-line px-6 py-4">
            <DeniedReason>{actionDeniedReason("manage_alert_channels")}</DeniedReason>
          </div>
        )}
      </section>
    </>
  );
}
