"use client";

import { useActionState, useId, useState } from "react";

import { saveBudget, type AlertActionResult } from "@/app/w/[workspace]/alerts/actions";
import { GuardedButton } from "@/components/guarded-button";
import { buttonClass } from "@/components/ui/button";
import { BUDGET_NAME_MAX } from "@/lib/alerts/rule-schema";

import {
  ErrorSummary,
  failureOf,
  ScopeFields,
  SelectField,
  TextField,
} from "./form-controls";
import type { AlertFormOptions, BudgetFormValues } from "./labels";

/** Creates a budget, or edits one when `budgetId` is set. Same field conventions as RuleForm. */
export function BudgetForm({
  options,
  initial,
  budgetId,
  title,
  onSaved,
  onCancel,
}: {
  options: AlertFormOptions;
  initial: BudgetFormValues;
  budgetId?: string;
  title: string;
  onSaved?: () => void;
  onCancel?: () => void;
}) {
  const isEdit = budgetId !== undefined;
  const [values, setValues] = useState(initial);
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await saveBudget(previous, formData);
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
  const update = (patch: Partial<BudgetFormValues>) => setValues((current) => ({ ...current, ...patch }));

  const fieldIds = {
    name: `${id}-name`,
    amount: `${id}-amount`,
    currency: `${id}-currency`,
    scope: `${id}-scope`,
    provider: `${id}-provider`,
    projectId: `${id}-projectId`,
    connectionId: `${id}-connectionId`,
  };

  return (
    <form action={formAction} aria-label={title} className="space-y-5">
      <input type="hidden" name="workspace" value={options.workspaceSlug} />
      {budgetId === undefined ? null : <input type="hidden" name="budgetId" value={budgetId} />}

      <ErrorSummary
        state={state}
        title={isEdit ? "The changes were not saved" : "The budget was not added"}
        fieldIds={fieldIds}
      />

      <div className="max-w-md">
        <TextField
          id={fieldIds.name}
          name="name"
          label="Budget name"
          hint={`Up to ${BUDGET_NAME_MAX} characters, such as Production apps.`}
          error={errors.name}
          value={values.name}
          onChange={(name) => update({ name })}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          id={fieldIds.amount}
          name="amount"
          label="Monthly amount"
          hint="As a number such as 250.00. Resets on the first of each month."
          error={errors.amount}
          value={values.amount}
          onChange={(amount) => update({ amount })}
          inputMode="decimal"
        />
        <SelectField
          id={fieldIds.currency}
          name="currency"
          label="Currency"
          hint="Spend in other currencies is never converted or counted."
          error={errors.currency}
          value={values.currency}
          onChange={(currency) => update({ currency })}
          options={options.currencies.map((currency) => ({ value: currency, label: currency }))}
        />
      </div>

      <ScopeFields idPrefix={id} values={values} onChange={update} errors={errors} options={options} />

      <div className="flex flex-wrap items-center gap-3">
        <GuardedButton type="submit" unavailable={pending} className={buttonClass("primary")}>
          {pending ? "Saving" : isEdit ? "Save changes" : "Add budget"}
        </GuardedButton>
        {onCancel === undefined ? null : (
          <button type="button" onClick={onCancel} className={buttonClass("raised")}>
            Cancel
          </button>
        )}
      </div>

      <div role="status" aria-live="polite" className="text-sm">
        {!pending && state?.ok === true && !isEdit ? <p className="text-success">Budget added.</p> : null}
      </div>
    </form>
  );
}
