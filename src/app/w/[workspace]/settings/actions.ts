"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { logError } from "@/lib/log/logger";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAction } from "@/lib/workspaces/access";
import { actionDeniedReason, ForbiddenError } from "@/lib/workspaces/permissions";

export type RenameWorkspaceResult =
  | { ok: true }
  | { ok: false; fieldErrors?: Record<string, string>; message: string; referenceId?: string };

// Mirrors the database check `char_length(btrim(name)) between 1 and 80`. Code points, not
// UTF-16 units, so a name with emoji is measured the way Postgres measures it.
const WORKSPACE_NAME_MAX = 80;

const renameSchema = z
  .object({
    workspace: z.string().min(1),
    name: z
      .string()
      .trim()
      .min(1, "Enter a workspace name.")
      .refine((name) => [...name].length <= WORKSPACE_NAME_MAX, {
        message: `Use ${WORKSPACE_NAME_MAX} characters or fewer.`,
      }),
  })
  .strict();

/**
 * Renames a workspace. Only the name changes: the slug in every URL is immutable, so links keep
 * working. Authorized here with the role matrix, and again by row level security on the update.
 */
export async function renameWorkspace(
  _previous: RenameWorkspaceResult | null,
  formData: FormData,
): Promise<RenameWorkspaceResult> {
  // Picked field by field so framework-added form entries never trip the strict schema.
  const parsed = renameSchema.safeParse({
    workspace: formData.get("workspace"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    const nameIssue = parsed.error.issues.find((issue) => issue.path[0] === "name");
    if (nameIssue === undefined) {
      return { ok: false, message: "This form is out of date. Reload the page and try again." };
    }
    return {
      ok: false,
      fieldErrors: { name: nameIssue.message },
      message: `The name was not saved. ${nameIssue.message}`,
    };
  }

  try {
    const { workspace } = await requireWorkspaceAction(parsed.data.workspace, "rename_workspace");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("workspaces")
      .update({ name: parsed.data.name })
      .eq("id", workspace.id)
      .select("id");
    if (error) throw new Error("Workspace rename failed", { cause: error });
    // No row back means row level security refused it: the role changed after the check above.
    if (data.length === 0) throw new ForbiddenError("admin", actionDeniedReason("rename_workspace"));
  } catch (error) {
    // notFound() and redirect() signal through throws; let Next.js handle them.
    unstable_rethrow(error);
    if (error instanceof ForbiddenError) return { ok: false, message: error.message };
    const referenceId = logError("workspaces.rename_failed", error);
    return {
      ok: false,
      message: "The name could not be saved. Try again in a moment.",
      referenceId,
    };
  }

  // The header switcher shows the name too, so refresh the whole route, not just this form.
  refresh();
  return { ok: true };
}
