/**
 * Alert delivery planning (#152, #153). Pure: who gets which message, decided from the alerts, the
 * workspace's recipients and channels, and what was already delivered. No I/O and no clock, so the
 * rules here are unit tested at their boundaries. `dispatch.ts` loads the inputs and sends.
 *
 * Rules decided here, once:
 * - Recipients are the workspace's owners and admins (`notification_recipients`), never a list
 *   stored on a rule (#36). Each chooses immediate, daily, weekly, or off; immediate gets one email
 *   per dispatch, daily and weekly get the digest, off gets nothing.
 * - Once per cycle: `triggered_alerts` is unique per rule per billing cycle, and an alert goes to a
 *   target only when `notification_deliveries` has no row for that pair. A retried job therefore
 *   never sends an alert twice to anyone, and a rule sends at most one message per cycle.
 * - Coalescing: every alert waiting in one dispatch goes to a target in one message, so several
 *   alerts fired in the same tick reach a person as one email.
 * - A channel gets the alerts of every rule, or of the rules chosen for it. A channel that needs
 *   attention gets nothing until a test message succeeds again.
 */
import type { AlertSeverity } from "@/lib/alerts/evaluate";
import type { Database } from "@/lib/supabase/database.types";

type Enums = Database["public"]["Enums"];

export type EmailFrequency = Enums["email_frequency"];
export type DigestFrequency = Enums["digest_frequency"];
export type DestinationKind = Enums["destination_kind"];
export type DestinationStatus = Enums["destination_status"];

export const EMAIL_FREQUENCIES = ["immediate", "daily", "weekly", "off"] as const satisfies readonly EmailFrequency[];
export const DIGEST_FREQUENCIES = ["off", "daily", "weekly"] as const satisfies readonly DigestFrequency[];
export const DESTINATION_KINDS = ["discord", "slack", "webhook"] as const satisfies readonly DestinationKind[];

/** A triggered alert with the names a message shows. Ids are never shown to people. */
export type DeliveryAlert = Readonly<{
  id: string;
  ruleId: string;
  title: string;
  message: string;
  severity: AlertSeverity;
  thresholdLabel: string;
  isEstimated: boolean;
  providerName: string | null;
  projectName: string | null;
  resetsAt: string | null;
  triggeredAt: string;
}>;

export type Recipient = Readonly<{ userId: string; email: string; frequency: EmailFrequency }>;

export type DeliveryDestination = Readonly<{
  id: string;
  kind: DestinationKind;
  name: string;
  allRules: boolean;
  ruleIds: ReadonlySet<string>;
  digest: DigestFrequency;
  status: DestinationStatus;
  consecutiveFailures: number;
}>;

export type DeliveryTarget =
  | Readonly<{ kind: "email"; key: string; recipient: Recipient }>
  | Readonly<{ kind: "destination"; key: string; destination: DeliveryDestination }>;

export type PlannedAlertMessage = Readonly<{ target: DeliveryTarget; alerts: readonly DeliveryAlert[] }>;

export function alertSubjectKey(alertId: string): string {
  return `alert:${alertId}`;
}

export function emailTargetKey(userId: string): string {
  return `email:${userId}`;
}

export function destinationTargetKey(destinationId: string): string {
  return `destination:${destinationId}`;
}

/** Key of one (subject, target) pair in the set of deliveries already made. */
export function deliveryKey(subjectKey: string, targetKey: string): string {
  return `${subjectKey} ${targetKey}`;
}

export function emailTarget(recipient: Recipient): DeliveryTarget {
  return { kind: "email", key: emailTargetKey(recipient.userId), recipient };
}

export function destinationTarget(destination: DeliveryDestination): DeliveryTarget {
  return { kind: "destination", key: destinationTargetKey(destination.id), destination };
}

const SEVERITY_ORDER: Record<AlertSeverity, number> = { critical: 0, warning: 1 };

/** Critical first, then oldest first, so the worst news leads every message. */
export function orderAlerts(alerts: readonly DeliveryAlert[]): DeliveryAlert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      Date.parse(a.triggeredAt) - Date.parse(b.triggeredAt) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * One message per target, holding every waiting alert that target has not had yet. Targets with
 * nothing to send are left out.
 */
