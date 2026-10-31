"use server";

import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { createOAuthContext, getAdapter, loadOAuthClient } from "@/lib/adapters/registry";
import type { ProviderId } from "@/lib/adapters/types";
import { deleteCredential, loadCredential } from "@/lib/data/credentials";
import { enqueueSync, MANUAL_SYNC_COOLDOWN_SECONDS } from "@/lib/jobs/queue";
import { logError } from "@/lib/log/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAction, workspacePath, type WorkspaceAccess } from "@/lib/workspaces/access";
import { actionDeniedReason, ForbiddenError } from "@/lib/workspaces/permissions";

/*
 * Connection management (#40). Every action authorizes with the role matrix, then re-reads the
 * row it was given inside the caller's workspace: an id that does not exist and an id from another
 * workspace get the same answer. No credential, token, or provider error text is ever returned.
 */

export type ConnectionActionResult =
  | { ok: true; message?: string }
  | { ok: false; fieldErrors?: Record<string, string>; message: string; referenceId?: string };

const NOT_FOUND_MESSAGE = "That item no longer exists in this workspace. Reload the page to see what is current.";
const STALE_FORM_MESSAGE = "This form is out of date. Reload the page and try again.";

// Fixture ids skip the RFC version bits, so `guid` rather than `uuid`.
const Id = z.guid();

// Where to remove DevMacro's access by hand when the provider has no revoke endpoint or it failed.
// Providers not listed get the generic account settings wording.
const MANUAL_REVOKE_STEPS: Partial<Record<ProviderId, string>> = {
  github:
    "Uninstall the DevMacro GitHub App at github.com/settings/installations, or for an organization in the organization's settings under GitHub Apps.",
};

function manualRevokeStep(provider: ProviderId, providerName: string): string {
  return MANUAL_REVOKE_STEPS[provider] ?? `Remove DevMacro's access in your ${providerName} account settings.`;
}

const accountProjectSchema = z
  .object({ workspace: z.string().min(1), accountId: Id, projectId: z.union([Id, z.literal("")]) })
  .strict();
const accountIncludedSchema = z
  .object({ workspace: z.string().min(1), accountId: Id, included: z.enum(["true", "false"]) })
  .strict();
const connectionSchema = z.object({ workspace: z.string().min(1), connectionId: Id }).strict();

/** Expected failures become messages; anything else is logged and answered with a reference. */
function failure(event: string, error: unknown, message: string): ConnectionActionResult {
  unstable_rethrow(error);
  if (error instanceof ForbiddenError) return { ok: false, message: actionDeniedReason("manage_connections") };
  return { ok: false, message, referenceId: logError(event, error) };
}

async function findAccount(access: WorkspaceAccess, accountId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("external_accounts")
    .select("id")
    .eq("workspace_id", access.workspace.id)
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw new Error("External account lookup failed", { cause: error });
  return data;
}

async function findConnection(access: WorkspaceAccess, connectionId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("connections")
    .select("id, provider, status, last_sync_requested_at")
    .eq("workspace_id", access.workspace.id)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new Error("Connection lookup failed", { cause: error });
  return data;
}

export async function assignAccountProject(
  _previous: ConnectionActionResult | null,
  formData: FormData,
): Promise<ConnectionActionResult> {
  const parsed = accountProjectSchema.safeParse({
    workspace: formData.get("workspace"),
    accountId: formData.get("accountId"),
    projectId: formData.get("projectId"),
  });
  if (!parsed.success) return { ok: false, message: STALE_FORM_MESSAGE };
  const { workspace, accountId, projectId } = parsed.data;

  try {
    const access = await requireWorkspaceAction(workspace, "manage_connections");
    const supabase = await createClient();
    const [account, project] = await Promise.all([
      findAccount(access, accountId),
      projectId === ""
        ? Promise.resolve({ id: "" })
        : supabase
            .from("projects")
            .select("id")
            .eq("workspace_id", access.workspace.id)
            .eq("id", projectId)
            .maybeSingle()
            .then(({ data, error }) => {
              if (error) throw new Error("Project lookup failed", { cause: error });
              return data;
            }),
    ]);
    if (account === null) return { ok: false, message: NOT_FOUND_MESSAGE };
    if (project === null) {
      return {
        ok: false,
        fieldErrors: { projectId: "That project no longer exists. Choose another one." },
        message: "The project was not saved. That project no longer exists. Choose another one.",
      };
    }
    const { data, error } = await supabase
      .from("external_accounts")
      .update({ project_id: projectId === "" ? null : projectId })
      .eq("workspace_id", access.workspace.id)
      .eq("id", accountId)
      .select("id");
    if (error) throw new Error("Project assignment failed", { cause: error });
    if (data.length === 0) throw new ForbiddenError("admin", actionDeniedReason("manage_connections"));
  } catch (error) {
    return failure("connections.assign_project_failed", error, "The project could not be saved. Try again in a moment.");
  }
  refresh();
  return { ok: true, message: projectId === "" ? "Project removed." : "Project saved." };
}

