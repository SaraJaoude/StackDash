"use server";

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import {
  alertRuleInputSchema,
  budgetInputSchema,
  BUDGET_FORM_FIELDS,
  fieldErrorsFrom,
  pickFormFields,
  RULE_FORM_FIELDS,
} from "@/lib/alerts/rule-schema";
import {
  deleteAlertRule as deleteAlertRuleRow,
  existingRuleIds,
  findForeignTargets,
  insertAlertRule,
  insertSuggestedAllowanceRules,
  setAlertRulePaused,
  updateAlertRule,
} from "@/lib/data/alert-rules";
import {
  listAnomalyMetrics,
  muteAnomalyMetric,
  setAnomalyDetectionEnabled,
  unmuteAnomalyMetric,
} from "@/lib/data/anomalies";
import { deleteBudget as deleteBudgetRow, insertBudget, updateBudget } from "@/lib/data/budgets";
import {
  createDestination,
  deleteDestination,
  getDeliveryDestination,
  loadDestinationSecret,
  updateDestination,
  updateDestinationHealth,
} from "@/lib/data/notification-destinations";
import { saveEmailFrequency } from "@/lib/data/notification-preferences";
import { acknowledgeTriggeredAlert } from "@/lib/data/triggered-alerts";
import { logError } from "@/lib/log/logger";
import {
  channelRequest,
  describeFailure,
  newSigningSecret,
  parseChannelUrl,
  pinnedFetch,
  postToChannel,
  urlPolicyFromEnv,
} from "@/lib/notifications/channels";
import { messageOrigin, workspaceLinks } from "@/lib/notifications/links";
import { DESTINATION_KINDS, DIGEST_FREQUENCIES, EMAIL_FREQUENCIES } from "@/lib/notifications/model";
import { testNotice } from "@/lib/notifications/notice";
import { Constants } from "@/lib/supabase/database.types";
import { requireWorkspaceAction } from "@/lib/workspaces/access";
import { actionDeniedReason, ForbiddenError } from "@/lib/workspaces/permissions";

/**
 * Alert rules, budgets, and anomaly detection settings. Every action validates its input, then
 * authorizes with the role matrix (`manage_budgets`: owners and admins), then re-reads any id or
 * metric from the browser against the workspace before writing. Row level security repeats the
 * role check on every write.
 */

export type AlertActionResult =
  // signingSecret: a new generic webhook's secret, shown once and never stored in the clear.
  | { ok: true; signingSecret?: string }
  | { ok: false; fieldErrors?: Record<string, string>; message: string; referenceId?: string };

const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";
const RULE_GONE = "This alert rule no longer exists. Reload the page to see the current rules.";
const BUDGET_GONE = "This budget no longer exists. Reload the page to see the current budgets.";
const TARGET_GONE: Record<"projectId" | "connectionId" | "budgetId", string> = {
  projectId: "That project no longer exists. Choose another.",
  connectionId: "That connection no longer exists. Choose another.",
  budgetId: "That budget no longer exists. Choose another.",
};

const workspaceField = z.string().min(1);

const saveRuleEnvelope = z.object({ workspace: workspaceField, ruleId: z.guid().optional() }).strict();
const ruleRefSchema = z.object({ workspace: workspaceField, ruleId: z.guid() }).strict();
const pauseSchema = z
  .object({ workspace: workspaceField, ruleId: z.guid(), paused: z.enum(["true", "false"]) })
  .strict();
const saveBudgetEnvelope = z.object({ workspace: workspaceField, budgetId: z.guid().optional() }).strict();
const budgetRefSchema = z.object({ workspace: workspaceField, budgetId: z.guid() }).strict();
const suggestionSchema = z
  .object({ workspace: workspaceField, provider: z.enum(Constants.public.Enums.provider_id) })
  .strict();

function fieldFailure(subject: string, fieldErrors: Record<string, string>): AlertActionResult {
  const count = Object.keys(fieldErrors).length;
  return {
    ok: false,
    fieldErrors,
    message: `${subject} was not saved. Fix the ${count === 1 ? "field" : `${count} fields`} marked below.`,
  };
}

