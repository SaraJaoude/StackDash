"use server";

import { refresh } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { isProviderSimulationEnabled } from "@/lib/adapters/simulated";
import type { ProviderId } from "@/lib/adapters/types";
import { disconnectConnection, manualRevokeMessage, revokeAtProvider } from "@/lib/connections/revoke";
import { CONNECTIONS_LIMIT } from "@/lib/data/dashboard";
import { addSampleData, SAMPLE_DATA_ADDED_PARAM, sampleDataRefusal } from "@/lib/demo/workspace";
import { enqueueSync, MANUAL_SYNC_COOLDOWN_SECONDS } from "@/lib/jobs/queue";
import { log, logError } from "@/lib/log/logger";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceAction, type WorkspaceAccess } from "@/lib/workspaces/access";
import { workspacePath } from "@/lib/workspaces/paths";
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

const accountProjectSchema = z
  .object({ workspace: z.string().min(1), accountId: Id, projectId: z.union([Id, z.literal("")]) })
  .strict();
const accountIncludedSchema = z
  .object({ workspace: z.string().min(1), accountId: Id, included: z.enum(["true", "false"]) })
  .strict();
const connectionSchema = z.object({ workspace: z.string().min(1), connectionId: Id }).strict();
const workspaceSchema = z.object({ workspace: z.string().min(1) }).strict();

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
    .select("id, provider, status")
    .eq("workspace_id", access.workspace.id)
    .eq("id", connectionId)
    .maybeSingle();
  if (error) throw new Error("Connection lookup failed", { cause: error });
  return data;
}

/** The given connections of the caller's workspace, in one read; an id from elsewhere is absent. */
async function findConnections(access: WorkspaceAccess, connectionIds: readonly string[]) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("connections")
    .select("id, status, last_sync_requested_at")
    .eq("workspace_id", access.workspace.id)
    .in("id", [...connectionIds])
    .limit(connectionIds.length);
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

// One connection from its page, or every stale one from the dashboard's notice (#267); never more
// than the dashboard lists.
const syncNowSchema = z
  .object({ workspace: z.string().min(1), connectionIds: z.array(Id).min(1).max(CONNECTIONS_LIMIT) })
  .strict();