export async function setAccountIncluded(
  _previous: ConnectionActionResult | null,
  formData: FormData,
): Promise<ConnectionActionResult> {
  const parsed = accountIncludedSchema.safeParse({
    workspace: formData.get("workspace"),
    accountId: formData.get("accountId"),
    included: formData.get("included"),
  });
  if (!parsed.success) return { ok: false, message: STALE_FORM_MESSAGE };
  const { workspace, accountId } = parsed.data;
  const included = parsed.data.included === "true";

  try {
    const access = await requireWorkspaceAction(workspace, "manage_connections");
    if ((await findAccount(access, accountId)) === null) return { ok: false, message: NOT_FOUND_MESSAGE };
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("external_accounts")
      .update({ included })
      .eq("workspace_id", access.workspace.id)
      .eq("id", accountId)
      .select("id");
    if (error) throw new Error("Include toggle failed", { cause: error });
    if (data.length === 0) throw new ForbiddenError("admin", actionDeniedReason("manage_connections"));
  } catch (error) {
    return failure("connections.set_included_failed", error, "The change could not be saved. Try again in a moment.");
  }
  refresh();
  return {
    ok: true,
    message: included ? "Account included. It syncs from the next run." : "Account excluded. It no longer syncs.",
  };
}

function formatWait(seconds: number): string {
  const minutes = Math.ceil(seconds / 60);
  return minutes <= 1 ? "about a minute" : `${minutes} minutes`;
}

