"use client";

import { useActionState, useId, useState } from "react";

import {
  muteAnomaly,
  setAnomalyDetection,
  unmuteAnomaly,
  type AlertActionResult,
} from "@/app/w/[workspace]/alerts/actions";

import { failureOf, secondaryButtonClass, SelectField, smallButtonClass } from "./form-controls";
import type { Option } from "./labels";

/**
 * Admin controls for anomaly detection (#169). Each form reports its outcome in a live region that
 * stays mounted, so the result is announced even though the server re-renders the section. When a
 * control's row goes away (an unmuted metric), focus moves to the section heading instead of
 * being dropped.
 */

function Outcome({ state, pending, success }: { state: AlertActionResult | null; pending: boolean; success: string }) {
  const failure = failureOf(state);
  return (
    <div role="status" aria-live="polite" className="mt-2 text-sm">
      {pending || state === null ? null : failure === null ? (
        <p className="text-success">{success}</p>
      ) : (
        <p className="text-danger">
          {failure.message}
          {failure.referenceId === undefined ? null : ` Reference ${failure.referenceId}.`}
        </p>
      )}
    </div>
  );
}

export function AnomalyToggle({ workspaceSlug, enabled }: { workspaceSlug: string; enabled: boolean }) {
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(setAnomalyDetection, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <button type="submit" disabled={pending} className={secondaryButtonClass}>
        {pending ? "Saving" : enabled ? "Turn off unusual spend and usage checks" : "Turn on unusual spend and usage checks"}
      </button>
      <Outcome
        state={state}
        pending={pending}
        success={
          enabled
            ? "Unusual spend and usage checks are on."
            : "Unusual spend and usage checks are off. No new unusual days are flagged."
        }
      />
    </form>
  );
}

export function MuteMetricForm({ workspaceSlug, options }: { workspaceSlug: string; options: Option[] }) {
  const [metric, setMetric] = useState("");
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await muteAnomaly(previous, formData);
      if (result.ok) setMetric("");
      return result;
    },
    null,
  );
  const fieldId = useId();
  const fieldError = failureOf(state)?.fieldErrors?.metric;
  return (
    <form action={formAction} className="px-6 py-5">
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <SelectField
            id={fieldId}
            name="metric"
            label="Metric to mute"
            hint="Muting stops new unusual day events for this metric. Events already on the timeline stay."
            error={fieldError}
            value={metric}
            onChange={setMetric}
            placeholder="Choose a metric"
            options={options}
          />
        </div>
        <button type="submit" disabled={pending} className={`${secondaryButtonClass} shrink-0`}>
          {pending ? "Muting" : "Mute metric"}
        </button>
      </div>
      <Outcome state={fieldError === undefined ? state : null} pending={pending} success="Metric muted." />
    </form>
  );
}

export function UnmuteButton({
  workspaceSlug,
  muteId,
  label,
  afterUnmuteFocusId,
}: {
  workspaceSlug: string;
  muteId: string;
  /** The metric's name, which makes the button name unique in the list. */
  label: string;
  /** The section heading, which takes focus once this row is gone. */
  afterUnmuteFocusId: string;
}) {
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await unmuteAnomaly(previous, formData);
      if (result.ok) document.getElementById(afterUnmuteFocusId)?.focus();
      return result;
    },
    null,
  );
  const failure = failureOf(state);
  return (
    <form action={formAction}>
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="muteId" value={muteId} />
      <button type="submit" disabled={pending} className={smallButtonClass}>
        {pending ? "Unmuting" : "Unmute"}
        <span className="sr-only">: {label}</span>
      </button>
      <div role="alert" aria-live="assertive" className="text-sm">
        {failure === null ? null : (
          <p className="mt-2 text-danger">
            {failure.message}
            {failure.referenceId === undefined ? null : ` Reference ${failure.referenceId}.`}
          </p>
        )}
      </div>
    </form>
  );
}
