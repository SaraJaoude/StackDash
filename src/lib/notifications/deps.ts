import "server-only";

import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";

import { emailTransportFromEnv } from "@/lib/email/send";
import { log, logError } from "@/lib/log/logger";

import { postToChannel } from "./channels";
import type { NotificationDeps } from "./dispatch";
import { messageOrigin } from "./links";
import { createSupabaseNotificationStore } from "./store";
import { unsubscribeToken } from "./unsubscribe";

/**
 * Production wiring for the notification jobs. Built per job (SyncDeps.notifications), so a broken
 * email configuration fails that job, logged with a reference id and retried, never the whole tick.
 */
export function createNotificationDeps(): NotificationDeps {
  return {
    store: createSupabaseNotificationStore(),
    email: emailTransportFromEnv(),
    post: (request) => postToChannel(request, { fetch, sleep: (ms) => sleep(ms), random: Math.random }),
    origin: () => messageOrigin(),
    unsubscribeToken,
    now: () => new Date(),
    random: Math.random,
    newId: randomUUID,
    logError,
    log,
  };
}