export function planAlertMessages(input: {
  alerts: readonly DeliveryAlert[];
  recipients: readonly Recipient[];
  destinations: readonly DeliveryDestination[];
  delivered: ReadonlySet<string>;
}): PlannedAlertMessage[] {
  const alerts = orderAlerts(input.alerts);
  const targets: Array<{ target: DeliveryTarget; wants: (alert: DeliveryAlert) => boolean }> = [
    ...input.recipients
      .filter((recipient) => recipient.frequency === "immediate")
      .map((recipient) => ({ target: emailTarget(recipient), wants: () => true })),
    ...input.destinations
      .filter((destination) => destination.status === "active")
      .map((destination) => ({
        target: destinationTarget(destination),
        wants: (alert: DeliveryAlert) => destination.allRules || destination.ruleIds.has(alert.ruleId),
      })),
  ];

  const messages: PlannedAlertMessage[] = [];
  for (const { target, wants } of targets) {
    const pending = alerts.filter(
      (alert) => wants(alert) && !input.delivered.has(deliveryKey(alertSubjectKey(alert.id), target.key)),
    );
    if (pending.length > 0) messages.push({ target, alerts: pending });
  }
  return messages;
}

// ── Digest ──────────────────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** What one digest covers: [start, end) in UTC, ending at the end of the summarized day. */
export type DigestPeriod = Readonly<{
  frequency: "daily" | "weekly";
  /** The summarized UTC day, `YYYY-MM-DD`: the last day the digest covers. */
  date: string;
  start: string;
  end: string;
}>;

/** The digest job's dedupe key, `digest:<workspace id>:<summarized date>` (enqueue_digests). */
export function digestJobKey(workspaceId: string, date: string): string {
  return `digest:${workspaceId}:${date}`;
}

/** The summarized date a digest job key names, or null for a key in another shape. */
export function digestJobDate(dedupeKey: string | null): string | null {
  return dedupeKey?.match(/^digest:[^:]+:(\d{4}-\d{2}-\d{2})$/)?.[1] ?? null;
}

/**
 * The digests due for a summarized day: the daily one always, and the weekly one when that day is
 * a Sunday, so the weekly digest arrives on Monday and covers Monday to Sunday (UTC).
 */
export function digestPeriods(date: string): DigestPeriod[] {
  const dayStart = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dayStart) || new Date(dayStart).toISOString().slice(0, 10) !== date) return [];
  const end = new Date(dayStart + DAY_MS).toISOString();
  const periods: DigestPeriod[] = [{ frequency: "daily", date, start: new Date(dayStart).toISOString(), end }];
  if (new Date(dayStart).getUTCDay() === 0) {
    periods.push({ frequency: "weekly", date, start: new Date(dayStart - 6 * DAY_MS).toISOString(), end });
  }
  return periods;
}

export function digestSubjectKey(period: DigestPeriod): string {
  return `digest:${period.frequency}:${period.date}`;
}

/** Members and channels that chose this digest and have not had it yet. */
export function planDigestTargets(input: {
  period: DigestPeriod;
  recipients: readonly Recipient[];
  destinations: readonly DeliveryDestination[];
  delivered: ReadonlySet<string>;
}): DeliveryTarget[] {
  const { period } = input;
  const subject = digestSubjectKey(period);
  const targets = [
    ...input.recipients.filter((recipient) => recipient.frequency === period.frequency).map(emailTarget),
    ...input.destinations
      .filter((destination) => destination.status === "active" && destination.digest === period.frequency)
      .map(destinationTarget),
  ];
  return targets.filter((target) => !input.delivered.has(deliveryKey(subject, target.key)));
}

// ── Channel health ──────────────────────────────────────────────────────────────

/** Consecutive failed deliveries after which a channel needs attention. */
export const DESTINATION_FAILURE_LIMIT = 3;

export type DestinationHealth = Readonly<{
  status: DestinationStatus;
  consecutiveFailures: number;
  /** True exactly when this failure moved the channel from active to needs attention. */
  becameNeedsAttention: boolean;
}>;

/**
 * The channel's state after a delivery. Success resets it. A permanent failure (the webhook was
 * deleted, the channel archived) needs attention at once; a transient one (rate limited, the
 * service down) counts, and the third in a row needs attention.
 */
export function nextDestinationHealth(
  current: Pick<DeliveryDestination, "status" | "consecutiveFailures">,
  outcome: "delivered" | "transient_failure" | "permanent_failure",
): DestinationHealth {
  if (outcome === "delivered") return { status: "active", consecutiveFailures: 0, becameNeedsAttention: false };
  const consecutiveFailures = current.consecutiveFailures + 1;
  const needsAttention = outcome === "permanent_failure" || consecutiveFailures >= DESTINATION_FAILURE_LIMIT;
  return {
    status: needsAttention ? "needs_attention" : current.status,
    consecutiveFailures,
    becameNeedsAttention: needsAttention && current.status === "active",
  };
}
