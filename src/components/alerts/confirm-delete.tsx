"use client";

import { useActionState, useId, useRef } from "react";

import type { AlertActionResult } from "@/app/w/[workspace]/alerts/actions";

import { failureOf, secondaryButtonClass, smallButtonClass } from "./form-controls";

const dangerButtonClass =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-danger px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-60";

type Action = (previous: AlertActionResult | null, formData: FormData) => Promise<AlertActionResult>;

/**
 * A delete button that asks first, in a modal `<dialog>`: focus moves into it, Escape closes it,
 * and focus returns to the button. After a delete the row is gone, so focus moves to
 * `afterDeleteFocusId` (the section heading) instead.
 */
export function ConfirmDelete({
  label,
  accessibleSuffix,
  title,
  description,
  confirmLabel,
  action,
  fields,
  afterDeleteFocusId,
}: {
  label: string;
  /** Visually hidden text that makes the button name unique in a list, such as the rule summary. */
  accessibleSuffix: string;
  title: string;
  description: string;
  confirmLabel: string;
  action: Action;
  fields: Record<string, string>;
  afterDeleteFocusId: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const deletedRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await action(previous, formData);
      if (result.ok) {
        deletedRef.current = true;
        dialogRef.current?.close();
        document.getElementById(afterDeleteFocusId)?.focus();
      }
      return result;
    },
    null,
  );
  const failure = failureOf(state);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className={`${smallButtonClass} text-danger`}
      >
        {label}
        <span className="sr-only">: {accessibleSuffix}</span>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => {
          if (!deletedRef.current) triggerRef.current?.focus();
        }}
        className="m-auto w-full max-w-md rounded-xl border border-line bg-panel p-6 text-foreground backdrop:bg-black/60"
      >
        <h3 id={titleId} className="text-lg font-semibold tracking-tight">
          {title}
        </h3>
        <p id={descriptionId} className="mt-2 text-sm leading-6 text-muted">
          {description}
        </p>
        <form action={formAction} className="mt-6">
          {Object.entries(fields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <div role="status" aria-live="polite" className="text-sm">
            {failure === null ? null : (
              <p className="mb-4 text-danger">
                {failure.message}
                {failure.referenceId === undefined ? null : (
                  <>
                    {" "}
                    Reference <code className="font-mono text-xs text-foreground">{failure.referenceId}</code>.
                  </>
                )}
              </p>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <button type="button" onClick={() => dialogRef.current?.close()} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="submit" disabled={pending} className={dangerButtonClass}>
              {pending ? "Deleting" : confirmLabel}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
