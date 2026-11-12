"use client";

import { useActionState } from "react";

import type { AlertActionResult } from "@/app/w/[workspace]/alerts/actions";
import { GuardedButton } from "@/components/guarded-button";
import { buttonClass } from "@/components/ui/button";
import { DialogError } from "@/components/ui/dialog-error";
import { DialogActions, DialogCloseButton, ModalDialog, useModalDialog } from "@/components/ui/modal-dialog";

import { failureOf } from "./form-controls";

type Action = (previous: AlertActionResult | null, formData: FormData) => Promise<AlertActionResult>;

/**
 * A delete button that asks first, in a `ModalDialog`. Escape or Cancel returns focus to the
 * button; after a delete the row is gone, so focus moves to `afterDeleteFocusId` (the section
 * heading) instead. The confirmation remounts on every open, so it starts without a previous
 * attempt's error.
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
  const dialog = useModalDialog();

  return (
    <>
      <button
        type="button"
        onClick={(event) => dialog.open(event.currentTarget)}
        className={`${buttonClass("raised", "xs")} text-danger`}
      >
        {label}
        <span className="sr-only">: {accessibleSuffix}</span>
      </button>
      <ModalDialog dialog={dialog} title={title} description={description} size="sm" fallbackFocusId={afterDeleteFocusId}>
        <ConfirmDeleteForm
          confirmLabel={confirmLabel}
          action={action}
          fields={fields}
          onDeleted={() => dialog.close("completed")}
        />
      </ModalDialog>
    </>
  );
}

function ConfirmDeleteForm({
  confirmLabel,
  action,
  fields,
  onDeleted,
}: {
  confirmLabel: string;
  action: Action;
  fields: Record<string, string>;
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
      <form action={formAction}>
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <DialogActions>
          <DialogCloseButton className={buttonClass("raised")} />
          <GuardedButton type="submit" unavailable={pending} className={buttonClass("danger")}>
            {pending ? "Deleting" : confirmLabel}
          </GuardedButton>
        </DialogActions>
      </form>
    </>
  );
}
