import type { ConnectionInput } from "@/lib/dashboard/aggregate";

/**
 * Why a timeline with no events at all is empty (#322), which decides what it tells the user:
 * - `no_connections`: nothing is connected, so connecting a provider is the first step.
 * - `first_sync`: an active connection has not finished its first sync, so events are on their way.
 * - `no_events`: every connection has synced, or cannot sync, and none has reported an event.
 */
export type TimelineEmptyKind = "no_connections" | "first_sync" | "no_events";

export function timelineEmptyKind(connections: readonly Pick<ConnectionInput, "status" | "last_synced_at">[]): TimelineEmptyKind {
  if (connections.length === 0) return "no_connections";
  // Only an active connection's first sync is queued or running. Pending, needs_attention, and
  // revoked connections wait for the user (src/lib/jobs/schedule.ts), and a failed one has failed.
  const syncing = connections.some((connection) => connection.status === "active" && connection.last_synced_at === null);
  return syncing ? "first_sync" : "no_events";
}
