import { summaryDate } from "./daily-summary";
import { utcDate } from "./ingest";
import type { JobStore } from "./store";

/*
 * First step of every tick: turn "due" into queued jobs.
 * - Syncs: every `active` connection whose next_sync_at has passed (or was never set), and every
 *   `failed` connection whose backoff has elapsed. needs_attention, pending, and revoked
 *   connections wait for the user. At most one open sync per connection, enforced by the database.
 * - Retention: once per UTC day, deduplicated by a key that names the day.
 * - Daily summary (#64): once per UTC day per workspace with a connection, for the previous day,
 *   deduplicated by a key that names the workspace and the summarized day.
 */

// Upper bound per tick. Due connections beyond it are queued on the next tick, a minute later.
export const SCHEDULE_BATCH_LIMIT = 500;

export function retentionDedupeKey(now: Date): string {
  return `retention:${utcDate(now)}`;
}

export type ScheduleResult = { syncsQueued: number; retentionQueued: boolean; summariesQueued: number };

export async function scheduleDueJobs(store: JobStore, now: Date): Promise<ScheduleResult> {
  const [syncsQueued, retentionQueued, summariesQueued] = await Promise.all([
    store.enqueueDueSyncs(SCHEDULE_BATCH_LIMIT),
    store.enqueueRetention(retentionDedupeKey(now)),
    store.enqueueDailySummaries(summaryDate(now)),
  ]);
  return { syncsQueued, retentionQueued, summariesQueued };
}
