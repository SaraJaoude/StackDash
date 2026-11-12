"use client";

import { useActionState, useId, useState } from "react";

import {
  muteAnomaly,
  setAnomalyDetection,
  unmuteAnomaly,
  type AlertActionResult,
} from "@/app/w/[workspace]/alerts/actions";
import { buttonClass } from "@/components/ui/button";
import { FailureAnnouncement, OutcomeAnnouncement, outcomeOf } from "@/components/ui/live-region";

import { failureOf, SelectField } from "./form-controls";
import type { Option } from "./labels";

/**
 * Admin controls for anomaly detection (#169). Each form reports its outcome in a live region that
 * stays mounted, so the result is announced even though the server re-renders the section. When a
 * control's row goes away (an unmuted metric), focus moves to the section heading instead of
 * being dropped.
 */

export function AnomalyToggle({ workspaceSlug, enabled }: { workspaceSlug: string; enabled: boolean }) {
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(setAnomalyDetection, null);
  return (
    <form action={formAction}>
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="enabled" value={enabled ? "false" : "true"} />
      <button type="submit" disabled={pending} className={buttonClass("raised")}>
        {pending ? "Saving" : enabled ? "Turn off anomaly detection" : "Turn on anomaly detection"}
      </button>
      <OutcomeAnnouncement
        outcome={outcomeOf(
          pending ? null : state,
          enabled ? "Anomaly detection is on." : "Anomaly detection is off. No new unusual days are flagged.",
        )}
        className="mt-2 text-sm"
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
        <button type="submit" disabled={pending} className={`shrink-0 ${buttonClass("raised")}`}>
          {pending ? "Muting" : "Mute metric"}
        </button>
      </div>
      <OutcomeAnnouncement
        outcome={outcomeOf(pending || fieldError !== undefined ? null : state, "Metric muted.")}
        className="mt-2 text-sm"
      />
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
  return (
    <form action={formAction}>
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="muteId" value={muteId} />
      <button type="submit" disabled={pending} className={buttonClass("raised", "xs")}>
        {pending ? "Unmuting" : "Unmute"}
        <span className="sr-only">: {label}</span>
      </button>
      <FailureAnnouncement failure={failureOf(state)} className="text-sm" messageClassName="mt-2" />
    </form>
  );
}
