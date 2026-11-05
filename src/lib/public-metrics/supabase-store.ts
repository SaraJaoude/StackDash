import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isSimulatedConnection } from "@/lib/adapters/simulated/marker";
import type { Database } from "@/lib/supabase/database.types";

import type { PublicMetricStore, SnapshotPoint, SourceAccount } from "./engine";

/*
 * The engine's reads for one project, against Supabase. Every query is scoped to the workspace and
 * to the project's included accounts explicitly, because the public route runs it with the service
 * role, which bypasses row level security. In the app it runs as the signed-in member, and row
 * level security applies as well.
 */

type MetricKind = Database["public"]["Enums"]["metric_kind"];

// Quantities only: even a mistyped metric key in a definition cannot read an amount of money.
const QUANTITY_KINDS: readonly MetricKind[] = ["usage", "included_allowance", "remaining_allowance"];

// Bounds. A project groups a handful of accounts; every snapshot read covers at most three days, so
// a few rows per account and key whatever the window, and these are far above what one metric reads.
const ACCOUNTS_LIMIT = 200;
const CONNECTIONS_LIMIT = 200;
const SNAPSHOTS_LIMIT = 5000;

export function createSupabaseMetricStore(
  db: SupabaseClient<Database>,
  workspaceId: string,
  projectId: string,
): PublicMetricStore {
  return {
    async accounts(): Promise<SourceAccount[]> {
      const [accounts, connections] = await Promise.all([
        db
          .from("external_accounts")
          .select("id, connection_id")
          .eq("workspace_id", workspaceId)
          .eq("project_id", projectId)
          .eq("included", true)
          .order("id")
          .limit(ACCOUNTS_LIMIT),
        // A disconnected (revoked) connection keeps its rows, but the user asked DevMacro to stop
        // using them, so its accounts drop out and the metric reads "not connected". The scheduler
        // and the daily summary skip revoked connections the same way (src/lib/jobs/store.ts).
        db
          .from("connections")
          .select("id, provider, created_at, last_synced_at, granted_scopes")
          .eq("workspace_id", workspaceId)
          .neq("status", "revoked")
          .order("id")
          .limit(CONNECTIONS_LIMIT),
      ]);
      if (accounts.error) throw new Error("Failed to load the project's accounts", { cause: accounts.error });
      if (connections.error) throw new Error("Failed to load the workspace's connections", { cause: connections.error });

      const byId = new Map(connections.data.map((connection) => [connection.id, connection]));
      return accounts.data.flatMap((account) => {
        const connection = byId.get(account.connection_id);
        if (connection === undefined) return [];
        return [
          {
            accountId: account.id,
            provider: connection.provider,
            connectionCreatedAt: new Date(connection.created_at),
            lastSyncedAt: connection.last_synced_at === null ? null : new Date(connection.last_synced_at),
            simulated: isSimulatedConnection(connection),
          },
        ];
      });
    },

    async snapshots({ accountIds, metricKeys, fromDate, toDate }): Promise<SnapshotPoint[]> {
      if (accountIds.length === 0 || metricKeys.length === 0) return [];
      const { data, error } = await db
        .from("usage_snapshots")
        .select("external_account_id, metric_key, snapshot_date, value, period_start, period_end, resets_at, retrieved_at")
        .eq("workspace_id", workspaceId)
        .in("external_account_id", accountIds)
        .in("metric_key", metricKeys)
        .in("kind", QUANTITY_KINDS)
        .not("value", "is", null)
        .gte("snapshot_date", fromDate)
        .lte("snapshot_date", toDate)
        // Newest first, so a cut-off list loses the oldest days (a missing baseline), never today.
        .order("snapshot_date", { ascending: false })
        .order("id", { ascending: true })
        .limit(SNAPSHOTS_LIMIT);
      if (error) throw new Error("Failed to load snapshots for public metrics", { cause: error });
      return data.flatMap((row) =>
        row.value === null
          ? []
          : [
              {
                accountId: row.external_account_id,
                metricKey: row.metric_key,
                snapshotDate: row.snapshot_date,
                value: row.value,
                periodStart: row.period_start === null ? null : new Date(row.period_start),
                periodEnd: row.period_end === null ? null : new Date(row.period_end),
                resetsAt: row.resets_at === null ? null : new Date(row.resets_at),
                retrievedAt: new Date(row.retrieved_at),
              },
            ],
      );
    },

    async countEvents({ accountIds, typeIds, from, to }): Promise<number> {
      if (accountIds.length === 0 || typeIds.length === 0) return 0;
      // A head request: Postgres counts, no rows travel. Served by activity_events_workspace_timeline_idx.
      const { count, error } = await db
        .from("activity_events")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .in("external_account_id", accountIds)
        .in("type_id", typeIds)
        .gte("occurred_at", from.toISOString())
        .lt("occurred_at", to.toISOString());
      if (error) throw new Error("Failed to count events for public metrics", { cause: error });
      if (count === null) throw new Error("Event count missing from the response");
      return count;
    },

    async earliestEvent({ accountIds, typeIds }): Promise<Date | null> {
      if (accountIds.length === 0 || typeIds.length === 0) return null;
      const { data, error } = await db
        .from("activity_events")
        .select("occurred_at")
        .eq("workspace_id", workspaceId)
        .in("external_account_id", accountIds)
        .in("type_id", typeIds)
        .order("occurred_at", { ascending: true })
        .limit(1);
      if (error) throw new Error("Failed to load the earliest event for public metrics", { cause: error });
      const first = data[0];
      return first === undefined ? null : new Date(first.occurred_at);
    },

    async recentEvents({ accountIds, typeIds, before, limit }) {
      if (accountIds.length === 0 || typeIds.length === 0) return [];
      const { data, error } = await db
        .from("activity_events")
        .select("type_id, occurred_at")
        .eq("workspace_id", workspaceId)
        .in("external_account_id", accountIds)
        .in("type_id", typeIds)
        .lte("occurred_at", before.toISOString())
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(limit);
      if (error) throw new Error("Failed to load recent events for public metrics", { cause: error });
      return data.map((row) => ({ typeId: row.type_id, occurredAt: new Date(row.occurred_at) }));
    },
  };
}
