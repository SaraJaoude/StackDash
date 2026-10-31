import { z } from "zod";

import { currencyMinorDigits, decimalToMinorUnits, InvalidDecimalError } from "@/lib/money";
import { Constants, type Database } from "@/lib/supabase/database.types";

/**
 * Input validation for alert rules and budgets, shared by the Server Actions on the alerts page.
 *
 * Forms post strings. These schemas take the posted strings (empty fields already dropped, see
 * `pickFormFields`) and produce exactly the column values to write. Money arrives as a decimal the
 * person typed and is converted to minor units here, on the server, with `decimalToMinorUnits`;
 * minor units from a client are never accepted. Every object is `.strict()`, so a field that does
 * not belong to the chosen kind of rule is rejected rather than silently stored.
 */

type Tables = Database["public"]["Tables"];
type AlertRuleInsert = Tables["alert_rules"]["Insert"];
type BudgetInsert = Tables["budgets"]["Insert"];

export type AlertRuleKind = Database["public"]["Enums"]["alert_rule_kind"];
export type AlertScope = Database["public"]["Enums"]["alert_scope"];
export type ProviderId = Database["public"]["Enums"]["provider_id"];

/** Column values for an alert rule insert or a full update. Every column is set, unused ones null. */
export type AlertRuleValues = Required<
  Pick<
    AlertRuleInsert,
    | "kind"
    | "scope"
    | "provider"
    | "project_id"
    | "connection_id"
    | "metric_key"
    | "budget_id"
    | "threshold_percent"
    | "threshold_amount_minor"
    | "currency"
  >
>;

export type BudgetValues = Required<
  Pick<BudgetInsert, "name" | "scope" | "provider" | "project_id" | "connection_id" | "amount_minor" | "currency">
>;

export const PERCENT_PRESETS = ["50", "75", "90", "100"] as const;
export const AMOUNT_PRESETS = ["5", "10", "25", "50"] as const;
export const CUSTOM_CHOICE = "custom";
export const PERCENT_MIN = 1;
export const PERCENT_MAX = 1000;
export const BUDGET_NAME_MAX = 80;
/** Thresholds offered by the suggested alerts panel. Never created without a click. */
export const SUGGESTED_PERCENTS = [75, 90, 100] as const;
/** Always offered in currency choosers, on top of the currencies already in the workspace. */
export const DEFAULT_CURRENCIES = ["USD", "EUR", "GBP"] as const;

// Mirrors the alert_rules_metric_key_format and usage_snapshots checks.
const METRIC_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;
const WHOLE_NUMBER_PATTERN = /^\d+$/;

/** Form field names, so the client, the action, and the error mapping use one list. */
export const RULE_FORM_FIELDS = [
  "kind",
  "scope",
  "provider",
  "projectId",
  "connectionId",
  "metricKey",
  "budgetId",
  "thresholdPreset",
  "thresholdCustom",
  "amountPreset",
  "amountCustom",
  "currency",
] as const;

export const BUDGET_FORM_FIELDS = [
  "name",
  "amount",
  "currency",
  "scope",
  "provider",
  "projectId",
  "connectionId",
] as const;

export type RuleFormField = (typeof RULE_FORM_FIELDS)[number];
export type BudgetFormField = (typeof BUDGET_FORM_FIELDS)[number];

type FormDataLike = { get(name: string): FormDataEntryValue | null };

/**
 * Reads only the named fields from a form, trimmed, dropping empty ones. An empty select or text
 * box means "not given", so required-field messages come from the schema, not from type errors.
 */
export function pickFormFields<const K extends string>(
  formData: FormDataLike,
  fields: readonly K[],
): Partial<Record<K, string>> {
  const picked: Partial<Record<K, string>> = {};
  for (const field of fields) {
    const value = formData.get(field);
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed !== "") picked[field] = trimmed;
  }
  return picked;
}

const scopeSchema = z.enum(Constants.public.Enums.alert_scope, {
  error: "Choose what this applies to.",
});

const scopeFields = {
  scope: scopeSchema,
  provider: z.enum(Constants.public.Enums.provider_id, { error: "Choose a provider from the list." }).optional(),
  projectId: z.guid({ error: "Choose a project from the list." }).optional(),
  connectionId: z.guid({ error: "Choose a connection from the list." }).optional(),
};