export async function syncNow(
  _previous: ConnectionActionResult | null,
  formData: FormData,
): Promise<ConnectionActionResult> {
  const parsed = syncNowSchema.safeParse({
    workspace: formData.get("workspace"),
    connectionIds: formData.getAll("connectionId"),
  });
  if (!parsed.success) return { ok: false, message: STALE_FORM_MESSAGE };
  const connectionIds = [...new Set(parsed.data.connectionIds)];

  let queued: number;
  let failed: number;
  let requested: number;
  let referenceId: string | undefined;
  try {
    const access = await requireWorkspaceAction(parsed.data.workspace, "manage_connections");
    const connections = await findConnections(access, connectionIds);
    if (connections.length < connectionIds.length) return { ok: false, message: NOT_FOUND_MESSAGE };
    const syncable = connections.filter((connection) => connection.status !== "revoked");
    if (syncable.length === 0) {
      return {
        ok: false,
        message:
          connectionIds.length === 1
            ? "This connection is disconnected. Reconnect it before syncing."
            : "These connections are disconnected. Reconnect them before syncing.",
      };
    }
    // Settled, not all: one connection's failed request must not hide that the others were queued.
    const results = await Promise.allSettled(
      syncable.map((connection) => enqueueSync({ workspaceId: access.workspace.id, connectionId: connection.id, reason: "manual" })),
    );
    const rejected = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []));
    queued = results.filter((result) => result.status === "fulfilled" && result.value.queued).length;
    failed = rejected.length;
    requested = syncable.length;
    if (failed > 0) {
      referenceId = logError(
        "connections.sync_now_failed",
        new AggregateError(rejected, `${failed} of ${requested} manual syncs could not be queued`),
      );
    }
    if (queued === 0 && failed > 0) {
      return { ok: false, message: "The sync could not be queued. Try again in a moment.", ...(referenceId === undefined ? {} : { referenceId }) };
    }
    if (queued === 0) {
      // Re-read after the attempt: the queue records the request time when it accepts one. The
      // newest request is the one to wait out.
      const latest = await findConnections(access, syncable.map((connection) => connection.id));
      const requestedAt = latest.flatMap((connection) =>
        connection.last_sync_requested_at === null ? [] : [Date.parse(connection.last_sync_requested_at)],
      );
      const remaining =
        requestedAt.length === 0 ? 0 : Math.ceil((Math.max(...requestedAt) + MANUAL_SYNC_COOLDOWN_SECONDS * 1000 - Date.now()) / 1000);
      return {
        ok: false,
        message:
          remaining > 0
            ? `A sync was requested recently. Try again in ${formatWait(remaining)}.`
            : `A sync is already queued for ${requested === 1 ? "this connection" : "these connections"}. It runs within a minute.`,
      };
    }
  } catch (error) {
    return failure("connections.sync_now_failed", error, "The sync could not be queued. Try again in a moment.");
  }
  refresh();
  if (requested === 1) return { ok: true, message: "Sync queued. New numbers appear within a few minutes." };
  const waiting = requested - queued - failed;
  const parts = [queued === requested ? `Sync queued for ${requested} connections.` : `Sync queued for ${queued} of ${requested} connections.`];
  if (waiting > 0) {
    parts.push(
      `${waiting === 1 ? "One already has" : `${waiting} already have`} a sync queued or requested in the last ${MANUAL_SYNC_COOLDOWN_SECONDS / 60} minutes.`,
    );
  }
  if (failed > 0) parts.push(`${failed === 1 ? "One" : failed} could not be queued. Try again in a moment, reference ${referenceId ?? "unknown"}.`);
  parts.push("New numbers appear within a few minutes.");
  return { ok: true, message: parts.join(" ") };
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

    manualStep = manualRevokeMessage(
      connection.provider,
      await disconnectConnection({
        workspaceId: access.workspace.id,
        connectionId: connection.id,
        provider: connection.provider,
        userId: access.user.id,
      }),
    );
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
      manualStep = manualRevokeMessage(
        connection.provider,
        await revokeAtProvider(access.workspace.id, connection.id, connection.provider),
      );
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

/**
 * "Explore with sample data" (#257): connects every simulated provider to an empty workspace and
 * runs their first sync, then opens the timeline with the result. Owners and admins only, checked
 * against the verified user, and refused when simulation is off or anything is already connected.
 */
export async function exploreWithSampleData(
  _previous: ConnectionActionResult | null,
  formData: FormData,
): Promise<ConnectionActionResult> {
  const parsed = workspaceSchema.safeParse({ workspace: formData.get("workspace") });
  if (!parsed.success) return { ok: false, message: STALE_FORM_MESSAGE };

  let timelinePath: string;
  try {
    const access = await requireWorkspaceAction(parsed.data.workspace, "manage_connections");
    const supabase = await createClient();
    const { count, error } = await supabase
      .from("connections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", access.workspace.id);
    if (error) throw new Error("Connection count failed", { cause: error });
    const refusal = sampleDataRefusal({ simulationEnabled: isProviderSimulationEnabled(), connectionCount: count ?? 0 });
    if (refusal !== null) return { ok: false, message: refusal };

    const connections = await addSampleData({ workspaceId: access.workspace.id, userId: access.user.id, now: new Date() });
    log.info("connections.sample_data_added", { workspaceId: access.workspace.id, connections: connections.length });
    timelinePath = workspacePath(access.workspace.slug, "timeline");
  } catch (error) {
    return failure(
      "connections.sample_data_failed",
      error,
      "The sample data could not be added in full. Any simulated provider it connected is on the Connections page, where it keeps syncing or can be deleted.",
    );
  }
  redirect(`${timelinePath}?${new URLSearchParams({ [SAMPLE_DATA_ADDED_PARAM]: "added" }).toString()}`);
}