function validationFailure(subject: string, error: z.ZodError, fields: readonly string[]): AlertActionResult {
  const { fieldErrors, formError } = fieldErrorsFrom(error, fields);
  if (formError || Object.keys(fieldErrors).length === 0) return { ok: false, message: OUT_OF_DATE };
  return fieldFailure(subject, fieldErrors);
}

/**
 * Runs an authorized write. Expected outcomes come back as results; a role that changed since the
 * page loaded returns the matrix reason; anything else is logged and returned as a reference id.
 */
async function guarded(
  event: string,
  failureMessage: string,
  run: () => Promise<AlertActionResult>,
): Promise<AlertActionResult> {
  let result: AlertActionResult;
  try {
    result = await run();
  } catch (error) {
    // notFound() and redirect() signal through throws; let Next.js handle them.
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    const referenceId = logError(event, error);
    return { ok: false, message: failureMessage, referenceId };
  }
  if (result.ok) refresh();
  return result;
}

/** Creates a rule, or replaces one when `ruleId` is posted. */
export async function saveAlertRule(
  _previous: AlertActionResult | null,
  formData: FormData,
): Promise<AlertActionResult> {
  const envelope = saveRuleEnvelope.safeParse(pickFormFields(formData, ["workspace", "ruleId"]));
  if (!envelope.success) return { ok: false, message: OUT_OF_DATE };
  const parsed = alertRuleInputSchema.safeParse(pickFormFields(formData, RULE_FORM_FIELDS));
  if (!parsed.success) return validationFailure("The alert rule", parsed.error, RULE_FORM_FIELDS);
  const values = parsed.data;
  const { ruleId } = envelope.data;

  return guarded("alerts.rule_save_failed", "The alert rule could not be saved. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(envelope.data.workspace, "manage_budgets");
    const foreign = await findForeignTargets(workspace.id, {
      projectId: values.project_id,
      connectionId: values.connection_id,
      budgetId: values.budget_id,
    });
    if (foreign.length > 0) {
      return fieldFailure("The alert rule", Object.fromEntries(foreign.map((field) => [field, TARGET_GONE[field]])));
    }
    if (ruleId === undefined) {
      await insertAlertRule(workspace.id, values);
    } else if (!(await updateAlertRule(workspace.id, ruleId, values))) {
      return { ok: false, message: RULE_GONE };
    }
    return { ok: true };
  });
}

/** Pauses (`paused=true`) or resumes (`paused=false`) a rule. */
export async function setAlertRulePausedAction(
  _previous: AlertActionResult | null,
  formData: FormData,
): Promise<AlertActionResult> {
  const parsed = pauseSchema.safeParse(pickFormFields(formData, ["workspace", "ruleId", "paused"]));
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };
  const { workspace: slug, ruleId, paused } = parsed.data;

  return guarded("alerts.rule_pause_failed", "The alert rule could not be changed. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(slug, "manage_budgets");
    const found = await setAlertRulePaused(workspace.id, ruleId, paused === "true");
    return found ? { ok: true } : { ok: false, message: RULE_GONE };
  });
}

export async function deleteAlertRule(
  _previous: AlertActionResult | null,
  formData: FormData,
): Promise<AlertActionResult> {
  const parsed = ruleRefSchema.safeParse(pickFormFields(formData, ["workspace", "ruleId"]));
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };
  const { workspace: slug, ruleId } = parsed.data;

  return guarded("alerts.rule_delete_failed", "The alert rule could not be deleted. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(slug, "manage_budgets");
    const found = await deleteAlertRuleRow(workspace.id, ruleId);
    return found ? { ok: true } : { ok: false, message: RULE_GONE };
  });
}

