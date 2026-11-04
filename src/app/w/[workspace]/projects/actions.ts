"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { DUPLICATE_PROJECT_NAME, projectNameSchema } from "@/components/projects/project-rules";
import { logError } from "@/lib/log/logger";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAction } from "@/lib/workspaces/access";
import { actionDeniedReason, ForbiddenError } from "@/lib/workspaces/permissions";

export type ProjectActionResult =
  | { ok: true }
  | { ok: false; fieldErrors?: Record<string, string>; message: string; referenceId?: string };

// `guid`, not `uuid`: fixtures use hand-written ids that skip the RFC version bits.
const projectId = z.guid();

const createSchema = z.object({ workspace: z.string().min(1), name: projectNameSchema }).strict();
const renameSchema = z
  .object({ workspace: z.string().min(1), projectId, name: projectNameSchema })
  .strict();
const deleteSchema = z.object({ workspace: z.string().min(1), projectId }).strict();

const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";
// Same answer for a project that was deleted meanwhile and one from another workspace.
const PROJECT_GONE = "This project no longer exists. Reload the page to see the current list.";
const UNIQUE_VIOLATION = "23505";
const INSUFFICIENT_PRIVILEGE = "42501";

type ParseFailure = Extract<ProjectActionResult, { ok: false }>;

function nameFailure(error: z.ZodError, verb: string): ParseFailure {
  const nameIssue = error.issues.find((issue) => issue.path[0] === "name");
  if (nameIssue === undefined) return { ok: false, message: OUT_OF_DATE };
  return {
    ok: false,
    fieldErrors: { name: nameIssue.message },
    message: `The project was not ${verb}. ${nameIssue.message}`,
  };
}

function duplicateName(verb: string): ParseFailure {
  return {
    ok: false,
    fieldErrors: { name: DUPLICATE_PROJECT_NAME },
    message: `The project was not ${verb}. ${DUPLICATE_PROJECT_NAME}`,
  };
}

/** Shared handling for anything thrown after validation. */
function unexpected(error: unknown, event: string, message: string): ParseFailure {
  // notFound() and redirect() signal through throws; let Next.js handle them.
  unstable_rethrow(error);
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  const referenceId = logError(event, error);
  return { ok: false, message, referenceId };
}

/** Creates a project in the workspace. Names are unique per workspace, ignoring case. */
export async function createProject(
  _previous: ProjectActionResult | null,
  formData: FormData,
): Promise<ProjectActionResult> {
  // Picked field by field so framework-added form entries never trip the strict schema.
  const parsed = createSchema.safeParse({ workspace: formData.get("workspace"), name: formData.get("name") });
  if (!parsed.success) return nameFailure(parsed.error, "created");

  try {
    const { workspace } = await requireWorkspaceAction(parsed.data.workspace, "manage_projects");
    const supabase = await createClient();
    const { error } = await supabase
      .from("projects")
      .insert({ workspace_id: workspace.id, name: parsed.data.name });
    if (error?.code === UNIQUE_VIOLATION) return duplicateName("created");
    // Row level security refused it: the role changed after the check above.
    if (error?.code === INSUFFICIENT_PRIVILEGE) {
      throw new ForbiddenError("admin", actionDeniedReason("manage_projects"));
    }
    if (error) throw new Error("Project create failed", { cause: error });
  } catch (error) {
    return unexpected(error, "projects.create_failed", "The project could not be created. Try again in a moment.");
  }

  refresh();
  return { ok: true };
}

/** Renames a project. The id is re-checked against the workspace by the update filter. */
export async function renameProject(
  _previous: ProjectActionResult | null,
  formData: FormData,
): Promise<ProjectActionResult> {
  const parsed = renameSchema.safeParse({
    workspace: formData.get("workspace"),
    projectId: formData.get("projectId"),
    name: formData.get("name"),
  });
  if (!parsed.success) return nameFailure(parsed.error, "renamed");

  try {
    const { workspace } = await requireWorkspaceAction(parsed.data.workspace, "manage_projects");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .update({ name: parsed.data.name })
      .eq("workspace_id", workspace.id)
      .eq("id", parsed.data.projectId)
      .select("id");
    if (error?.code === UNIQUE_VIOLATION) return duplicateName("renamed");
    if (error) throw new Error("Project rename failed", { cause: error });
    if (data.length === 0) return { ok: false, message: PROJECT_GONE };
  } catch (error) {
    return unexpected(error, "projects.rename_failed", "The project could not be renamed. Try again in a moment.");
  }

  refresh();
  return { ok: true };
}

/**
 * Deletes a project. The database unassigns its accounts (their history stays) and removes the
 * budgets and alert rules scoped to it, as the confirmation dialog explained.
 */
export async function deleteProject(
  _previous: ProjectActionResult | null,
  formData: FormData,
): Promise<ProjectActionResult> {
  const parsed = deleteSchema.safeParse({
    workspace: formData.get("workspace"),
    projectId: formData.get("projectId"),
  });
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };

  try {
    const { workspace } = await requireWorkspaceAction(parsed.data.workspace, "manage_projects");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("projects")
      .delete()
      .eq("workspace_id", workspace.id)
      .eq("id", parsed.data.projectId)
      .select("id");
    if (error) throw new Error("Project delete failed", { cause: error });
    if (data.length === 0) return { ok: false, message: PROJECT_GONE };
  } catch (error) {
    return unexpected(error, "projects.delete_failed", "The project could not be deleted. Try again in a moment.");
  }

  refresh();
  return { ok: true };
}
