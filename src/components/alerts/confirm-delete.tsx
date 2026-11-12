"use client";

import { useActionState, useId, useRef, useState } from "react";

import type { AlertActionResult } from "@/app/w/[workspace]/alerts/actions";
import { GuardedButton } from "@/components/guarded-button";
import { buttonClass } from "@/components/ui/button";
import { DialogError } from "@/components/ui/dialog-error";

import { failureOf } from "./form-controls";

type Action = (previous: AlertActionResult | null, formData: FormData) => Promise<AlertActionResult>;

/**
 * A delete button that asks first, in a modal `<dialog>`: focus moves into it, Escape closes it,
 * and focus returns to the button. After a delete the row is gone, so focus moves to
 * `afterDeleteFocusId` (the section heading) instead. Like `DeleteProjectDialog`, the
 * confirmation remounts on every open, so it starts without a previous attempt's error.
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
  // Bumped on every open so the confirmation starts fresh, without a previous attempt's error.
  const [openCount, setOpenCount] = useState(0);
  const titleId = useId();
  const descriptionId = useId();

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setOpenCount((count) => count + 1);
          dialogRef.current?.showModal();
        }}
        className={`${buttonClass("raised", "xs")} text-danger`}
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
        {/* Mounted on first open only, so its autofocus never fires on page load. */}
        {openCount === 0 ? null : (
          <ConfirmDeleteForm
            key={openCount}
            confirmLabel={confirmLabel}
            action={action}
            fields={fields}
            onCancel={() => dialogRef.current?.close()}
            onDeleted={() => {
              deletedRef.current = true;
              dialogRef.current?.close();
              document.getElementById(afterDeleteFocusId)?.focus();
            }}
          />
        )}
      </dialog>
    </>
  );
}

function ConfirmDeleteForm({
  confirmLabel,
  action,
  fields,
  onCancel,
  onDeleted,
}: {
  confirmLabel: string;
  action: Action;
  fields: Record<string, string>;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [state, formAction, pending] = useActionState<AlertActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await action(previous, formData);
      if (result.ok) onDeleted();
      return result;
    },
    null,
  );

  return (
    <>
      <DialogError failure={failureOf(state)} />
      <form action={formAction} className="mt-6">
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div className="flex flex-wrap justify-end gap-3">
          {/* Cancel first and focused, so Enter right after opening never deletes. */}
          <button type="button" autoFocus onClick={onCancel} className={buttonClass("raised")}>
            Cancel
          </button>
          <GuardedButton type="submit" unavailable={pending} className={buttonClass("danger")}>
            {pending ? "Deleting" : confirmLabel}
          </GuardedButton>
        </div>
      </form>
    </>
  );
}