/** Adds the suggested 75, 90, and 100 percent allowance rules for one provider, after a click. */
export async function addSuggestedAlerts(
  _previous: AlertActionResult | null,
  formData: FormData,
): Promise<AlertActionResult> {
  const parsed = suggestionSchema.safeParse(pickFormFields(formData, ["workspace", "provider"]));
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };
  const { workspace: slug, provider } = parsed.data;

  return guarded("alerts.suggestions_add_failed", "The suggested alerts could not be added. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(slug, "manage_budgets");
    await insertSuggestedAllowanceRules(workspace.id, provider);
    return { ok: true };
  });
}

/** Creates a budget, or replaces one when `budgetId` is posted. */
export async function saveBudget(
  _previous: AlertActionResult | null,
  formData: FormData,
): Promise<AlertActionResult> {
  const envelope = saveBudgetEnvelope.safeParse(pickFormFields(formData, ["workspace", "budgetId"]));
  if (!envelope.success) return { ok: false, message: OUT_OF_DATE };
  const parsed = budgetInputSchema.safeParse(pickFormFields(formData, BUDGET_FORM_FIELDS));
  if (!parsed.success) return validationFailure("The budget", parsed.error, BUDGET_FORM_FIELDS);
  const values = parsed.data;
  const { budgetId } = envelope.data;

  return guarded("alerts.budget_save_failed", "The budget could not be saved. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(envelope.data.workspace, "manage_budgets");
    const foreign = await findForeignTargets(workspace.id, {
      projectId: values.project_id,
      connectionId: values.connection_id,
      budgetId: null,
    });
    if (foreign.length > 0) {
      return fieldFailure("The budget", Object.fromEntries(foreign.map((field) => [field, TARGET_GONE[field]])));
    }
    if (budgetId === undefined) {
      await insertBudget(workspace.id, values);
    } else if (!(await updateBudget(workspace.id, budgetId, values))) {
      return { ok: false, message: BUDGET_GONE };
    }
    return { ok: true };
  });
}

/** Deletes a budget and, by cascade, the budget percent rules that use it. */
export async function deleteBudget(
  _previous: AlertActionResult | null,
  formData: FormData,
): Promise<AlertActionResult> {
  const parsed = budgetRefSchema.safeParse(pickFormFields(formData, ["workspace", "budgetId"]));
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };
  const { workspace: slug, budgetId } = parsed.data;

  return guarded("alerts.budget_delete_failed", "The budget could not be deleted. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(slug, "manage_budgets");
    const found = await deleteBudgetRow(workspace.id, budgetId);
    return found ? { ok: true } : { ok: false, message: BUDGET_GONE };
  });
}

const acknowledgeSchema = z.object({ workspace: workspaceField, alertId: z.guid() }).strict();
const ALERT_GONE = "This alert no longer exists. Reload the page to see the current alerts.";

/**
 * Acknowledges a triggered alert in the caller's name (`acknowledge_alert`: owners and admins).
 * The alert stays in the history; acknowledging twice keeps the first acknowledgement.
 */
export async function acknowledgeAlert(
  _previous: AlertActionResult | null,
  formData: FormData,
): Promise<AlertActionResult> {
  const parsed = acknowledgeSchema.safeParse(pickFormFields(formData, ["workspace", "alertId"]));
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };
  const { workspace: slug, alertId } = parsed.data;

  return guarded("alerts.acknowledge_failed", "The alert could not be acknowledged. Try again in a moment.", async () => {
    const { workspace, user } = await requireWorkspaceAction(slug, "acknowledge_alert");
    const found = await acknowledgeTriggeredAlert(workspace.id, alertId, user.id);
    return found ? { ok: true } : { ok: false, message: ALERT_GONE };
  });
}

// ── Anomaly detection (#169) ────────────────────────────────────────────────────────────────────

