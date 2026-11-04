"use client";

import { useActionState, useId, useState, type KeyboardEvent } from "react";

import { renameProject, type ProjectActionResult } from "@/app/w/[workspace]/projects/actions";
import { FormErrorSummary, ProjectNameField, failureOf } from "@/components/projects/project-form-parts";

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
          <button
            type="submit"
            disabled={pending}
            className="inline-flex min-h-10 items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:opacity-60"
          >
            {pending ? "Saving" : "Save name"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => onClose(null)}
            className="inline-flex min-h-10 items-center justify-center rounded-md border border-line-strong px-4 py-2 text-sm text-muted transition-colors hover:text-foreground disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
      <FormErrorSummary failure={failure} fieldId={inputId} />
    </form>
  );
}
