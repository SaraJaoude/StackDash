"use client";

import { createContext, use, useActionState, useId, useState, type ReactNode } from "react";

import {
  publishMetric,
  publishSelfReported,
  unpublishEverything,
  unpublishMetric,
  type PublicMetricActionResult,
} from "@/app/w/[workspace]/projects/[projectId]/public-metrics/actions";
import { inputClass, primaryButtonClass, smallButtonClass } from "@/components/alerts/form-controls";

import { SELF_REPORTED_LABEL_MAX, SELF_REPORTED_UNIT_MAX, type SelfReportedField } from "./self-reported-rules";

/*
 * Controls on the public metrics page (#148). A publish swaps its form for an Unpublish button and
 * the reverse, so success messages live in one polite live region above the list (it outlives the
 * control that triggered it) and focus moves to the section heading named by the caller rather
 * than being dropped. Failures stay beside the control, in an assertive region.
 */

type Announce = (message: string, focusId: string) => void;

const AnnounceContext = createContext<Announce | null>(null);

export function PublicationAnnouncer({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState("");
  const announce: Announce = (next, focusId) => {
    setMessage(next);
    document.getElementById(focusId)?.focus();
  };
  return (
    <AnnounceContext value={announce}>
      <div role="status" aria-live="polite" className="text-sm">
        {message === "" ? null : <p className="mt-6 text-success">{message}</p>}
      </div>
      {children}
    </AnnounceContext>
  );
}

/** Runs an action, announcing success through the page's live region. */
function useAnnouncedAction(
  action: (previous: PublicMetricActionResult | null, formData: FormData) => Promise<PublicMetricActionResult>,
  focusId: string,
) {
  const announce = use(AnnounceContext);
  if (announce === null) throw new Error("Publication controls must be rendered inside PublicationAnnouncer");
  return useActionState<PublicMetricActionResult | null, FormData>(async (previous, formData) => {
    const result = await action(previous, formData);
    if (result.ok) announce(result.message, focusId);
    return result;
  }, null);
}

function Failure({ state, id }: { state: PublicMetricActionResult | null; id?: string }) {
  const failure = state !== null && !state.ok ? state : null;
  return (
    <div id={id} role="alert" aria-live="assertive" className="text-sm">
      {failure === null ? null : (
        <p className="mt-2 text-danger">
          {failure.message}
          {failure.referenceId === undefined ? null : ` Reference ${failure.referenceId}.`}
        </p>
      )}
    </div>
  );
}

export type Choice = Readonly<{ value: string; label: string }>;

export function PublishMetricForm({
  workspaceSlug,
  projectId,
  metricId,
  metricLabel,
  roundings,
  delays,
  focusId,
}: {
  workspaceSlug: string;
  projectId: string;
  metricId: string;
  metricLabel: string;
  roundings: readonly Choice[];
  delays: readonly Choice[];
  /** Takes focus after a publish, when this form is replaced. */
  focusId: string;
}) {
  const [state, formAction, pending] = useAnnouncedAction(publishMetric, focusId);
  const roundingId = useId();
  const delayId = useId();
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      <input type="hidden" name="metricId" value={metricId} />
      <div>
        <label htmlFor={roundingId} className="block text-xs font-medium text-muted">
          Rounding
        </label>
        <select id={roundingId} name="rounding" defaultValue="exact" className={`${inputClass} mt-1 border-line-strong`}>
          {roundings.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={delayId} className="block text-xs font-medium text-muted">
          Timing
        </label>
        <select id={delayId} name="delayDays" defaultValue="0" className={`${inputClass} mt-1 border-line-strong`}>
          {delays.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </div>
      <button type="submit" disabled={pending} className={`${smallButtonClass} min-h-10`}>
        {pending ? "Publishing" : "Publish"}
        <span className="sr-only"> {metricLabel}</span>
      </button>
      <div className="basis-full">
        <Failure state={state} />
      </div>
    </form>
  );
}

export function UnpublishButton({
  workspaceSlug,
  publicationId,
  label,
  focusId,
}: {
  workspaceSlug: string;
  publicationId: string;
  label: string;
  focusId: string;
}) {
  const [state, formAction, pending] = useAnnouncedAction(unpublishMetric, focusId);
  return (
    <form action={formAction}>
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="publicationId" value={publicationId} />
      <button type="submit" disabled={pending} className={smallButtonClass}>
        {pending ? "Unpublishing" : "Unpublish"}
        <span className="sr-only"> {label}</span>
      </button>
      <Failure state={state} />
    </form>
  );
}

export function UnpublishEverythingButton({ workspaceSlug, focusId }: { workspaceSlug: string; focusId: string }) {
  const [state, formAction, pending] = useAnnouncedAction(unpublishEverything, focusId);
  return (
    <form action={formAction}>
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <button
        type="submit"
        disabled={pending}
        className="inline-flex min-h-10 items-center justify-center rounded-md border border-danger/60 px-4 py-2 text-sm font-medium text-danger transition-colors hover:bg-danger/10 disabled:opacity-60"
      >
        {pending ? "Unpublishing everything" : "Unpublish everything"}
      </button>
      <Failure state={state} />
    </form>
  );
}

const SELF_REPORTED_FIELDS: readonly { name: SelfReportedField; label: string; hint: string; maxLength: number; inputMode?: "numeric" }[] = [
  { name: "label", label: "Name", hint: "For example, Downloads this month.", maxLength: SELF_REPORTED_LABEL_MAX },
  { name: "value", label: "Value", hint: "A whole number.", maxLength: 13, inputMode: "numeric" },
  { name: "unit", label: "Unit", hint: "For example, downloads.", maxLength: SELF_REPORTED_UNIT_MAX },
];

export function SelfReportedForm({
  workspaceSlug,
  projectId,
  focusId,
}: {
  workspaceSlug: string;
  projectId: string;
  focusId: string;
}) {
  const announce = use(AnnounceContext);
  if (announce === null) throw new Error("Publication controls must be rendered inside PublicationAnnouncer");
  const baseId = useId();
  // Controlled, so a rejected value stays in its field to be corrected (a form action resets
  // uncontrolled fields) and a published one is cleared.
  const [values, setValues] = useState<Record<SelfReportedField, string>>({ label: "", value: "", unit: "" });
  const [state, formAction, pending] = useActionState<PublicMetricActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await publishSelfReported(previous, formData);
      if (result.ok) {
        setValues({ label: "", value: "", unit: "" });
        announce(result.message, focusId);
      } else {
        // Focus the first field the message is about, so its error is read out with it.
        const first = SELF_REPORTED_FIELDS.find((field) => result.fieldErrors?.[field.name] !== undefined);
        if (first !== undefined) document.getElementById(`${baseId}-${first.name}`)?.focus();
      }
      return result;
    },
    null,
  );
  const fieldErrors = state !== null && !state.ok ? (state.fieldErrors ?? {}) : {};
  return (
    <form action={formAction} noValidate className="grid gap-4 sm:grid-cols-3">
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="projectId" value={projectId} />
      {SELF_REPORTED_FIELDS.map((field) => {
        const id = `${baseId}-${field.name}`;
        const error = fieldErrors[field.name];
        return (
          <div key={field.name}>
            <label htmlFor={id} className="block text-sm font-medium">
              {field.label}
            </label>
            <p id={`${id}-hint`} className="mt-1 text-sm text-muted">
              {field.hint}
            </p>
            <input
              id={id}
              name={field.name}
              required
              maxLength={field.maxLength}
              inputMode={field.inputMode}
              value={values[field.name]}
              onChange={(event) => setValues((current) => ({ ...current, [field.name]: event.target.value }))}
              aria-invalid={error === undefined ? undefined : true}
              aria-describedby={error === undefined ? `${id}-hint` : `${id}-hint ${id}-error`}
              className={`${inputClass} mt-2 ${error === undefined ? "border-line-strong" : "border-danger"}`}
            />
            {error === undefined ? null : (
              <p id={`${id}-error`} className="mt-2 text-sm text-danger">
                <span className="font-medium">Error: </span>
                {error}
              </p>
            )}
          </div>
        );
      })}
      <div className="sm:col-span-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Publishing" : "Publish value"}
        </button>
        <Failure state={state} />
      </div>
    </form>
  );
}
