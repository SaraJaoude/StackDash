import type { ConnectionInput } from "@/lib/dashboard/aggregate";

/**
 * Why a timeline with no events at all is empty (#322), which decides what it tells the user:
 * - `no_connections`: nothing is connected, or every connection is disconnected, so connecting a
 *   provider is the first step.
 * - `first_sync`: an active connection has not finished its first sync, so events are on their way.
 * - `no_events`: every live connection has synced, or waits on the user, and none has reported an event.
 */
export type TimelineEmptyKind = "no_connections" | "first_sync" | "no_events";

export function timelineEmptyKind(connections: readonly Pick<ConnectionInput, "status" | "last_synced_at">[]): TimelineEmptyKind {
  // No connections, or only disconnected ones (`every` is true for none). Disconnecting writes no
  // timeline event (src/lib/connections/revoke.ts), so a workspace that disconnected before a first
  // sync landed has nothing connected and nothing to show.
  if (connections.every((connection) => connection.status === "revoked")) return "no_connections";
  // Only an active connection that has never synced is on its way. Pending and needs_attention
  // connections wait for the user (src/lib/jobs/schedule.ts). A failed one is retried, but leaving
  // active wrote a sync failure event (handleFailure in src/lib/jobs/sync-connection.ts), so its
  // timeline is not empty; if it were, the Connections page is where the failure shows.
  const syncing = connections.some((connection) => connection.status === "active" && connection.last_synced_at === null);
  return syncing ? "first_sync" : "no_events";
}
