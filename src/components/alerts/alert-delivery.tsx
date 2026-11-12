import { listDestinations } from "@/lib/data/notification-destinations";
import { getEmailFrequency } from "@/lib/data/notification-preferences";
import type { WorkspaceRef } from "@/lib/data/workspaces";
import { emailEnv } from "@/lib/env";
import { formatDateTime } from "@/lib/format";
import { logError } from "@/lib/log/logger";
import { describeFailure, repairStep } from "@/lib/notifications/channels";
import { ALERT_SETTINGS_IDS } from "@/lib/workspaces/paths";
import { actionDeniedReason, canPerform, type WorkspaceRole } from "@/lib/workspaces/permissions";

import { AlertEmailsForm } from "./alert-emails";
import { ChannelListItem, NewChannel, type ChannelRow } from "./alert-channels";
import { DeniedReason } from "./form-controls";
import { FragmentHeading } from "./fragment-heading";
import { defaultChannelValues, type Option } from "./labels";

/*
 * Where alerts go (#152, #153): the signed-in member's alert emails, and the workspace's channels.
 * Part of alert settings, below rules and budgets, because a channel picks the rules it receives.
 */

const EMAILS_HEADING_ID = ALERT_SETTINGS_IDS.emails;
const CHANNELS_HEADING_ID = ALERT_SETTINGS_IDS.channels;

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
            destination.status === "needs_attention" ? ` ${repairStep(destination.last_error_code, true)}.` : ""
          }`,
    lastDelivered: destination.last_delivered_at === null ? null : formatDateTime(destination.last_delivered_at),
  }));

  return (
    <>
      <section aria-labelledby={EMAILS_HEADING_ID} className="mt-8 rounded-xl border border-line bg-panel">
        <div className="border-b border-line px-6 py-4">
          <FragmentHeading id={EMAILS_HEADING_ID}>Alert emails</FragmentHeading>
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
          <FragmentHeading id={CHANNELS_HEADING_ID}>Channels</FragmentHeading>
          <p className="mt-1 max-w-3xl text-sm text-muted">
            Post alerts and the digest to a Discord or Slack channel, or to any service that accepts a signed webhook. A
            channel that keeps failing is marked as needing attention and stops receiving alerts until a test message
            gets through.
          </p>
        </div>

        {rows.length === 0 ? null : (
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
          // One place for the empty state and the New button, so adding the first channel keeps the
          // open form, and the signing secret it shows once, mounted while the list appears above.
          <div className={rows.length === 0 ? "px-6 py-5" : "border-t border-line px-6 py-5"}>
            {rows.length === 0 ? (
              <div className="mb-4 text-sm">
                <p className="font-medium">No channels yet</p>
                <p className="mt-1 text-muted">Add one to post alerts where your team already is.</p>
              </div>
            ) : null}
            <NewChannel workspaceSlug={workspace.slug} ruleOptions={ruleOptions} initial={defaultChannelValues()} />
          </div>
        ) : rows.length === 0 ? (
          <div className="px-6 py-5 text-sm">
            <p className="font-medium">No channels yet</p>
            <DeniedReason>{actionDeniedReason("manage_alert_channels")}</DeniedReason>
          </div>
        ) : (
          <div className="border-t border-line px-6 py-4">
            <DeniedReason>{actionDeniedReason("manage_alert_channels")}</DeniedReason>
          </div>
        )}
      </section>
    </>
  );
}
