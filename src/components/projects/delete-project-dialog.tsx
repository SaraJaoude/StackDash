"use client";

import { useActionState, useId, useRef, useState } from "react";

import { deleteProject, type ProjectActionResult } from "@/app/w/[workspace]/projects/actions";
import { GuardedButton } from "@/components/guarded-button";
import { failureOf } from "@/components/projects/project-form-parts";
import { deletionConsequences, type ProjectDeletionImpact } from "@/components/projects/project-rules";
import { buttonClass } from "@/components/ui/button";
import { DialogError } from "@/components/ui/dialog-error";

type DeletableProject = { id: string; name: string } & ProjectDeletionImpact;

/**
 * Delete button plus a native modal `<dialog>` that explains the consequences before confirming.
 * Escape closes it (native behavior) and focus goes back to the button. After a delete the button
 * is gone with its row, so `onDeleted` decides where focus goes instead.
 */
export function DeleteProjectDialog({
  workspaceSlug,
  project,
  onDeleted,
}: {
  workspaceSlug: string;
  project: DeletableProject;
  onDeleted: (name: string) => void;
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
        className={buttonClass("danger-quiet", "sm")}
      >
        Delete<span className="sr-only"> {project.name}</span>
      </button>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        onClose={() => {
          if (!deletedRef.current) triggerRef.current?.focus();
        }}
        className="m-auto w-[min(32rem,calc(100%-2rem))] rounded-xl border border-line bg-panel p-6 text-foreground backdrop:bg-black/60"
      >
        {/* Mounted on first open only, so its autofocus never fires on page load. */}
        {openCount === 0 ? null : (
          <DeleteProjectConfirmation
            key={openCount}
            workspaceSlug={workspaceSlug}
            project={project}
            titleId={titleId}
            descriptionId={descriptionId}
            onCancel={() => dialogRef.current?.close()}
            onDeleted={() => {
              deletedRef.current = true;
              dialogRef.current?.close();
              onDeleted(project.name);
            }}
          />
        )}
      </dialog>
    </>
  );
}

function DeleteProjectConfirmation({
  workspaceSlug,
  project,
  titleId,
  descriptionId,
  onCancel,
  onDeleted,
}: {
  workspaceSlug: string;
  project: DeletableProject;
  titleId: string;
  descriptionId: string;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const [state, formAction, pending] = useActionState<ProjectActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await deleteProject(previous, formData);
      if (result.ok) onDeleted();
      return result;
    },
    null,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="projectId" value={project.id} />
      <h2 id={titleId} className="break-words text-lg font-semibold tracking-tight">
        Delete {project.name}?
      </h2>
      <div id={descriptionId} className="mt-3 text-sm leading-6">
        <p className="text-muted">This cannot be undone. Before you confirm, this is what changes:</p>
        <ul className="mt-3 list-disc space-y-1 pl-5">
          {deletionConsequences(project).map((consequence) => (
            <li key={consequence}>{consequence}</li>
          ))}
        </ul>
      </div>
      <DialogError failure={failureOf(state)} />
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <GuardedButton
          type="button"
          // Cancel first and focused, so Enter right after opening never deletes.
          autoFocus
          unavailable={pending}
          onClick={onCancel}
          className={buttonClass("secondary")}
        >
          Cancel
        </GuardedButton>
        <GuardedButton
          type="submit"
          unavailable={pending}
          className={buttonClass("danger")}
        >
          {pending ? "Deleting" : "Delete project"}
        </GuardedButton>
      </div>
    </form>
  );
}
