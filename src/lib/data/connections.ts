import "server-only";

import { cache } from "react";
import { z } from "zod";

import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

/*
 * Reads for the connections pages (#40), as the signed-in user so row level security applies.
 * Callers have already run `requireWorkspace`; the explicit `workspace_id` filter keeps every query
 * scoped even where RLS would allow more. Credentials are never selected here: they live in a table
 * only the service role can read.
 */

type ConnectionRow = Database["public"]["Tables"]["connections"]["Row"];
type ExternalAccountRow = Database["public"]["Tables"]["external_accounts"]["Row"];
type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

const CONNECTION_COLUMNS =
  "id, provider, status, display_name, authorized_account_label, missing_scopes, last_synced_at, last_sync_requested_at, created_at" as const;

export type ConnectionSummary = Pick<
  ConnectionRow,
  | "id"
  | "provider"
  | "status"
  | "display_name"
  | "authorized_account_label"
  | "missing_scopes"
  | "last_synced_at"
  | "last_sync_requested_at"
  | "created_at"
>;

export type ExternalAccountSummary = Pick<
  ExternalAccountRow,
  "id" | "external_id" | "display_name" | "kind" | "project_id" | "included"
>;

export type ProjectOption = Pick<ProjectRow, "id" | "name">;

export const CONNECTIONS_PAGE_SIZE = 50;
// A connection maps to a handful of accounts; GitHub organizations with many repos stay one account.
export const ACCOUNTS_LIMIT = 200;
export const PROJECT_OPTIONS_LIMIT = 200;

// Fixture ids skip the RFC version bits, so `guid` rather than `uuid`.
const IdSchema = z.guid();

export function isConnectionId(value: string): boolean {
  return IdSchema.safeParse(value).success;
}

// Cursor: the created_at and id of the last row on the previous page, so pages never overlap even
// when two connections share a timestamp.
const CursorSchema = z.object({ createdAt: z.iso.datetime({ offset: true }), id: IdSchema }).strict();
export type ConnectionsCursor = z.infer<typeof CursorSchema>;

export function encodeConnectionsCursor(cursor: ConnectionsCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeConnectionsCursor(value: string | undefined): ConnectionsCursor | null {
  if (value === undefined || value.length === 0 || value.length > 200) return null;
  try {
    const parsed = CursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export type ConnectionsPage = Readonly<{ items: ConnectionSummary[]; nextCursor: string | null }>;

/** One page of the workspace's connections, oldest first. */
export const listConnections = cache(
  async (workspaceId: string, after: ConnectionsCursor | null): Promise<ConnectionsPage> => {
    const supabase = await createClient();
    let query = supabase
      .from("connections")
      .select(CONNECTION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(CONNECTIONS_PAGE_SIZE + 1);
    if (after !== null) {
      // Values are validated by CursorSchema, so they are safe inside the PostgREST filter.
      query = query.or(
        `created_at.gt.${after.createdAt},and(created_at.eq.${after.createdAt},id.gt.${after.id})`,
      );
    }
    const { data, error } = await query;
    if (error) throw new Error("Failed to list connections", { cause: error });
    const items = data.slice(0, CONNECTIONS_PAGE_SIZE);
    const last = items.at(-1);
    const nextCursor =
      data.length > CONNECTIONS_PAGE_SIZE && last !== undefined
        ? encodeConnectionsCursor({ createdAt: last.created_at, id: last.id })
        : null;
    return { items, nextCursor };
  },
);

/** One connection of the workspace, or null when it does not exist there (same answer for both). */
export const getConnection = cache(
  async (workspaceId: string, connectionId: string): Promise<ConnectionSummary | null> => {
    if (!isConnectionId(connectionId)) return null;
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("connections")
      .select(CONNECTION_COLUMNS)
      .eq("workspace_id", workspaceId)
      .eq("id", connectionId)
      .maybeSingle();
    if (error) throw new Error("Failed to load connection", { cause: error });
    return data;
  },
);

/** The accounts a connection can read, by name, at most ACCOUNTS_LIMIT. */
export const listExternalAccounts = cache(
  async (workspaceId: string, connectionId: string): Promise<ExternalAccountSummary[]> => {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("external_accounts")
      .select("id, external_id, display_name, kind, project_id, included")
      .eq("workspace_id", workspaceId)
      .eq("connection_id", connectionId)
      .order("display_name", { ascending: true })
      .order("id", { ascending: true })
      .limit(ACCOUNTS_LIMIT);
    if (error) throw new Error("Failed to list external accounts", { cause: error });
    return data;
  },
);

/** Projects an account can be assigned to, by name, at most PROJECT_OPTIONS_LIMIT. */
export const listProjectOptions = cache(async (workspaceId: string): Promise<ProjectOption[]> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("id, name")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(PROJECT_OPTIONS_LIMIT);
  if (error) throw new Error("Failed to list projects", { cause: error });
  return data;
});
