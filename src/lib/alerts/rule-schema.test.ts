import { describe, expect, it } from "vitest";

import {
  alertRuleInputSchema,
  budgetInputSchema,
  BUDGET_FORM_FIELDS,
  fieldErrorsFrom,
  minorUnitsToDecimalString,
  pickFormFields,
  RULE_FORM_FIELDS,
} from "./rule-schema";

const PROJECT_ID = "6f1c2b3a-1d2e-4f5a-8b9c-0d1e2f3a4b5c";
const BUDGET_ID = "0b6e1c8a-4a2f-4c1e-9d3b-7e5f6a7b8c9d";

function ruleErrors(input: Record<string, unknown>) {
  const result = alertRuleInputSchema.safeParse(input);
  if (result.success) throw new Error("expected the rule to be rejected");
  return fieldErrorsFrom(result.error, RULE_FORM_FIELDS);
}

function budgetErrors(input: Record<string, unknown>) {
  const result = budgetInputSchema.safeParse(input);
  if (result.success) throw new Error("expected the budget to be rejected");
  return fieldErrorsFrom(result.error, BUDGET_FORM_FIELDS);
}

const allowanceBase = { kind: "allowance_percent", scope: "workspace", thresholdPreset: "custom" } as const;
const spendBase = { kind: "spend_amount", scope: "workspace", amountPreset: "custom", currency: "USD" } as const;

describe("alertRuleInputSchema: allowance percent", () => {
  it("accepts a preset of 75 percent across the workspace", () => {
    expect(alertRuleInputSchema.parse({ kind: "allowance_percent", scope: "workspace", thresholdPreset: "75" })).toEqual({
      kind: "allowance_percent",
      scope: "workspace",
      provider: null,
      project_id: null,
      connection_id: null,
      metric_key: null,
      budget_id: null,
      threshold_percent: 75,
      threshold_amount_minor: null,
      currency: null,
    });
  });

  it.each([
    ["1 percent (lower bound)", "1", 1],
    ["1000 percent (upper bound)", "1000", 1000],
  ])("accepts a custom %s", (_label, custom, expected) => {
    expect(alertRuleInputSchema.parse({ ...allowanceBase, thresholdCustom: custom }).threshold_percent).toBe(expected);
  });

  it.each([
    ["0 percent (below the lower bound)", "0"],
    ["1001 percent (above the upper bound)", "1001"],
    ["a decimal percent", "12.5"],
    ["a percent with the sign", "50%"],
  ])("rejects a custom %s on the custom field", (_label, custom) => {
    expect(ruleErrors({ ...allowanceBase, thresholdCustom: custom }).fieldErrors.thresholdCustom).toMatch(/1 to 1000/);
  });

  it("rejects custom chosen with no percentage", () => {
    expect(ruleErrors(allowanceBase).fieldErrors.thresholdCustom).toBe("Enter a percentage from 1 to 1000.");
  });

  it("ignores a stale custom value when a preset is chosen", () => {
    expect(
      alertRuleInputSchema.parse({ ...allowanceBase, thresholdPreset: "90", thresholdCustom: "5000" }).threshold_percent,
    ).toBe(90);
  });

  it("keeps a metric key and rejects one in the wrong format", () => {
    expect(
      alertRuleInputSchema.parse({ ...allowanceBase, thresholdPreset: "50", metricKey: "vercel.build_minutes.monthly" })
        .metric_key,
    ).toBe("vercel.build_minutes.monthly");
    expect(ruleErrors({ ...allowanceBase, thresholdPreset: "50", metricKey: "Not A Key" }).fieldErrors.metricKey).toBe(
      "Choose an allowance from the list.",
    );
  });
});

describe("alertRuleInputSchema: spend amount", () => {
  it("converts a preset amount to minor units on the server", () => {
    const values = alertRuleInputSchema.parse({ ...spendBase, amountPreset: "25" });
    expect(values).toMatchObject({ threshold_amount_minor: 2500, currency: "USD", threshold_percent: null });
  });

  it("accepts 0.01 (the smallest USD amount)", () => {
    expect(alertRuleInputSchema.parse({ ...spendBase, amountCustom: "0.01" }).threshold_amount_minor).toBe(1);
  });

  it("uses the currency's minor unit (JPY has none)", () => {
    expect(alertRuleInputSchema.parse({ ...spendBase, currency: "JPY", amountCustom: "1500" }).threshold_amount_minor).toBe(
      1500,
    );
  });

  it.each([
    ["0", /at least 0\.01 USD/],
    ["0.001 (rounds to zero)", /at least 0\.01 USD/],
    ["-5", /at least 0\.01 USD/],
    ["12,50", /as a number/],
    ["$10", /as a number/],
    ["99999999999999999999 (very large)", /smaller amount/],
  ])("rejects the amount %s", (label, message) => {
    const amount = label.split(" ")[0] ?? label;
    expect(ruleErrors({ ...spendBase, amountCustom: amount }).fieldErrors.amountCustom).toMatch(message);
  });

  it("rejects a lowercase currency", () => {
    expect(ruleErrors({ ...spendBase, currency: "usd", amountCustom: "10" }).fieldErrors.currency).toMatch(/capitals/);
  });

  it("rejects a well-formed currency code the runtime does not know, and leaves the amount alone", () => {
    const { fieldErrors } = ruleErrors({ ...spendBase, currency: "ABC", amountCustom: "10" });
    expect(fieldErrors.currency).toBe("Choose a known currency code, such as USD.");
    expect(fieldErrors.amountCustom).toBeUndefined();
  });

  it("accepts a known currency code", () => {
    expect(alertRuleInputSchema.parse({ ...spendBase, currency: "USD", amountCustom: "10" }).currency).toBe("USD");
  });

  it("rejects client minor units as an unknown field", () => {
    const { formError } = ruleErrors({ ...spendBase, amountPreset: "10", threshold_amount_minor: 1 });
    expect(formError).toBe(true);
  });
});

