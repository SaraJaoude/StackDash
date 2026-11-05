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
>;

/** Newest keys shown in settings. A workspace holds at most MAX_ACTIVE_API_KEYS working keys. */
export const API_KEYS_LIST_LIMIT = 50;
export const MAX_ACTIVE_API_KEYS = 20;

export type ApiKeyList = { keys: ApiKeySummary[]; hasMore: boolean };

/** The workspace's keys, newest first, through api_keys_workspace_created_at_idx. */
export const listApiKeys = cache(async (workspaceId: string): Promise<ApiKeyList> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, token_prefix, scopes, created_at, last_used_at, revoked_at")
    .eq("workspace_id", workspaceId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    // One extra row tells whether older keys were left out.
    .limit(API_KEYS_LIST_LIMIT + 1);
  if (error) throw new Error("Failed to list API keys", { cause: error });
  return { keys: data.slice(0, API_KEYS_LIST_LIMIT), hasMore: data.length > API_KEYS_LIST_LIMIT };
});

/** How many keys still work (not revoked) in the workspace. */
export async function countActiveApiKeys(workspaceId: string): Promise<number> {
  const supabase = await createClient();
  const { count, error } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId)
    .is("revoked_at", null);
  if (error) throw new Error("Failed to count API keys", { cause: error });
  return count ?? 0;
}
