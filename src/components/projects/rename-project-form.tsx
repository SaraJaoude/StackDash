"use client";

import { useActionState, useId, useState, type KeyboardEvent } from "react";

import { renameProject, type ProjectActionResult } from "@/app/w/[workspace]/projects/actions";
import { GuardedButton } from "@/components/guarded-button";
import { FormErrorSummary, ProjectNameField, failureOf } from "@/components/projects/project-form-parts";
import { buttonClass } from "@/components/ui/button";

/**
 * Inline rename form, opened from a project's Rename button. Escape or Cancel closes it without
 * saving; `onClose` gets the new name after a save, or null when cancelled.
 */
export function RenameProjectForm({
  workspaceSlug,
  project,
  onClose,
}: {
  workspaceSlug: string;
  project: { id: string; name: string };
  onClose: (newName: string | null) => void;
}) {
  const [name, setName] = useState(project.name);
  const [state, formAction, pending] = useActionState<ProjectActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await renameProject(previous, formData);
      if (result.ok) {
        const submitted = formData.get("name");
        onClose(typeof submitted === "string" ? submitted.trim() : project.name);
      }
      return result;
    },
    null,
  );
  const inputId = useId();
  const failure = failureOf(state);

  function onKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !pending) {
      event.preventDefault();
      onClose(null);
    }
  }

  return (
    <form action={formAction} onKeyDown={onKeyDown} className="w-full">
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <input type="hidden" name="projectId" value={project.id} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <ProjectNameField
          id={inputId}
          label={`New name for ${project.name}`}
          hint="Up to 80 characters, unique in this workspace. Press Escape to cancel."
          value={name}
          onChange={setName}
          error={failure?.fieldErrors?.name}
          autoFocus
        />
        <div className="flex shrink-0 gap-2">
          <GuardedButton
            type="submit"
            unavailable={pending}
            className={buttonClass("primary")}
          >
            {pending ? "Saving" : "Save name"}
          </GuardedButton>
          <GuardedButton
            type="button"
            unavailable={pending}
            onClick={() => onClose(null)}
            className={buttonClass("secondary")}
          >
            Cancel
          </GuardedButton>
        </div>
      </div>
      <FormErrorSummary failure={failure} fieldId={inputId} />
    </form>
  );
}
