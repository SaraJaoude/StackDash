"use client";

import { useActionState } from "react";

import { deleteProject, type ProjectActionResult } from "@/app/w/[workspace]/projects/actions";
import { GuardedButton } from "@/components/guarded-button";
import { failureOf } from "@/components/projects/project-form-parts";
import { deletionConsequences, type ProjectDeletionImpact } from "@/components/projects/project-rules";
import { buttonClass } from "@/components/ui/button";
import { DialogError } from "@/components/ui/dialog-error";
import { DialogActions, DialogCloseButton, ModalDialog, useModalDialog } from "@/components/ui/modal-dialog";

type DeletableProject = { id: string; name: string } & ProjectDeletionImpact;

/**
 * Delete button plus a `ModalDialog` that explains the consequences before confirming. Escape or
 * Cancel returns focus to the button. After a delete the button is gone with its row, so
 * `onDeleted` decides where focus goes instead.
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
  const dialog = useModalDialog();

  return (
    <>
      <button
        type="button"
        onClick={(event) => dialog.open(event.currentTarget)}
        className={buttonClass("danger-quiet", "sm")}
      >
        Delete<span className="sr-only"> {project.name}</span>
      </button>
      <ModalDialog
        dialog={dialog}
        title={`Delete ${project.name}?`}
        description={
          <>
            <p>This cannot be undone. Before you confirm, this is what changes:</p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-foreground">
              {deletionConsequences(project).map((consequence) => (
                <li key={consequence}>{consequence}</li>
              ))}
            </ul>
          </>
        }
      >
        <DeleteProjectConfirmation
          workspaceSlug={workspaceSlug}
          project={project}
          onDeleted={() => {
            dialog.close("completed");
            onDeleted(project.name);
          }}
        />
      </ModalDialog>
    </>
  );
}

function DeleteProjectConfirmation({
  workspaceSlug,
  project,
  onDeleted,
}: {
  workspaceSlug: string;
  project: DeletableProject;
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
      <DialogError failure={failureOf(state)} />
      <DialogActions>
        <DialogCloseButton unavailable={pending} />
        <GuardedButton type="submit" unavailable={pending} className={buttonClass("danger")}>
          {pending ? "Deleting" : "Delete project"}
        </GuardedButton>
      </DialogActions>
    </form>
  );
}
