import "server-only";

import { z } from "zod";

import { decodeCursor, encodeCursor, type Page } from "@/lib/data/cursor";
import { createAdminClient } from "@/lib/supabase/admin";
import { Constants, type Database } from "@/lib/supabase/database.types";

/*
 * Instance-wide figures for the super admin page (#250), from the service role only functions in
 * 20261112101200_super_admin_overview.sql. Callers must have passed requireSuperAdmin(): nothing
 * here checks who is asking, because the service role sees every workspace.
 */

type Functions = Database["public"]["Functions"];

export type InstanceTotals = Functions["admin_instance_totals"]["Returns"][number];
export type WorkspaceStats = Functions["admin_workspace_stats"]["Returns"][number];
export type ProviderUsage = Functions["admin_provider_usage"]["Returns"][number];

// Rows per page of the workspace table. The function caps a page at 100.
export const WORKSPACE_PAGE_SIZE = 25;

// The generated types cannot say which columns of a returned table may be null, so the rows with
// nullable timestamps are parsed here rather than trusted.
const jobKind = z.enum(Constants.public.Enums.sync_job_kind);
const jobHealthRow = z.object({
  kind: jobKind,
  queued: z.number(),
  due: z.number(),
  retrying: z.number(),
  running: z.number(),
  stale: z.number(),
  succeeded_24h: z.number(),
  failed_24h: z.number(),
  oldest_due_at: z.string().nullable(),
  last_finished_at: z.string().nullable(),
});
const jobFailureRow = z.object({
  kind: jobKind,
  error_code: z.string(),
  failures: z.number(),
  last_failed_at: z.string(),
});

export type JobHealth = z.infer<typeof jobHealthRow>;
export type JobFailure = z.infer<typeof jobFailureRow>;

export async function loadInstanceTotals(): Promise<InstanceTotals> {
  const { data, error } = await createAdminClient().rpc("admin_instance_totals").single();
  if (error) throw new Error("Loading the instance totals failed.", { cause: error });
  return data;
}

/** One page of workspaces, newest first, after the page `rawCursor` ended (a malformed one means the first). */
export async function loadWorkspaceStats(rawCursor: string | null): Promise<Page<WorkspaceStats>> {
  const cursor = decodeCursor(rawCursor);
  const { data, error } = await createAdminClient().rpc("admin_workspace_stats", {
    p_limit: WORKSPACE_PAGE_SIZE + 1,
    ...(cursor === null ? {} : { p_after_created_at: cursor[0], p_after_id: cursor[1] }),
  });
  if (error) throw new Error("Loading the workspace figures failed.", { cause: error });
  const items = data.slice(0, WORKSPACE_PAGE_SIZE);
  const last = items.at(-1);
  return {
    items,
    nextCursor: data.length > WORKSPACE_PAGE_SIZE && last !== undefined ? encodeCursor([last.created_at, last.workspace_id]) : null,
  };
}

export async function loadProviderUsage(): Promise<ProviderUsage[]> {
  const { data, error } = await createAdminClient().rpc("admin_provider_usage");
  if (error) throw new Error("Loading the provider usage failed.", { cause: error });
  return data;
}

export async function loadJobHealth(): Promise<JobHealth[]> {
  const { data, error } = await createAdminClient().rpc("admin_job_health");
  if (error) throw new Error("Loading the job health failed.", { cause: error });
  return z.array(jobHealthRow).parse(data);
}

export async function loadJobFailures(): Promise<JobFailure[]> {
  const { data, error } = await createAdminClient().rpc("admin_job_failures");
  if (error) throw new Error("Loading the job failures failed.", { cause: error });
  return z.array(jobFailureRow).parse(data);
}

/** The newest migration the database recorded, or null when it was not migrated by the Supabase CLI. */
export async function loadLatestMigration(): Promise<string | null> {
  const { data, error } = await createAdminClient().rpc("admin_latest_migration");
  if (error) throw new Error("Loading the latest migration failed.", { cause: error });
  return z.string().nullable().parse(data);
}
