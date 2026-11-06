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
 * - Alert dispatch (#152, #153): one per workspace with a triggered alert not sent yet. Alerts the
 *   syncs of one tick record are sent by the next tick, together, so they coalesce into one message.
 * - Digest (#152): like the daily summary, once per UTC day per workspace; the job sends the daily
 *   digest, and on Mondays the weekly one, to the members and channels that chose them.
 */

// Upper bound per tick. Due connections beyond it are queued on the next tick, a minute later.
export const SCHEDULE_BATCH_LIMIT = 500;

export function retentionDedupeKey(now: Date): string {
  return `retention:${utcDate(now)}`;
}

export type ScheduleResult = {
  syncsQueued: number;
  retentionQueued: boolean;
  summariesQueued: number;
  dispatchesQueued: number;
  digestsQueued: number;
};

export async function scheduleDueJobs(store: JobStore, now: Date): Promise<ScheduleResult> {
  const date = summaryDate(now);
  const [syncsQueued, retentionQueued, summariesQueued, dispatchesQueued, digestsQueued] = await Promise.all([
    store.enqueueDueSyncs(SCHEDULE_BATCH_LIMIT),
    store.enqueueRetention(retentionDedupeKey(now)),
    store.enqueueDailySummaries(date),
    store.enqueueAlertDispatches(),
    store.enqueueDigests(date),
  ]);
  return { syncsQueued, retentionQueued, summariesQueued, dispatchesQueued, digestsQueued };
}
