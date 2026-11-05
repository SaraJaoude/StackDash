"use client";

import { useActionState, useId, useState } from "react";

import { saveAlertEmails, type AlertActionResult } from "@/app/w/[workspace]/alerts/actions";
import type { EmailFrequency } from "@/lib/notifications/model";

import { ErrorSummary, primaryButtonClass, submitWithoutReset } from "./form-controls";
import { EMAIL_FREQUENCY_CHOICES } from "./labels";

/**
 * The signed-in owner or admin's own alert email setting (#152): each alert as it happens, a daily
 * or weekly digest, or off. Controlled, and submitted without React's form reset
 * (submitWithoutReset), so the chosen option stays selected after the action.
 */
export function AlertEmailsForm({ workspaceSlug, current }: { workspaceSlug: string; current: EmailFrequency }) {
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(saveAlertEmails, null);
  const [frequency, setFrequency] = useState<EmailFrequency>(current);
  const id = useId();
  return (
    <form action={formAction} onSubmit={submitWithoutReset(formAction)} aria-label="Alert emails" className="space-y-4">
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <ErrorSummary state={state} title="Your alert email setting was not saved" fieldIds={{}} />
      <fieldset>
        <legend className="text-sm font-medium">Send me alert emails</legend>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {EMAIL_FREQUENCY_CHOICES.map((choice) => {
            const optionId = `${id}-${choice.value}`;
            const hintId = `${optionId}-hint`;
            return (
              <label
                key={choice.value}
                htmlFor={optionId}
                className="flex min-h-10 cursor-pointer items-start gap-3 rounded-md border border-line-strong bg-panel-raised px-3 py-2 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft"
              >
                <input
                  id={optionId}
                  type="radio"
                  name="frequency"
                  value={choice.value}
                  checked={frequency === choice.value}
                  onChange={() => setFrequency(choice.value)}
                  aria-describedby={hintId}
                  className="mt-0.5 size-4 shrink-0 accent-accent"
                />
                <span>
                  <span className="block font-medium">{choice.label}</span>
                  <span id={hintId} className="block text-muted">
                    {choice.hint}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <button type="submit" disabled={pending} className={primaryButtonClass}>
        {pending ? "Saving" : "Save alert emails"}
      </button>
      <div role="status" aria-live="polite" className="text-sm">
        {!pending && state?.ok === true ? <p className="text-success">Alert email setting saved.</p> : null}
      </div>
    </form>
  );
}