const anomalyToggleSchema = z.object({ workspace: workspaceField, enabled: z.enum(["true", "false"]) }).strict();
// The metric picker posts `<provider> <metric key>`; both halves are checked against what the
// workspace reports before anything is written.
const anomalyMuteSchema = z
  .object({
    workspace: workspaceField,
    metric: z
      .string()
      .max(140)
      .regex(/^[a-z]+ [a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/),
  })
  .strict();
const anomalyUnmuteSchema = z.object({ workspace: workspaceField, muteId: z.guid() }).strict();
const METRIC_GONE = "That metric is no longer reported. Reload the page and choose another.";
const MUTE_GONE = "This metric is no longer muted. Reload the page to see the current list.";

/** Turns anomaly detection on (`enabled=true`) or off for the whole workspace. */
export async function setAnomalyDetection(
  _previous: AlertActionResult | null,
  formData: FormData,
): Promise<AlertActionResult> {
  const parsed = anomalyToggleSchema.safeParse(pickFormFields(formData, ["workspace", "enabled"]));
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };
  const { workspace: slug, enabled } = parsed.data;

  return guarded("alerts.anomaly_toggle_failed", "Anomaly detection could not be changed. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(slug, "manage_budgets");
    if (!(await setAnomalyDetectionEnabled(workspace.id, enabled === "true"))) {
      throw new ForbiddenError("admin", actionDeniedReason("manage_budgets"));
    }
    return { ok: true };
  });
}

/** Stops new anomaly events for one metric the workspace reports. */
export async function muteAnomaly(
  _previous: AlertActionResult | null,
  formData: FormData,
): Promise<AlertActionResult> {
  const parsed = anomalyMuteSchema.safeParse(pickFormFields(formData, ["workspace", "metric"]));
  if (!parsed.success) {
    const metricMissing = formData.get("metric") === "";
    return metricMissing
      ? { ok: false, fieldErrors: { metric: "Choose a metric to mute." }, message: "Nothing was muted. Choose a metric to mute." }
      : { ok: false, message: OUT_OF_DATE };
  }
  const [provider = "", metricKey = ""] = parsed.data.metric.split(" ");

  return guarded("alerts.anomaly_mute_failed", "The metric could not be muted. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(parsed.data.workspace, "manage_budgets");
    const metric = (await listAnomalyMetrics(workspace.id)).find(
      (candidate) => candidate.provider === provider && candidate.metricKey === metricKey,
    );
    if (metric === undefined) return { ok: false, fieldErrors: { metric: METRIC_GONE }, message: METRIC_GONE };
    await muteAnomalyMetric(workspace.id, metric.provider, metric.metricKey);
    return { ok: true };
  });
}

export async function unmuteAnomaly(
  _previous: AlertActionResult | null,
  formData: FormData,
): Promise<AlertActionResult> {
  const parsed = anomalyUnmuteSchema.safeParse(pickFormFields(formData, ["workspace", "muteId"]));
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };
  const { workspace: slug, muteId } = parsed.data;

  return guarded("alerts.anomaly_unmute_failed", "The metric could not be unmuted. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(slug, "manage_budgets");
    const found = await unmuteAnomalyMetric(workspace.id, muteId);
    return found ? { ok: true } : { ok: false, message: MUTE_GONE };
  });
}

// ── Alert delivery (#152, #153) ─────────────────────────────────────────────────────────────────

const emailPreferenceSchema = z.object({ workspace: workspaceField, frequency: z.enum(EMAIL_FREQUENCIES) }).strict();

/**
 * Saves the signed-in member's own alert email setting. Only owners and admins receive alert
 * email (`receive_alert_email`); row level security keeps the row the caller's own.
 */
export async function saveAlertEmails(_previous: AlertActionResult | null, formData: FormData): Promise<AlertActionResult> {
  const parsed = emailPreferenceSchema.safeParse(pickFormFields(formData, ["workspace", "frequency"]));
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };
  const { workspace: slug, frequency } = parsed.data;

  return guarded("alerts.email_preference_failed", "Your alert email setting could not be saved. Try again in a moment.", async () => {
    const { workspace, user } = await requireWorkspaceAction(slug, "receive_alert_email");
    if (!(await saveEmailFrequency(workspace.id, user.id, frequency))) {
      throw new ForbiddenError("admin", actionDeniedReason("receive_alert_email"));
    }
    return { ok: true };
  });
}

const CHANNEL_NAME_MAX = 80;
const CHANNEL_FORM_FIELDS = ["name", "url", "kind", "rules", "digest"] as const;

const channelSettingsSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter a name, such as the channel it posts to.")
    .refine((name) => [...name].length <= CHANNEL_NAME_MAX, { message: `Use ${CHANNEL_NAME_MAX} characters or fewer.` }),
  rules: z.enum(["all", "chosen"], { error: "Choose which alerts to send." }),
  digest: z.enum(DIGEST_FREQUENCIES, { error: "Choose whether to send the digest." }),
});

const addChannelSchema = channelSettingsSchema.extend({
  workspace: workspaceField,
  kind: z.enum(DESTINATION_KINDS, { error: "Choose Discord, Slack, or webhook." }),
  url: z.string(),
});

const updateChannelSchema = channelSettingsSchema.extend({ workspace: workspaceField, destinationId: z.guid() });
const channelRefSchema = z.object({ workspace: workspaceField, destinationId: z.guid() }).strict();
const CHANNEL_GONE = "This channel no longer exists. Reload the page to see the current channels.";

/** Rule ids posted as repeated `ruleIds` fields; only well-formed ids, at most the rule bound. */
function postedRuleIds(formData: FormData): string[] {
  return formData
    .getAll("ruleIds")
    .filter((value): value is string => typeof value === "string" && z.guid().safeParse(value).success)
    .slice(0, 500);
}

function channelFieldErrors(error: z.ZodError): AlertActionResult {
  const { fieldErrors, formError } = fieldErrorsFrom(error, CHANNEL_FORM_FIELDS);
  if (formError || Object.keys(fieldErrors).length === 0) return { ok: false, message: OUT_OF_DATE };
  return fieldFailure("The channel", fieldErrors);
}

/**
 * Adds a Discord, Slack, or generic webhook channel. The URL is checked for its kind, then sealed
 * with the credential key; a generic webhook also gets a signing secret, returned once.
 */
export async function addAlertChannel(_previous: AlertActionResult | null, formData: FormData): Promise<AlertActionResult> {
  const parsed = addChannelSchema.safeParse(pickFormFields(formData, ["workspace", ...CHANNEL_FORM_FIELDS]));
  if (!parsed.success) return channelFieldErrors(parsed.error);
  const values = parsed.data;
  const url = parseChannelUrl(values.kind, values.url, urlPolicyFromEnv());
  if (!url.ok) return fieldFailure("The channel", { url: url.message });
  const ruleIds = postedRuleIds(formData);
  if (values.rules === "chosen" && ruleIds.length === 0) {
    return fieldFailure("The channel", { rules: "Choose at least one alert rule, or send every alert." });
  }

  return guarded("alerts.channel_add_failed", "The channel could not be added. Try again in a moment.", async () => {
    const { workspace, user } = await requireWorkspaceAction(values.workspace, "manage_alert_channels");
    const known = values.rules === "chosen" ? await existingRuleIds(workspace.id, ruleIds) : [];
    if (values.rules === "chosen" && known.length === 0) {
      return fieldFailure("The channel", { rules: "Those alert rules no longer exist. Choose others." });
    }
    const signingSecret = values.kind === "webhook" ? newSigningSecret() : undefined;
    await createDestination({
      workspaceId: workspace.id,
      userId: user.id,
      kind: values.kind,
      name: values.name,
      url: url.url,
      host: url.host,
      allRules: values.rules === "all",
      ruleIds: known,
      digest: values.digest,
      ...(signingSecret === undefined ? {} : { signingSecret }),
    });
    return signingSecret === undefined ? { ok: true } : { ok: true, signingSecret };
  });
}

