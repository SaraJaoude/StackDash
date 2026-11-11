"use client";

import { useActionState, useId, useRef, useState } from "react";

import { GuardedButton } from "@/components/guarded-button";
import { HANDLE_MAX, HANDLE_MIN, normalizeHandle } from "@/lib/workspaces/handles";

import { removeWorkspaceHandle, setWorkspaceHandle, type WorkspaceHandleResult } from "./actions";

/**
 * Claims, changes, or removes the workspace's handle, for owners and admins. Controlled, so a
 * refused handle stays in the field to be corrected; the rules are checked by the server, not by
 * `pattern` or `maxLength`, so the field error explains the rule. One status region for both
 * forms: the remove button unmounts once the handle is gone, and its message must outlive it.
 */
export function WorkspaceHandleForm({ workspaceSlug, currentHandle }: { workspaceSlug: string; currentHandle: string | null }) {
  const [handle, setHandle] = useState(currentHandle ?? "");
  const [last, setLast] = useState<WorkspaceHandleResult | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();

  const [, saveAction, saving] = useActionState<WorkspaceHandleResult | null, FormData>(async (previous, formData) => {
    const result = await setWorkspaceHandle(previous, formData);
    setLast(result);
    if (!result.ok) {
      if (result.fieldErrors?.handle !== undefined) inputRef.current?.focus();
      return result;
    }
    // Show the handle as stored: trimmed and lowercased.
    const value = formData.get("handle");
    if (typeof value === "string") setHandle(normalizeHandle(value));
    return result;
  }, null);
  const [, removeAction, removing] = useActionState<WorkspaceHandleResult | null, FormData>(async (previous, formData) => {
    const result = await removeWorkspaceHandle(previous, formData);
    setLast(result);
    if (result.ok) {
      setHandle("");
      // The remove button is about to unmount; keep focus in the section.
      inputRef.current?.focus();
    }
    return result;
  }, null);

  const pending = saving || removing;
  const failure = last !== null && !last.ok ? last : undefined;
  const fieldError = failure?.fieldErrors?.handle;

  return (
    <div className="px-6 py-5">
      <p className="text-sm">
        {currentHandle === null ? "No handle yet. " : null}
        Public project pages open at{" "}
        <span className="font-mono break-all">/@{currentHandle ?? workspaceSlug}/</span> followed by the page address.
        {currentHandle === null ? null : " Addresses with the workspace ID lead there too."}
      </p>
      <form action={saveAction} noValidate className="mt-4">
        <input type="hidden" name="workspace" value={workspaceSlug} />
        <label htmlFor={inputId} className="block text-sm font-medium">
          Handle
        </label>
        <p id={hintId} className="mt-1 text-sm text-muted">
          {HANDLE_MIN} to {HANDLE_MAX} characters: lowercase letters, numbers, and single hyphens between words. Changing
          or removing it frees the old handle for any workspace, and links that use it stop working.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="min-w-0 flex-1">
            <input
              ref={inputRef}
              id={inputId}
              name="handle"
              type="text"
              autoComplete="off"
              spellCheck={false}
              value={handle}
              onChange={(event) => setHandle(event.target.value)}
              aria-invalid={fieldError === undefined ? undefined : true}
              aria-describedby={fieldError === undefined ? hintId : `${hintId} ${errorId}`}
              className={`block min-h-10 w-full rounded-md border bg-panel-raised px-3 py-2 font-mono text-sm text-foreground ${
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
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 aria-disabled:opacity-60"
          >
            {saving ? "Saving" : "Save handle"}
          </GuardedButton>
        </div>
      </form>
      {currentHandle === null ? null : (
        <form action={removeAction} className="mt-3">
          <input type="hidden" name="workspace" value={workspaceSlug} />
          <GuardedButton
            type="submit"
            unavailable={pending}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-line-strong px-4 py-2 text-sm text-muted transition-colors hover:text-foreground aria-disabled:opacity-60"
          >
            {removing ? "Removing" : "Remove handle"}
          </GuardedButton>
        </form>
      )}

      {/* Always mounted so screen readers announce changes to it. */}
      <div role="status" aria-live="polite" className="mt-3 text-sm">
        {pending || last === null ? null : last.ok ? (
          <p className="text-success">{last.message}</p>
        ) : (
          <p className="text-danger">
            {last.message}
            {failure?.referenceId === undefined ? null : (
              <>
                {" "}
                Reference <code className="font-mono text-xs text-foreground">{failure.referenceId}</code>.
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
