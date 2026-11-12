"use client";

import { useActionState, useId, useState } from "react";

import { createProject, type ProjectActionResult } from "@/app/w/[workspace]/projects/actions";
import { GuardedButton } from "@/components/guarded-button";
import { FormErrorSummary, ProjectNameField, failureOf } from "@/components/projects/project-form-parts";
import { buttonClass } from "@/components/ui/button";

/**
 * Create form for owners and admins. On the empty state it takes focus as the first action.
 * Success is announced by the page's status region through `onCreated`, because creating the
 * first project replaces the empty state, and this form with it.
 */
export function CreateProjectForm({
  workspaceSlug,
  onCreated,
  autoFocus = false,
}: {
  workspaceSlug: string;
  onCreated: (name: string) => void;
  autoFocus?: boolean;
}) {
  const [name, setName] = useState("");
  const [state, formAction, pending] = useActionState<ProjectActionResult | null, FormData>(
    async (previous, formData) => {
      const result = await createProject(previous, formData);
      if (result.ok) {
        const submitted = formData.get("name");
        onCreated(typeof submitted === "string" ? submitted.trim() : "");
        setName("");
      }
      return result;
    },
    null,
  );
  const inputId = useId();
  const failure = failureOf(state);

  return (
    <form action={formAction} className="text-left">
      <input type="hidden" name="workspace" value={workspaceSlug} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <ProjectNameField
          id={inputId}
          label="Project name"
          hint="Up to 80 characters, unique in this workspace. For example, the name of a product."
          value={name}
          onChange={setName}
          error={failure?.fieldErrors?.name}
          autoFocus={autoFocus}
        />
        <GuardedButton
          type="submit"
          unavailable={pending}
          className={`shrink-0 ${buttonClass("primary")}`}
        >
          {pending ? "Creating" : "Create project"}
        </GuardedButton>
      </div>
      <FormErrorSummary failure={failure} fieldId={inputId} />
    </form>
  );
}