/** Renames a channel and sets which alerts and digest it receives. The URL stays as it was. */
export async function updateAlertChannel(_previous: AlertActionResult | null, formData: FormData): Promise<AlertActionResult> {
  const parsed = updateChannelSchema.safeParse(pickFormFields(formData, ["workspace", "destinationId", "name", "rules", "digest"]));
  if (!parsed.success) return channelFieldErrors(parsed.error);
  const values = parsed.data;
  const ruleIds = postedRuleIds(formData);
  if (values.rules === "chosen" && ruleIds.length === 0) {
    return fieldFailure("The channel", { rules: "Choose at least one alert rule, or send every alert." });
  }

  return guarded("alerts.channel_update_failed", "The channel could not be saved. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(values.workspace, "manage_alert_channels");
    const known = values.rules === "chosen" ? await existingRuleIds(workspace.id, ruleIds) : [];
    if (values.rules === "chosen" && known.length === 0) {
      return fieldFailure("The channel", { rules: "Those alert rules no longer exist. Choose others." });
    }
    const found = await updateDestination(workspace.id, values.destinationId, {
      name: values.name,
      allRules: values.rules === "all",
      ruleIds: known,
      digest: values.digest,
    });
    return found ? { ok: true } : { ok: false, message: CHANNEL_GONE };
  });
}

/** Removes a channel. Its sealed URL, rule links, and delivery records are deleted with it. */
export async function deleteAlertChannel(_previous: AlertActionResult | null, formData: FormData): Promise<AlertActionResult> {
  const parsed = channelRefSchema.safeParse(pickFormFields(formData, ["workspace", "destinationId"]));
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };
  const { workspace: slug, destinationId } = parsed.data;

  return guarded("alerts.channel_delete_failed", "The channel could not be removed. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(slug, "manage_alert_channels");
    const found = await deleteDestination(workspace.id, destinationId);
    return found ? { ok: true } : { ok: false, message: CHANNEL_GONE };
  });
}

/**
 * Posts a test message to a channel and reports whether it arrived. One attempt, so the person who
 * pressed the button hears the first answer rather than waiting out the retries. A success turns a
 * channel that needed attention back on; a failure records the error on the channel without
 * sending anything else.
 */
export async function sendAlertChannelTest(_previous: AlertActionResult | null, formData: FormData): Promise<AlertActionResult> {
  const parsed = channelRefSchema.safeParse(pickFormFields(formData, ["workspace", "destinationId"]));
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };
  const { workspace: slug, destinationId } = parsed.data;

  return guarded("alerts.channel_test_failed", "The test message could not be sent. Try again in a moment.", async () => {
    const { workspace } = await requireWorkspaceAction(slug, "manage_alert_channels");
    const [destination, secret] = await Promise.all([
      getDeliveryDestination(workspace.id, destinationId),
      loadDestinationSecret(workspace.id, destinationId),
    ]);
    if (destination === null) return { ok: false, message: CHANNEL_GONE };
    if (secret === null) {
      return { ok: false, message: `The URL of ${destination.name} can no longer be read. Remove the channel and add it again with its URL.` };
    }
    const notice = testNotice(workspace.name, destination.name, workspaceLinks(messageOrigin(), workspace.slug));
    const policy = urlPolicyFromEnv();
    const outcome = await postToChannel(
      channelRequest(destination.kind, secret, notice, { now: () => new Date(), newId: randomUUID }),
      { fetch: pinnedFetch(policy), sleep: (ms) => sleep(ms), random: Math.random, policy },
      { maxAttempts: 1 },
    );
    if (outcome.ok) {
      await updateDestinationHealth(workspace.id, destinationId, {
        status: "active",
        consecutive_failures: 0,
        last_error_code: null,
        last_error_reference: null,
        last_delivered_at: new Date().toISOString(),
      });
      return { ok: true };
    }
    const referenceId = logError("alerts.channel_test_rejected", new Error(`Channel answered ${outcome.code}`), {
      workspaceId: workspace.id,
      destinationId,
      kind: destination.kind,
      code: outcome.code,
    });
    await updateDestinationHealth(workspace.id, destinationId, {
      status: destination.status,
      consecutive_failures: destination.consecutiveFailures,
      last_error_code: outcome.code,
      last_error_reference: referenceId,
    });
    return {
      ok: false,
      message: `The test message did not reach ${destination.name}. ${describeFailure(outcome.code)}. Check the webhook URL, or remove the channel and add it again.`,
      referenceId,
    };
  });
}
