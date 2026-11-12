"use client";

import { useActionState, useId, useState } from "react";

import { GuardedButton } from "@/components/guarded-button";
import { buttonClass } from "@/components/ui/button";

import { renameWorkspace, type RenameWorkspaceResult } from "./actions";

/**
 * Rename form for owners and admins. The input is controlled so a rejected name stays in the box
 * for correcting; React resets uncontrolled fields after every form action. Length limits are
 * enforced by the server, not `maxLength`/`required`, so the field error explains the rule.
 */
export function RenameWorkspaceForm({ workspaceSlug, currentName }: { workspaceSlug: string; currentName: string }) {
  const [state, formAction, pending] = useActionState<RenameWorkspaceResult | null, FormData>(
    renameWorkspace,
    null,
  );
  const [name, setName] = useState(currentName);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const fieldError = state !== null && !state.ok ? state.fieldErrors?.name : undefined;
  const formError = state !== null && !state.ok && fieldError === undefined ? state : undefined;

  return (
    <form action={formAction} className="px-6 py-5">
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <label htmlFor={inputId} className="block text-sm font-medium">
        Workspace name
      </label>
      <p id={hintId} className="mt-1 text-sm text-muted">
        Up to 80 characters. Renaming keeps the workspace ID, the handle, and every link the same.
      </p>
      <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <input
            id={inputId}
            name="name"
            type="text"
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-invalid={fieldError === undefined ? undefined : true}
            aria-describedby={fieldError === undefined ? hintId : `${hintId} ${errorId}`}
            className={`block min-h-10 w-full rounded-md border bg-panel-raised px-3 py-2 text-sm text-foreground ${
              fieldError === undefined ? "border-line-strong" : "border-danger"
            }`}
          />
          {fieldError === undefined ? null : (
            <p id={errorId} className="mt-2 text-sm text-danger">
              <span className="font-medium">Error: </span>
              {fieldError}
            </p>
          )}
        </div>
        <GuardedButton
          type="submit"
          unavailable={pending}
          className={`shrink-0 ${buttonClass("primary")}`}
        >
          {pending ? "Saving" : "Save name"}
        </GuardedButton>
      </div>

      {/* Always mounted so screen readers announce changes to it. */}
      <div role="status" aria-live="polite" className="mt-3 text-sm">
        {pending ? null : state?.ok === true ? (
          <p className="text-success">Workspace renamed.</p>
        ) : state !== null && !state.ok ? (
          <p className="text-danger">
            {state.message}
            {formError?.referenceId === undefined ? null : (
              <>
                {" "}
                Reference <code className="font-mono text-xs text-foreground">{formError.referenceId}</code>.
              </>
            )}
          </p>
        ) : null}
      </div>
    </form>
  );
}