const currencySchema = z
  .string({ error: "Choose a currency." })
  .regex(CURRENCY_PATTERN, "Choose a three-letter currency code in capitals, such as USD.");

const percentFields = {
  thresholdPreset: z.enum([...PERCENT_PRESETS, CUSTOM_CHOICE], { error: "Choose a threshold." }),
  thresholdCustom: z.string().optional(),
};

const allowanceRuleSchema = z
  .object({
    kind: z.literal("allowance_percent"),
    ...scopeFields,
    ...percentFields,
    metricKey: z.string().regex(METRIC_KEY_PATTERN, "Choose an allowance from the list.").optional(),
  })
  .strict();

const budgetRuleSchema = z
  .object({
    kind: z.literal("budget_percent"),
    ...scopeFields,
    ...percentFields,
    budgetId: z.guid({
      error: (issue) =>
        issue.input === undefined
          ? "Choose a budget. Add one under Budgets first if the list is empty."
          : "Choose a budget from the list.",
    }),
  })
  .strict();

const spendRuleSchema = z
  .object({
    kind: z.literal("spend_amount"),
    ...scopeFields,
    amountPreset: z.enum([...AMOUNT_PRESETS, CUSTOM_CHOICE], { error: "Choose an amount." }),
    amountCustom: z.string().optional(),
    currency: currencySchema,
  })
  .strict();

type ScopeInput = {
  scope: AlertScope;
  provider?: ProviderId | undefined;
  projectId?: string | undefined;
  connectionId?: string | undefined;
};

type IssueSink = { addIssue(issue: { code: "custom"; message: string; path: string[] }): void };

const TARGET_FIELD = {
  provider: "provider",
  project: "projectId",
  connection: "connectionId",
} as const satisfies Record<Exclude<AlertScope, "workspace">, keyof ScopeInput>;

const TARGET_REQUIRED_MESSAGE = {
  provider: "Choose a provider.",
  projectId: "Choose a project.",
  connectionId: "Choose a connection.",
} as const;

/** Exactly the target the scope names, and no other: mirrors the `*_scope_target` checks. */
function checkScopeTarget(value: ScopeInput, ctx: IssueSink): void {
  const expected = value.scope === "workspace" ? null : TARGET_FIELD[value.scope];
  for (const field of ["provider", "projectId", "connectionId"] as const) {
    const present = value[field] !== undefined;
    if (field === expected && !present) {
      ctx.addIssue({ code: "custom", message: TARGET_REQUIRED_MESSAGE[field], path: [field] });
    } else if (field !== expected && present) {
      ctx.addIssue({
        code: "custom",
        message: "This does not match what the rule applies to. Choose again.",
        path: [field],
      });
    }
  }
}

function customPercentError(raw: string | undefined): string | null {
  if (raw === undefined) return `Enter a percentage from ${PERCENT_MIN} to ${PERCENT_MAX}.`;
  if (!WHOLE_NUMBER_PATTERN.test(raw)) {
    return `Enter a whole number from ${PERCENT_MIN} to ${PERCENT_MAX}, without the % sign.`;
  }
  const percent = Number(raw);
  if (percent < PERCENT_MIN || percent > PERCENT_MAX) {
    return `Enter a whole number from ${PERCENT_MIN} to ${PERCENT_MAX}.`;
  }
  return null;
}

/** Converts a typed amount to minor units, or explains why it cannot be stored. */
export function amountToMinorUnits(
  raw: string | undefined,
  currency: string,
): { ok: true; minor: number } | { ok: false; message: string } {
  if (raw === undefined) return { ok: false, message: "Enter an amount." };
  let minor: number;
  try {
    minor = decimalToMinorUnits(raw, currency);
  } catch (error) {
    if (!(error instanceof InvalidDecimalError)) throw error;
    if (/too large/i.test(error.message)) return { ok: false, message: "Enter a smaller amount." };
    return { ok: false, message: "Enter the amount as a number, such as 12.50, without symbols or commas." };
  }
  if (minor <= 0) {
    return {
      ok: false,
      message: `Enter an amount of at least ${minorUnitsToDecimalString(1, currency)} ${currency}.`,
    };
  }
  return { ok: true, minor };
}

