"use client";

import { startTransition, useActionState, useId, useRef, useState, type ReactNode, type RefObject } from "react";

import { GuardedButton } from "@/components/guarded-button";
import { HANDLE_MAX, HANDLE_MIN, handleSchema } from "@/lib/workspaces/handles";

import { removeWorkspaceHandle, setWorkspaceHandle, type WorkspaceHandleResult } from "./actions";

const SECONDARY =
  "inline-flex min-h-10 items-center justify-center rounded-md border border-line-strong px-4 py-2 text-sm text-muted transition-colors hover:text-foreground aria-disabled:opacity-60";
const DANGER =
  "inline-flex min-h-10 items-center justify-center rounded-md bg-danger px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 aria-disabled:opacity-60";

/**
 * Claims, changes, or removes the workspace's handle, for owners and admins. Controlled, so a
 * refused handle stays in the field to be corrected; the rules are checked by the server, not by
 * `pattern` or `maxLength`, so the field error explains the rule.
 *
 * Changing or removing a handle frees the old one at once for any workspace and breaks every link
 * that uses it, so both ask first in a native modal `<dialog>`, as the app's other irreversible
 * actions do. A first claim needs no confirmation, and neither does a value the rules refuse: it
 * goes straight to the server, which explains the rule beside the field. One status region serves
 * both forms, because the remove button unmounts once the handle is gone.
 */
export function WorkspaceHandleForm({ workspaceSlug, currentHandle }: { workspaceSlug: string; currentHandle: string | null }) {
  const [handle, setHandle] = useState(currentHandle ?? "");
  const [last, setLast] = useState<WorkspaceHandleResult | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saveRef = useRef<HTMLButtonElement>(null);
  const removeRef = useRef<HTMLButtonElement>(null);
  const changeDialogRef = useRef<HTMLDialogElement>(null);
  const removeDialogRef = useRef<HTMLDialogElement>(null);
  // Set by the change dialog's confirm button, so the submit it starts is not intercepted again.
  const confirmedRef = useRef(false);
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
    const parsed = handleSchema.safeParse(formData.get("handle"));
    if (parsed.success) setHandle(parsed.data);
    return result;
  }, null);
  const [, removeAction, removing] = useActionState<WorkspaceHandleResult | null, FormData>(async (previous, formData) => {
    const result = await removeWorkspaceHandle(previous, formData);
    setLast(result);
    if (result.ok) {
      setHandle("");
      // The remove button is about to unmount; keep focus in the section.
      inputRef.current?.focus();
    } else {
      removeRef.current?.focus();
    }
    return result;
  }, null);

  const pending = saving || removing;
  const failure = last !== null && !last.ok ? last : undefined;
  const fieldError = failure?.fieldErrors?.handle;
  // The handle a save would store, when the rules accept it; null for a value the server refuses.
  const parsed = handleSchema.safeParse(handle);
  const nextHandle = parsed.success ? parsed.data : null;

  return (
    <div className="px-6 py-5">
      <p className="text-sm">
        {currentHandle === null ? "No handle yet. " : null}
        Public project pages open at{" "}
        <span className="font-mono break-words">/@{currentHandle ?? workspaceSlug}/</span> followed by the page address.
        {currentHandle === null ? null : " Addresses with the workspace ID lead there too."}
      </p>
      <form
        ref={formRef}
        action={saveAction}
        noValidate
        className="mt-4"
        onSubmit={(event) => {
          if (confirmedRef.current) {
            confirmedRef.current = false;
            return;
          }
          if (currentHandle !== null && nextHandle !== null && nextHandle !== currentHandle) {
            event.preventDefault();
            changeDialogRef.current?.showModal();
          }
        }}
      >
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
            ref={saveRef}
            type="submit"
            unavailable={pending}
            className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 aria-disabled:opacity-60"
          >
            {saving ? "Saving" : "Save handle"}
          </GuardedButton>
        </div>
      </form>
      {currentHandle === null ? null : (
        <>
          <GuardedButton
            ref={removeRef}
            type="button"
            unavailable={pending}
            onClick={() => removeDialogRef.current?.showModal()}
            className={`mt-3 ${SECONDARY}`}
          >
            {removing ? "Removing" : "Remove handle"}
          </GuardedButton>
          <ConfirmHandleDialog
            dialogRef={changeDialogRef}
            returnFocusRef={saveRef}
            title={`Change the handle to ${nextHandle ?? ""}?`}
            confirmLabel="Change handle"
            onConfirm={() => {
              confirmedRef.current = true;
              formRef.current?.requestSubmit();
            }}
          >
            <ReleaseWarning handle={currentHandle} />
            Public project pages will open at <span className="font-mono break-words">/@{nextHandle}/</span> instead.
          </ConfirmHandleDialog>
          <ConfirmHandleDialog
            dialogRef={removeDialogRef}
            returnFocusRef={removeRef}
            title={`Remove the handle ${currentHandle}?`}
            confirmLabel="Remove handle"
            onConfirm={() => {
              const formData = new FormData();
              formData.set("workspace", workspaceSlug);
              startTransition(() => removeAction(formData));
            }}
          >
            <ReleaseWarning handle={currentHandle} />
            Public project pages go back to the workspace ID address,{" "}
            <span className="font-mono break-words">/@{workspaceSlug}/</span>.
          </ConfirmHandleDialog>
        </>
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

function ReleaseWarning({ handle }: { handle: string }) {
  return (
    <>
      Links that use <span className="font-mono break-words">/@{handle}/</span> stop working at once, and any workspace can
      claim {handle}.{" "}
    </>
  );
}

/**
 * A native modal `<dialog>`: the browser traps focus and closes it on Escape. Cancel comes first
 * and takes focus, so Enter right after opening never confirms. Confirming closes the dialog and
 * hands the work to `onConfirm`, whose result the section's status region announces; cancelling
 * returns focus to the button that opened it.
 */
function ConfirmHandleDialog({
  dialogRef,
  returnFocusRef,
  title,
  confirmLabel,
  onConfirm,
  children,
}: {
  dialogRef: RefObject<HTMLDialogElement | null>;
  returnFocusRef: RefObject<HTMLButtonElement | null>;
  title: string;
  confirmLabel: string;
  onConfirm: () => void;
  children: ReactNode;
}) {
  const confirmingRef = useRef(false);
  const titleId = useId();
  const descriptionId = useId();
  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onClose={() => {
        if (confirmingRef.current) {
          confirmingRef.current = false;
          onConfirm();
        } else {
          returnFocusRef.current?.focus();
        }
      }}
      className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border border-line bg-panel p-6 text-foreground backdrop:bg-black/60"
    >
      <h2 id={titleId} className="break-words text-lg font-semibold tracking-tight">
        {title}
      </h2>
      <p id={descriptionId} className="mt-3 text-sm leading-6 text-muted">
        {children}
      </p>
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        {/* First in the dialog, so showModal() focuses it and Enter right after opening never confirms. */}
        <button type="button" onClick={() => dialogRef.current?.close()} className={SECONDARY}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => {
            confirmingRef.current = true;
            dialogRef.current?.close();
          }}
          className={DANGER}
        >
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
