import { createHash, randomUUID } from "node:crypto";

import { DAY_MS, SLOT_MS, utcDayStart } from "@/lib/adapters/simulated/simulation";
import { dailySummaryJobKey, runDailySummaryJob } from "@/lib/jobs/daily-summary";
import { utcDate } from "@/lib/jobs/ingest";
import type { ClaimedJob } from "@/lib/jobs/store";
import { runSyncJob, type JobOutcome, type SyncDeps } from "@/lib/jobs/sync-connection";

/*
 * The 90 day history behind the demo workspace (#166). The simulated providers (#131) make up every
 * value from the clock, so the history is built by moving the clock, not by writing rows: one
 * step per UTC day, each running the same job code as a live tick (`runSyncJob` with its
 * validation, ingest, and alert evaluation, then `runDailySummaryJob`) with `now` set to that day.
 * The demo therefore cannot show anything the real pipeline would reject.
 */

export const DEMO_HISTORY_DAYS = 90;
export const SIMULATE_PROVIDERS_FLAG = "DEVMACRO_SIMULATE_PROVIDERS=1";

/**
 * Why the demo seed must not run here, or null when it may. It writes only with simulation on
 * (the same check the app uses, which already refuses a Vercel production deployment) and only
 * to a Supabase stack on this computer, so it can never touch a remote project.
 */
export function demoSeedRefusal(input: Readonly<{ simulationEnabled: boolean; supabaseUrl: string | undefined }>): string | null {
  if (!input.simulationEnabled) {
    return `Provider simulation is off. Set ${SIMULATE_PROVIDERS_FLAG} in .env.local and run the demo seed again.`;
  }
  if (input.supabaseUrl === undefined || input.supabaseUrl.trim() === "") {
    return "NEXT_PUBLIC_SUPABASE_URL is not set. Start the local Supabase stack and copy its URL into .env.local.";
  }
  if (!isLoopbackUrl(input.supabaseUrl)) {
    return "NEXT_PUBLIC_SUPABASE_URL is not a Supabase stack on this computer. The demo seed only writes to a local stack (localhost or 127.0.0.1).";
  }
  return null;
}

/**
 * True for an http(s) URL whose host is this computer: `localhost`, any 127.x.x.x address, or
 * `[::1]`. The WHATWG parser has already normalized the host (`127.1` is `127.0.0.1`, user info
 * is split off), so a name that only starts with a loopback address is refused.
 */
export function isLoopbackUrl(value: string): boolean {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = url.hostname;
  return host === "localhost" || host === "[::1]" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * The seed a simulated provider derives its accounts from, fixed by the demo seed text so a
 * rehearsed demo shows the same accounts, projects, and launch days every time.
 */
export function demoAccountSeed(seed: string, provider: string): string {
  return createHash("sha256").update(`${seed}\u0000${provider}`).digest("hex").slice(0, 8);
}

export type HistoryStep = Readonly<{
  at: Date;
  /** The UTC day this step closes, whose daily summary runs after its syncs; null for today. */
  summaryDate: string | null;
}>;

/**
 * The replay clock: the last 10 second slot of each of the `days` UTC days before today, oldest
 * first, then `now`. The last slot of a day reads that day's full totals into its snapshot, and
 * the step at `now` leaves every cursor where `npm run jobs:tick -- --watch` continues from.
 */
export function historySteps(now: Date, days: number = DEMO_HISTORY_DAYS): HistoryStep[] {
  const today = utcDayStart(now.getTime());
  const steps: HistoryStep[] = [];
  for (let back = days; back >= 1; back -= 1) {
    const at = new Date(today - (back - 1) * DAY_MS - SLOT_MS);
    steps.push({ at, summaryDate: utcDate(at) });
  }
  steps.push({ at: now, summaryDate: null });
  return steps;
}

export type ReplayInput = Readonly<{
  /** Live job dependencies whose `now`, and whose adapter context's `now`, read the replay clock. */
  deps: SyncDeps;
  setNow: (at: Date) => void;
  workspaceId: string;
  connectionIds: readonly string[];
  steps: readonly HistoryStep[];
  onStep?: (step: HistoryStep, index: number) => void;
}>;

/**
 * A job as `claim_sync_jobs` would hand it over, on its one and only attempt: the replay never
 * retries, so a failure stops the seed instead of leaving a gap in the history.
 */
function replayJob(fields: Pick<ClaimedJob, "kind" | "workspace_id" | "connection_id" | "dedupe_key">, at: Date): ClaimedJob {
  return { id: randomUUID(), attempts: 1, max_attempts: 1, created_at: at.toISOString(), ...fields };
}

function check(outcome: JobOutcome, what: string, at: Date): void {
  if (outcome.status === "succeeded") return;
  const reference = outcome.errorReference === null ? "" : `, reference ${outcome.errorReference}`;
  throw new Error(`The demo history stopped at ${at.toISOString()}: ${what} failed (${outcome.errorCode}${reference}).`);
}

/** Runs every step: each connection syncs at the step's instant, then the day it closes is summarized. */
export async function replayHistory(input: ReplayInput): Promise<void> {
  const { deps, workspaceId } = input;
  for (const [index, step] of input.steps.entries()) {
    input.setNow(step.at);
    // Different connections never share a cursor, so they sync side by side as on a live tick.
    const outcomes = await Promise.all(
      input.connectionIds.map((connectionId) =>
        runSyncJob(replayJob({ kind: "sync", workspace_id: workspaceId, connection_id: connectionId, dedupe_key: null }, step.at), deps),
      ),
    );
    for (const outcome of outcomes) check(outcome, "a sync", step.at);

    if (step.summaryDate !== null) {
      const job = replayJob(
        {
          kind: "daily_summary",
          workspace_id: workspaceId,
          connection_id: null,
          dedupe_key: dailySummaryJobKey(workspaceId, step.summaryDate),
        },
        step.at,
      );
      check(await runDailySummaryJob(job, deps), "the daily summary", step.at);
    }
    input.onStep?.(step, index);
  }
}
