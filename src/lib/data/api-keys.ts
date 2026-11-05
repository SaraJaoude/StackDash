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
  const keys = await supabase
    .from("api_keys")
    .select("id, name, token_prefix, scopes, created_by, created_at, last_used_at, revoked_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // One extra row tells whether older keys were left out.
    .limit(API_KEYS_LIST_LIMIT + 1);
  if (keys.error) throw new Error("Failed to list API keys", { cause: keys.error });
  const page = keys.data.slice(0, API_KEYS_LIST_LIMIT);
  // Only the creators of this page, so the read is bounded by API_KEYS_LIST_LIMIT ids however many
  // members the workspace has; an unbounded member list would be cut at PostgREST's max_rows
  // without an error and mislabel keys whose creator is still a member.
  const creatorIds = [...new Set(page.flatMap((key) => (key.created_by === null ? [] : [key.created_by])))];
  const memberIds = new Set<string>();
  if (creatorIds.length > 0) {
    // Every member may read the workspace's member list (workspace_members_select).
    const members = await supabase
      .from("workspace_members")
      .select("user_id")
      .eq("workspace_id", workspaceId)
      .in("user_id", creatorIds);
    if (members.error) throw new Error("Failed to list workspace members for API keys", { cause: members.error });
    for (const member of members.data) memberIds.add(member.user_id);
  }
  return {
    keys: page.map(({ created_by, ...key }) => ({
      ...key,
      creator_left: created_by === null || !memberIds.has(created_by),
    })),
    hasMore: keys.data.length > API_KEYS_LIST_LIMIT,
  };
});
