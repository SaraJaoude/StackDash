"use server";

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
  findForeignTargets,
  insertAlertRule,
  insertSuggestedAllowanceRules,
  setAlertRulePaused,
  updateAlertRule,
} from "@/lib/data/alert-rules";
import { deleteBudget as deleteBudgetRow, insertBudget, updateBudget } from "@/lib/data/budgets";
import { acknowledgeTriggeredAlert } from "@/lib/data/triggered-alerts";
import { logError } from "@/lib/log/logger";
import { Constants } from "@/lib/supabase/database.types";
import { requireWorkspaceAction } from "@/lib/workspaces/access";
import { ForbiddenError } from "@/lib/workspaces/permissions";

/**
 * Alert rules and budgets. Every action validates its input, then authorizes with the role matrix
 * (`manage_budgets`: owners and admins), then re-reads any id from the browser against the
 * workspace before writing. Row level security repeats the role check on every write.
 */

export type AlertActionResult =
  | { ok: true }
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
