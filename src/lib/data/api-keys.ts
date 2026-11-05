import "server-only";

import { cache } from "react";

import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/*
 * API keys for the settings page (#162), read as the signed-in user. Row level security shows them
 * to owners and admins only, and the column grants never let token_hash out of the database.
 */

type ApiKeyRow = Database["public"]["Tables"]["api_keys"]["Row"];

export type ApiKeySummary = Pick<
  ApiKeyRow,
  "id" | "name" | "token_prefix" | "scopes" | "created_at" | "last_used_at" | "revoked_at"
> & {
  /**
   * The member who created the key is no longer in the workspace (or their account is gone), so
   * the API refuses the key: the same rule as `creator_left` in `authenticate_api_key`.
   */
  creator_left: boolean;
};

/** Newest keys shown in settings. */
export const API_KEYS_LIST_LIMIT = 50;
/** Keys that are not revoked a workspace may hold. Mirrors api_keys_enforce_limit in the database. */
export const MAX_ACTIVE_API_KEYS = 20;

export type ApiKeyList = { keys: ApiKeySummary[]; hasMore: boolean };

/** The workspace's keys, newest first, through api_keys_workspace_created_at_idx. */
export const listApiKeys = cache(async (workspaceId: string): Promise<ApiKeyList> => {
  const supabase = await createClient();
  const [keys, members] = await Promise.all([
    supabase
      .from("api_keys")
      .select("id, name, token_prefix, scopes, created_by, created_at, last_used_at, revoked_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      // One extra row tells whether older keys were left out.
      .limit(API_KEYS_LIST_LIMIT + 1),
    // Every member may read the workspace's member list (workspace_members_select).
    supabase.from("workspace_members").select("user_id").eq("workspace_id", workspaceId),
  ]);
  if (keys.error) throw new Error("Failed to list API keys", { cause: keys.error });
  if (members.error) throw new Error("Failed to list workspace members for API keys", { cause: members.error });
  const memberIds = new Set(members.data.map((member) => member.user_id));
  return {
    keys: keys.data.slice(0, API_KEYS_LIST_LIMIT).map(({ created_by, ...key }) => ({
      ...key,
      creator_left: created_by === null || !memberIds.has(created_by),
    })),
    hasMore: keys.data.length > API_KEYS_LIST_LIMIT,
  };
});