describe("alertRuleInputSchema: budget percent", () => {
  it("accepts a preset with a budget", () => {
    expect(
      alertRuleInputSchema.parse({ kind: "budget_percent", scope: "workspace", thresholdPreset: "100", budgetId: BUDGET_ID }),
    ).toMatchObject({ budget_id: BUDGET_ID, threshold_percent: 100 });
  });

  it("rejects a budget percent rule without a budget", () => {
    expect(
      ruleErrors({ kind: "budget_percent", scope: "workspace", thresholdPreset: "100" }).fieldErrors.budgetId,
    ).toMatch(/Choose a budget/);
  });
});

describe("alertRuleInputSchema: scope", () => {
  it("accepts a project scope with its project", () => {
    expect(
      alertRuleInputSchema.parse({ kind: "allowance_percent", scope: "project", projectId: PROJECT_ID, thresholdPreset: "50" }),
    ).toMatchObject({ scope: "project", project_id: PROJECT_ID, provider: null, connection_id: null });
  });

  it("rejects a provider scope with no provider", () => {
    expect(ruleErrors({ ...allowanceBase, thresholdPreset: "50", scope: "provider" }).fieldErrors.provider).toBe(
      "Choose a provider.",
    );
  });

  it("rejects a target that does not match the scope", () => {
    const { fieldErrors } = ruleErrors({
      ...allowanceBase,
      thresholdPreset: "50",
      scope: "provider",
      provider: "vercel",
      projectId: PROJECT_ID,
    });
    expect(fieldErrors.projectId).toMatch(/does not match/);
  });

  it("rejects a workspace scope that names a provider", () => {
    expect(
      ruleErrors({ ...allowanceBase, thresholdPreset: "50", provider: "vercel" }).fieldErrors.provider,
    ).toMatch(/does not match/);
  });

  it("rejects a field from another kind of rule", () => {
    expect(ruleErrors({ ...allowanceBase, thresholdPreset: "50", currency: "USD" }).formError).toBe(true);
  });

  it("rejects an unknown kind on the kind field", () => {
    expect(ruleErrors({ kind: "everything", scope: "workspace" }).fieldErrors.kind).toBe("Choose what to alert on.");
  });
});

describe("budgetInputSchema", () => {
  const base = { name: "Team budget", amount: "250.50", currency: "GBP", scope: "workspace" } as const;

  it("converts the amount to minor units", () => {
    expect(budgetInputSchema.parse(base)).toEqual({
      name: "Team budget",
      scope: "workspace",
      provider: null,
      project_id: null,
      connection_id: null,
      amount_minor: 25050,
      currency: "GBP",
    });
  });

  it("accepts an 80 character name and rejects 81", () => {
    expect(budgetInputSchema.parse({ ...base, name: "a".repeat(80) }).name).toHaveLength(80);
    expect(budgetErrors({ ...base, name: "a".repeat(81) }).fieldErrors.name).toBe("Use 80 characters or fewer.");
  });

  it("rejects a missing name and a lowercase currency, each on its own field", () => {
    const { fieldErrors } = budgetErrors({ amount: "0", currency: "gbp", scope: "workspace" });
    expect(fieldErrors.name).toBe("Enter a budget name.");
    expect(fieldErrors.currency).toMatch(/capitals/);
  });

  it("rejects a well-formed currency code the runtime does not know", () => {
    expect(budgetErrors({ ...base, currency: "ABC" }).fieldErrors.currency).toBe("Choose a known currency code, such as USD.");
  });

  it("rejects a zero amount", () => {
    expect(budgetErrors({ ...base, amount: "0" }).fieldErrors.amount).toMatch(/at least 0\.01 GBP/);
  });

  it("rejects a connection scope without a connection", () => {
    expect(budgetErrors({ ...base, scope: "connection" }).fieldErrors.connectionId).toBe("Choose a connection.");
  });
});

describe("pickFormFields", () => {
  it("trims values and drops empty and missing fields", () => {
    const form = new FormData();
    form.set("kind", " spend_amount ");
    form.set("amountCustom", "   ");
    form.set("unrelated", "x");
    expect(pickFormFields(form, RULE_FORM_FIELDS)).toEqual({ kind: "spend_amount" });
  });
});

describe("minorUnitsToDecimalString", () => {
  it.each([
    [1234, "USD", "12.34"],
    [1, "USD", "0.01"],
    [0, "USD", "0.00"],
    [1500, "JPY", "1500"],
    [1, "KWD", "0.001"],
    [Number.MAX_SAFE_INTEGER, "USD", "90071992547409.91"],
  ])("formats %d %s as %s", (minor, currency, expected) => {
    expect(minorUnitsToDecimalString(minor, currency)).toBe(expected);
  });
});
