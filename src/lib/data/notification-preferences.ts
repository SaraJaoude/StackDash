import "server-only";

import type { EmailFrequency } from "@/lib/notifications/model";
import type { UnsubscribeTarget } from "@/lib/notifications/unsubscribe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/*
 * Repository for `notification_preferences` (#152): each member's alert email setting per
 * workspace. A member reads and writes only their own row (row level security); no row means
 * "immediate" (decision on #152). Unsubscribing from an email link has no session, so it writes as
 * the service role, scoped to the member and workspace the signed token names.
 */

export const DEFAULT_EMAIL_FREQUENCY: EmailFrequency = "immediate";

function failure(operation: string, error: { code: string }): Error {
  return new Error(`notification_preferences ${operation} failed (code ${error.code}).`);
}

/** The signed-in member's setting in this workspace. */
export async function getEmailFrequency(workspaceId: string, userId: string): Promise<EmailFrequency> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notification_preferences")
    .select("email_frequency")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw failure("read", error);
  return data?.email_frequency ?? DEFAULT_EMAIL_FREQUENCY;
}

/** Saves the signed-in member's setting. False when row level security refused it (not an admin any more). */
export async function saveEmailFrequency(workspaceId: string, userId: string, frequency: EmailFrequency): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("notification_preferences")
    .upsert({ workspace_id: workspaceId, user_id: userId, email_frequency: frequency }, { onConflict: "workspace_id,user_id" });
  if (error === null) return true;
  // 42501: the policy's with check refused the row.
  if (error.code === "42501") return false;
  throw failure("save", error);
}

/**
 * Turns alert email off for the member a valid unsubscribe token names. "not_member" when they
 * have left the workspace since (the row would have nowhere to belong, and there is nothing to
 * stop). Safe to repeat.
 */
export async function unsubscribeMember(target: UnsubscribeTarget): Promise<"unsubscribed" | "not_member"> {
  const db = createAdminClient();
  const { data: member, error: memberError } = await db
    .from("workspace_members")
    .select("user_id")
    .eq("workspace_id", target.workspaceId)
    .eq("user_id", target.userId)
    .maybeSingle();
  if (memberError) throw failure("membership read", memberError);
  if (member === null) return "not_member";
  const { error } = await db
    .from("notification_preferences")
    .upsert(
      { workspace_id: target.workspaceId, user_id: target.userId, email_frequency: "off" },
      { onConflict: "workspace_id,user_id" },
    );
  // 23503: the membership went away between the two statements.
  if (error?.code === "23503") return "not_member";
  if (error) throw failure("unsubscribe", error);
  return "unsubscribed";
}

export type UnsubscribeStatus =
  | Readonly<{ kind: "not_member" }>
  | Readonly<{ kind: "member"; workspaceName: string; frequency: EmailFrequency }>;

/**
 * What the unsubscribe page shows for a valid token: the workspace's name and the member's current
 * setting, or "not_member" when they have left it (or it is deleted). Service role: the page has no
 * session, and the signed token names the only row it reads.
 */
export async function unsubscribeStatus(target: UnsubscribeTarget): Promise<UnsubscribeStatus> {
  const db = createAdminClient();
  const [member, workspace, preference] = await Promise.all([
    db.from("workspace_members").select("user_id").eq("workspace_id", target.workspaceId).eq("user_id", target.userId).maybeSingle(),
    db.from("workspaces").select("name").eq("id", target.workspaceId).maybeSingle(),
    db
      .from("notification_preferences")
      .select("email_frequency")
      .eq("workspace_id", target.workspaceId)
      .eq("user_id", target.userId)
      .maybeSingle(),
  ]);
  if (member.error) throw failure("membership read", member.error);
  if (workspace.error) throw failure("workspace read", workspace.error);
  if (preference.error) throw failure("read", preference.error);
  if (member.data === null || workspace.data === null) return { kind: "not_member" };
  return {
    kind: "member",
    workspaceName: workspace.data.name,
    frequency: preference.data?.email_frequency ?? DEFAULT_EMAIL_FREQUENCY,
  };
}
