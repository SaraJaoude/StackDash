"use server";

import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { generateApiKey } from "@/lib/api/keys";
import { API_KEY_SCOPES } from "@/lib/api/scopes";
import { MAX_ACTIVE_API_KEYS } from "@/lib/data/api-keys";
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

export type ApiKeyActionFailure = {
  ok: false;
  fieldErrors?: Partial<Record<"name" | "scopes", string>>;
  message: string;
  referenceId?: string;
};

/** A created key comes back once, in `key`, for the page to show. It is never stored or logged. */
export type CreateApiKeyResult = { ok: true; name: string; key: string } | ApiKeyActionFailure;
export type RevokeApiKeyResult = { ok: true; name: string } | ApiKeyActionFailure;

// Mirrors the database check on api_keys.name, measured in code points as Postgres does.
const API_KEY_NAME_MAX = 80;
const OUT_OF_DATE = "This form is out of date. Reload the page and try again.";
const INSUFFICIENT_PRIVILEGE = "42501";
// Raised by api_keys_enforce_limit when the workspace already holds MAX_ACTIVE_API_KEYS keys.
const PROGRAM_LIMIT_EXCEEDED = "54000";

const createApiKeySchema = z
  .object({
    workspace: z.string().min(1),
    name: z
      .string()
      .trim()
      .min(1, "Enter a name for the key, such as the script or tool that will use it.")
      .refine((name) => [...name].length <= API_KEY_NAME_MAX, {
        message: `Use ${API_KEY_NAME_MAX} characters or fewer.`,
      }),
    scopes: z
      .array(z.enum(API_KEY_SCOPES))
      .min(1, "Choose at least one thing the key may read.")
      .transform((scopes) => [...new Set(scopes)]),
  })
  .strict();

// `guid`, not `uuid`: fixtures use hand-written ids that skip the RFC version bits.
const revokeApiKeySchema = z.object({ workspace: z.string().min(1), keyId: z.guid() }).strict();

function unexpectedKeyFailure(error: unknown, event: string, message: string): ApiKeyActionFailure {
  // notFound() and redirect() signal through throws; let Next.js handle them.
  unstable_rethrow(error);
  if (error instanceof ForbiddenError) return { ok: false, message: error.message };
  const referenceId = logError(event, error);
  return { ok: false, message, referenceId };
}

/**
 * Creates a read-only API key for the workspace (#162). Owners and admins only, checked here with
 * the role matrix and again by row level security on the insert. Only the key's SHA-256 and a
 * display prefix are stored; the key itself goes back to the browser once and nowhere else.
 */
export async function createApiKey(
  _previous: CreateApiKeyResult | null,
  formData: FormData,
): Promise<CreateApiKeyResult> {
  // Picked field by field so framework-added form entries never trip the strict schema.
  const parsed = createApiKeySchema.safeParse({
    workspace: formData.get("workspace"),
    name: formData.get("name"),
    scopes: formData.getAll("scope"),
  });
  if (!parsed.success) {
    const fieldErrors: Partial<Record<"name" | "scopes", string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      if ((field === "name" || field === "scopes") && fieldErrors[field] === undefined) fieldErrors[field] = issue.message;
    }
    const first = fieldErrors.name ?? fieldErrors.scopes;
    if (first === undefined) return { ok: false, message: OUT_OF_DATE };
    return { ok: false, fieldErrors, message: `The key was not created. ${first}` };
  }

  let generated: ReturnType<typeof generateApiKey>;
  try {
    const { workspace } = await requireWorkspaceAction(parsed.data.workspace, "manage_api_keys");
    generated = generateApiKey();
    const supabase = await createClient();
    const { error } = await supabase.from("api_keys").insert({
      workspace_id: workspace.id,
      name: parsed.data.name,
      token_hash: generated.tokenHash,
      token_prefix: generated.tokenPrefix,
      scopes: parsed.data.scopes,
    });
    // The database counts and refuses it, so two admins creating keys at once cannot both pass.
    if (error?.code === PROGRAM_LIMIT_EXCEEDED) {
      return {
        ok: false,
        message: `This workspace already has ${MAX_ACTIVE_API_KEYS} keys that are not revoked. Revoke one you no longer use, then create the new one.`,
      };
    }
    // Row level security refused it: the role changed after the check above.
    if (error?.code === INSUFFICIENT_PRIVILEGE) {
      throw new ForbiddenError("admin", actionDeniedReason("manage_api_keys"));
    }
    if (error) throw new Error("API key create failed", { cause: error });
  } catch (error) {
    return unexpectedKeyFailure(error, "api_keys.create_failed", "The key could not be created. Try again in a moment.");
  }

  refresh();
  return { ok: true, name: parsed.data.name, key: generated.key };
}

/**
 * Revokes a key. Anything using it gets 401 from the next request on; the database stamps when and
 * by whom, and a revoked key can never work again.
 */
export async function revokeApiKey(
  _previous: RevokeApiKeyResult | null,
  formData: FormData,
): Promise<RevokeApiKeyResult> {
  const parsed = revokeApiKeySchema.safeParse({
    workspace: formData.get("workspace"),
    keyId: formData.get("keyId"),
  });
  if (!parsed.success) return { ok: false, message: OUT_OF_DATE };

  let name: string;
  try {
    const { workspace } = await requireWorkspaceAction(parsed.data.workspace, "manage_api_keys");
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("api_keys")
      // The database replaces this with its own clock (api_keys_guard_revoke).
      .update({ revoked_at: new Date().toISOString() })
      .eq("workspace_id", workspace.id)
      .eq("id", parsed.data.keyId)
      .is("revoked_at", null)
      .select("name");
    if (error) throw new Error("API key revoke failed", { cause: error });
    const revoked = data[0];
    // Same answer for a key revoked meanwhile and one from another workspace.
    if (revoked === undefined) {
      return { ok: false, message: "This key is already revoked or no longer exists. Reload the page to see the current list." };
    }
    name = revoked.name;
  } catch (error) {
    return unexpectedKeyFailure(error, "api_keys.revoke_failed", "The key could not be revoked. Try again in a moment.");
  }

  refresh();
  return { ok: true, name };
}