export async function syncNow(
  _previous: ConnectionActionResult | null,
  formData: FormData,
): Promise<ConnectionActionResult> {
  const parsed = connectionSchema.safeParse({
    workspace: formData.get("workspace"),
    connectionId: formData.get("connectionId"),
  });
  if (!parsed.success) return { ok: false, message: STALE_FORM_MESSAGE };

  try {
    const access = await requireWorkspaceAction(parsed.data.workspace, "manage_connections");
    const connection = await findConnection(access, parsed.data.connectionId);
    if (connection === null) return { ok: false, message: NOT_FOUND_MESSAGE };
    if (connection.status === "revoked") {
      return { ok: false, message: "This connection is disconnected. Reconnect it before syncing." };
    }
    const { queued } = await enqueueSync({
      workspaceId: access.workspace.id,
      connectionId: connection.id,
      reason: "manual",
    });
    if (!queued) {
      // Re-read after the attempt: the queue records the request time when it accepts one.
      const latest = await findConnection(access, connection.id);
      const requestedAt = latest?.last_sync_requested_at ?? null;
      const remaining =
        requestedAt === null
          ? 0
          : Math.ceil((new Date(requestedAt).getTime() + MANUAL_SYNC_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000);
      return {
        ok: false,
        message:
          remaining > 0
            ? `A sync was requested recently. Try again in ${formatWait(remaining)}.`
            : "A sync is already queued for this connection. It runs within a minute.",
      };
    }
  } catch (error) {
    return failure("connections.sync_now_failed", error, "The sync could not be queued. Try again in a moment.");
  }
  refresh();
  return { ok: true, message: "Sync queued. New numbers appear within a few minutes." };
}

/**
 * Revokes the grant at the provider where it supports that. Returns null on success, otherwise
 * the manual step the user still has to take. Never throws: a failed revoke must not stop the
 * local credential from being deleted.
 */
async function revokeAtProvider(workspaceId: string, connectionId: string, provider: ProviderId): Promise<string | null> {
  let providerName = "the provider";
  try {
    const adapter = getAdapter(provider);
    providerName = adapter.displayName;
    if (adapter.revoke === undefined) {
      return `${adapter.displayName} does not let apps revoke their own access. ${manualRevokeStep(provider, providerName)}`;
    }
    const credential = await loadCredential({ workspaceId, connectionId });
    if (credential === null) return null;
    const client = loadOAuthClient(adapter);
    if (client === null) {
      return `${adapter.displayName} is no longer set up on this instance, so DevMacro could not revoke access. ${manualRevokeStep(provider, providerName)}`;
    }
    await adapter.revoke(credential, createOAuthContext(client));
    return null;
  } catch (error) {
    const referenceId = logError("connections.revoke_failed", error, { provider });
    return `DevMacro could not revoke access at ${providerName} (reference ${referenceId}). ${manualRevokeStep(provider, providerName)}`;
  }
}

export async function disconnect(
  _previous: ConnectionActionResult | null,
  formData: FormData,
): Promise<ConnectionActionResult> {
  const parsed = connectionSchema.safeParse({
    workspace: formData.get("workspace"),
    connectionId: formData.get("connectionId"),
  });
  if (!parsed.success) return { ok: false, message: STALE_FORM_MESSAGE };

  let manualStep: string | null;
  try {
    const access = await requireWorkspaceAction(parsed.data.workspace, "manage_connections");
    const connection = await findConnection(access, parsed.data.connectionId);
    if (connection === null) return { ok: false, message: NOT_FOUND_MESSAGE };

    manualStep = await revokeAtProvider(access.workspace.id, connection.id, connection.provider);
    await deleteCredential(connection.id);
    // Status and schedule are server-written columns; the caller was authorized above.
    const { error } = await createAdminClient()
      .from("connections")
      .update({ status: "revoked", next_sync_at: null, updated_by: access.user.id })
      .eq("workspace_id", access.workspace.id)
      .eq("id", connection.id);
    if (error) throw new Error(`Disconnect status update failed (code ${error.code}).`);
  } catch (error) {
    return failure("connections.disconnect_failed", error, "The connection could not be disconnected. Try again in a moment.");
  }
  refresh();
  return {
    ok: true,
    message:
      manualStep === null
        ? "Disconnected. The credential is deleted and the history is kept."
        : `Disconnected. The credential is deleted and the history is kept. ${manualStep}`,
  };
}

export async function deleteConnection(
  _previous: ConnectionActionResult | null,
  formData: FormData,
): Promise<ConnectionActionResult> {
  const parsed = connectionSchema.safeParse({
    workspace: formData.get("workspace"),
    connectionId: formData.get("connectionId"),
  });
  if (!parsed.success) return { ok: false, message: STALE_FORM_MESSAGE };

  let connectionsPath: string;
  let provider: ProviderId;
  let manualStep: string | null = null;
  try {
    const access = await requireWorkspaceAction(parsed.data.workspace, "manage_connections");
    const connection = await findConnection(access, parsed.data.connectionId);
    if (connection === null) return { ok: false, message: NOT_FOUND_MESSAGE };
    provider = connection.provider;
    if (connection.status !== "revoked") {
      manualStep = await revokeAtProvider(access.workspace.id, connection.id, connection.provider);
    }
    // The cascade removes the credential, accounts, snapshots, events, and jobs with it.
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("connections")
      .delete()
      .eq("workspace_id", access.workspace.id)
      .eq("id", connection.id)
      .select("id");
    if (error) throw new Error("Connection delete failed", { cause: error });
    if (data.length === 0) throw new ForbiddenError("admin", actionDeniedReason("manage_connections"));
    connectionsPath = workspacePath(access.workspace.slug, "connections");
  } catch (error) {
    return failure("connections.delete_failed", error, "The connection could not be deleted. Try again in a moment.");
  }
  const query = new URLSearchParams({ deleted: provider });
  if (manualStep !== null) query.set("revoke", "manual");
  redirect(`${connectionsPath}?${query.toString()}`);
}
