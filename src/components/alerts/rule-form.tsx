"use client";

import { useActionState, useId, useState } from "react";

import { saveAlertRule, type AlertActionResult } from "@/app/w/[workspace]/alerts/actions";
import { GuardedButton } from "@/components/guarded-button";
import { buttonClass } from "@/components/ui/button";
import { AMOUNT_PRESETS, PERCENT_MAX, PERCENT_MIN, PERCENT_PRESETS } from "@/lib/alerts/rule-schema";
import { Constants } from "@/lib/supabase/database.types";

import {
  ErrorSummary,
  failureOf,
  PresetField,
  ScopeFields,
  SelectField,
} from "./form-controls";
import { formatMajorAmount, KIND_LABELS, type AlertFormOptions, type RuleFormValues } from "./labels";

/**
 * Creates a rule, or edits one when `ruleId` is set. Fields are controlled so a rejected value
 * stays on screen for correcting (React resets uncontrolled fields after a form action), and only
 * the fields for the chosen kind are rendered, so only those are posted.
 */
export function RuleForm({
  options,
  initial,
  ruleId,
  title,
  onSaved,
  onCancel,
}: {
  options: AlertFormOptions;
  initial: RuleFormValues;
  ruleId?: string;
  /** Accessible name of the form, matching the heading above it. */
  title: string;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const isEdit = ruleId !== undefined;
  const [values, setValues] = useState(initial);
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await saveAlertRule(previous, formData);
      if (result.ok) {
        if (isEdit) onSaved?.();
        else setValues(initial);
      }
      return result;
    },
    null,
  );
  const id = useId();
  const errors = failureOf(state)?.fieldErrors ?? {};
  const update = (patch: Partial<RuleFormValues>) => setValues((current) => ({ ...current, ...patch }));

  const fieldIds = {
    kind: `${id}-kind`,
    scope: `${id}-scope`,
    provider: `${id}-provider`,
    projectId: `${id}-projectId`,
    connectionId: `${id}-connectionId`,
    metricKey: `${id}-metricKey`,
    budgetId: `${id}-budgetId`,
    thresholdPreset: `${id}-threshold`,
    thresholdCustom: `${id}-threshold-custom-input`,
    amountPreset: `${id}-amount`,
    amountCustom: `${id}-amount-custom-input`,
    currency: `${id}-currency`,
  };
  const kindErrorId = `${id}-kind-error`;
  const isPercentKind = values.kind !== "spend_amount";

  return (
    <form action={formAction} aria-label={title} className="space-y-5" noValidate>
      <input type="hidden" name="workspace" value={options.workspaceSlug} />
      {ruleId === undefined ? null : <input type="hidden" name="ruleId" value={ruleId} />}

      <ErrorSummary
        state={state}
        title={isEdit ? "The changes were not saved" : "The alert rule was not added"}
        fieldIds={fieldIds}
      />

      <fieldset aria-describedby={errors.kind === undefined ? undefined : kindErrorId}>
        <legend className="text-sm font-medium">Alert when</legend>
        <div className="mt-2 space-y-2">
          {Constants.public.Enums.alert_rule_kind.map((kind, index) => {
            const optionId = index === 0 ? fieldIds.kind : `${id}-kind-${kind}`;
            return (
              <div key={kind} className="flex min-h-6 items-center gap-2">
                <input
                  id={optionId}
                  type="radio"
                  name="kind"
                  value={kind}
                  checked={values.kind === kind}
                  onChange={() => update({ kind })}
                  className="size-4 accent-accent"
                />
                <label htmlFor={optionId} className="text-sm">
                  {KIND_LABELS[kind]}
                </label>
              </div>
            );
          })}
        </div>
        {errors.kind === undefined ? null : (
          <p id={kindErrorId} className="mt-2 text-sm text-danger">
            <span className="font-medium">Error: </span>
            {errors.kind}
          </p>
        )}
      </fieldset>

      {isPercentKind ? (
        <PresetField
          id={`${id}-threshold`}
          name="thresholdPreset"
          legend={values.kind === "budget_percent" ? "Percentage of the budget" : "Percentage of the allowance"}
          presets={PERCENT_PRESETS.map((preset) => ({ value: preset, label: `${preset}%` }))}
          value={values.thresholdPreset}
          onChange={(thresholdPreset) => update({ thresholdPreset })}
          error={errors.thresholdPreset}
          customName="thresholdCustom"
          customLabel="Custom percentage"
          customHint={`A whole number from ${PERCENT_MIN} to ${PERCENT_MAX}. Above 100 alerts on overage.`}
          customValue={values.thresholdCustom}
          onCustomChange={(thresholdCustom) => update({ thresholdCustom })}
          customError={errors.thresholdCustom}
          customInputMode="numeric"
        />
      ) : (
        <>
          <div className="max-w-xs">
            <SelectField
              id={fieldIds.currency}
              name="currency"
              label="Currency"
              hint="Spend in other currencies is never converted or added to this."
              error={errors.currency}
              value={values.currency}
              onChange={(currency) => update({ currency })}
              options={options.currencies.map((currency) => ({ value: currency, label: currency }))}
            />
          </div>
          <PresetField
            id={`${id}-amount`}
            name="amountPreset"
            legend="Amount"
            presets={AMOUNT_PRESETS.map((preset) => ({
              value: preset,
              label: formatMajorAmount(Number(preset), values.currency),
            }))}
            value={values.amountPreset}
            onChange={(amountPreset) => update({ amountPreset })}
            error={errors.amountPreset}
            customName="amountCustom"
            customLabel="Custom amount"
            customHint={`In ${values.currency}, as a number such as 12.50.`}
            customValue={values.amountCustom}
            onCustomChange={(amountCustom) => update({ amountCustom })}
            customError={errors.amountCustom}
            customInputMode="decimal"
          />
        </>
      )}

      {values.kind === "allowance_percent" ? (
        options.metrics.length === 0 ? (
          <p className="text-sm text-muted">
            The rule watches every allowance. Specific allowances appear here after a provider syncs.
          </p>
        ) : (
          <div className="max-w-md">
            <SelectField
              id={fieldIds.metricKey}
              name="metricKey"
              label="Allowance"
              hint="Optional. Leave as every allowance to watch them all."
              error={errors.metricKey}
              value={values.metricKey}
              onChange={(metricKey) => update({ metricKey })}
              placeholder="Every allowance"
              options={options.metrics}
            />
          </div>
        )
      ) : null}

      {values.kind === "budget_percent" ? (
        <div className="max-w-md">
          <SelectField
            id={fieldIds.budgetId}
            name="budgetId"
            label="Budget"
            {...(options.budgets.length === 0 ? { hint: "No budgets yet. Add one under Budgets first." } : {})}
            error={errors.budgetId}
            value={values.budgetId}
            onChange={(budgetId) => update({ budgetId })}
            placeholder="Choose a budget"
            options={options.budgets}
          />
        </div>
      ) : null}

      <ScopeFields idPrefix={id} values={values} onChange={update} errors={errors} options={options} />

      <div className="flex flex-wrap items-center gap-3">
        <GuardedButton type="submit" unavailable={pending} className={buttonClass("primary")}>
          {pending ? "Saving" : isEdit ? "Save changes" : "Add alert rule"}
        </GuardedButton>
        {onCancel === undefined ? null : (
          <button type="button" onClick={onCancel} className={buttonClass("raised")}>
            Cancel
          </button>
        )}
      </div>

      {/* Always mounted so screen readers announce changes to it. */}
      <div role="status" aria-live="polite" className="text-sm">
        {!pending && state?.ok === true && !isEdit ? <p className="text-success">Alert rule added.</p> : null}
      </div>
    </form>
  );
}