/** Minor units back to the decimal a person types, exactly (no floating point): 1234 USD is "12.34". */
export function minorUnitsToDecimalString(minor: number, currency: string): string {
  const digits = currencyMinorDigits(currency);
  const negative = minor < 0;
  const text = String(Math.abs(Math.trunc(minor))).padStart(digits + 1, "0");
  const whole = digits === 0 ? text : text.slice(0, -digits);
  const fraction = digits === 0 ? "" : `.${text.slice(-digits)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

function scopeColumns(value: ScopeInput): Pick<AlertRuleValues, "scope" | "provider" | "project_id" | "connection_id"> {
  return {
    scope: value.scope,
    provider: value.provider ?? null,
    project_id: value.projectId ?? null,
    connection_id: value.connectionId ?? null,
  };
}

/** The one alert rule schema: a discriminated union by `kind`, producing column values. */
export const alertRuleInputSchema = z
  .discriminatedUnion("kind", [allowanceRuleSchema, budgetRuleSchema, spendRuleSchema], {
    error: "Choose what to alert on.",
  })
  .superRefine((value, ctx) => {
    checkScopeTarget(value, ctx);
    if (value.kind === "spend_amount") {
      // A malformed currency already has its own message; the amount cannot be judged without one.
      if (value.amountPreset === CUSTOM_CHOICE && CURRENCY_PATTERN.test(value.currency)) {
        const result = amountToMinorUnits(value.amountCustom, value.currency);
        if (!result.ok) ctx.addIssue({ code: "custom", message: result.message, path: ["amountCustom"] });
      }
      return;
    }
    if (value.thresholdPreset === CUSTOM_CHOICE) {
      const message = customPercentError(value.thresholdCustom);
      if (message !== null) ctx.addIssue({ code: "custom", message, path: ["thresholdCustom"] });
    }
  })
  .transform((value): AlertRuleValues => {
    const scope = scopeColumns(value);
    const percent =
      value.kind === "spend_amount"
        ? null
        : Number(value.thresholdPreset === CUSTOM_CHOICE ? value.thresholdCustom : value.thresholdPreset);
    switch (value.kind) {
      case "allowance_percent":
        return {
          kind: value.kind,
          ...scope,
          metric_key: value.metricKey ?? null,
          budget_id: null,
          threshold_percent: percent,
          threshold_amount_minor: null,
          currency: null,
        };
      case "budget_percent":
        return {
          kind: value.kind,
          ...scope,
          metric_key: null,
          budget_id: value.budgetId,
          threshold_percent: percent,
          threshold_amount_minor: null,
          currency: null,
        };
      case "spend_amount":
        return {
          kind: value.kind,
          ...scope,
          metric_key: null,
          budget_id: null,
          threshold_percent: null,
          threshold_amount_minor: decimalToMinorUnits(
            value.amountPreset === CUSTOM_CHOICE ? (value.amountCustom ?? "") : value.amountPreset,
            value.currency,
          ),
          currency: value.currency,
        };
    }
  });

export const budgetInputSchema = z
  .object({
    name: z
      .string({ error: "Enter a budget name." })
      .min(1, "Enter a budget name.")
      .refine((name) => [...name].length <= BUDGET_NAME_MAX, {
        message: `Use ${BUDGET_NAME_MAX} characters or fewer.`,
      }),
    amount: z.string({ error: "Enter an amount." }),
    currency: currencySchema,
    ...scopeFields,
  })
  .strict()
  .superRefine((value, ctx) => {
    checkScopeTarget(value, ctx);
    if (!CURRENCY_PATTERN.test(value.currency)) return;
    const result = amountToMinorUnits(value.amount, value.currency);
    if (!result.ok) ctx.addIssue({ code: "custom", message: result.message, path: ["amount"] });
  })
  .transform(
    (value): BudgetValues => ({
      name: value.name,
      ...scopeColumns(value),
      amount_minor: decimalToMinorUnits(value.amount, value.currency),
      currency: value.currency,
    }),
  );

/**
 * First message per form field. Issues that belong to no field (a field from another kind of rule,
 * say) come back as `formError`: the form on screen is out of date with the server.
 */
export function fieldErrorsFrom(
  error: z.ZodError,
  fields: readonly string[],
): { fieldErrors: Record<string, string>; formError: boolean } {
  const known = new Set(fields);
  const fieldErrors: Record<string, string> = {};
  let formError = false;
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && known.has(field) && issue.code !== "unrecognized_keys") {
      fieldErrors[field] ??= issue.message;
    } else {
      formError = true;
    }
  }
  return { fieldErrors, formError };
}
