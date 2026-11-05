import "server-only";

import { createHmac } from "node:crypto";

import { after } from "next/server";

import { derivedKey } from "@/lib/crypto/credentials";
import { logError } from "@/lib/log/logger";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";

import type { PublicMetricId } from "./definitions";

/*
 * What every public read route shares (#149): the badge, the card, and the JSON route of #148.
 *
 * Caching: one minute in browsers and shared caches, so a value that is unpublished stops showing
 * within a minute (#149's acceptance bound), while an embed read by many people is computed about
 * once a minute per cache.
 *
 * Rate limit: PUBLIC_REQUESTS_PER_MINUTE requests per client IP per minute across all three routes,
 * counted in Postgres (public_rate_limit_counters) so every server instance shares one count.
 * Requests a cache answers never reach the server, so they are not counted. The IP is hashed with
 * HMAC-SHA-256 under a key derived from the encryption key before it leaves the server, and the
 * table refuses anything but a hash, so no IP address is stored. Decision on issue #149.
 */

export const PUBLIC_CACHE_CONTROL = "public, max-age=60, s-maxage=60";
export const NO_STORE = "no-store";

/**
 * Generous for one person or a README image proxy (GitHub's camo fetches a badge once per cache
 * expiry, not once per reader); far below what it takes to load the database.
 */
export const PUBLIC_REQUESTS_PER_MINUTE = 120;

/** The bucket for requests whose client IP the platform did not report. */
const UNKNOWN_CLIENT = "unknown";

/**
 * The client IP the hosting platform reports. Vercel sets `x-real-ip` and overwrites
 * `x-forwarded-for` so neither can be spoofed there
 * (https://vercel.com/docs/headers/request-headers#x-forwarded-for); behind another proxy the first
 * `x-forwarded-for` entry is the client. Null when neither is present.
 */
export function clientIp(headers: Headers): string | null {
  const real = headers.get("x-real-ip")?.trim();
  if (real !== undefined && real !== "") return real;
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded !== undefined && forwarded !== "" ? forwarded : null;
}

/** Lowercase hex HMAC-SHA-256 of the IP, the only form public_rate_limit_counters accepts. */
export function hashClientIp(ip: string, key: Buffer): string {
  return createHmac("sha256", key).update(ip.toLowerCase()).digest("hex");
}

export type RateLimitDecision = Readonly<{ allowed: true }> | Readonly<{ allowed: false; retryAfterSeconds: number }>;

/** Whole seconds until the next minute starts, 1 to 60: when a refused client may try again. */
export function secondsUntilNextMinute(now: Date): number {
  return 60 - Math.floor((now.getTime() % 60_000) / 1000);
}

/** Allowed up to and including the limit; the request after it waits for the next minute. */
export function rateLimitDecision(countThisMinute: number, now: Date): RateLimitDecision {
  if (countThisMinute <= PUBLIC_REQUESTS_PER_MINUTE) return { allowed: true };
  return { allowed: false, retryAfterSeconds: secondsUntilNextMinute(now) };
}

/** Counts this request against its client IP and decides whether to serve it. */
export async function checkPublicRateLimit(headers: Headers, now: Date): Promise<RateLimitDecision> {
  const ipHash = hashClientIp(clientIp(headers) ?? UNKNOWN_CLIENT, derivedKey("public-rate-limit"));
  const { data, error } = await createAdminClient().rpc("bump_public_rate_limit", { p_ip_hash: ipHash });
  if (error) throw new Error("Failed to count a public request", { cause: error });
  return rateLimitDecision(data, now);
}

/** The headers of a refused request: never cached, and when to come back. */
export function rateLimitedHeaders(decision: Readonly<{ retryAfterSeconds: number }>): Record<string, string> {
  return { "Cache-Control": NO_STORE, "Retry-After": String(decision.retryAfterSeconds) };
}

export type ShareSurface = Database["public"]["Enums"]["share_surface"];

/**
 * Counts one serve of a published metric's badge or card for its owner's "served this week"
 * figure. The database counts only while the metric is published in that project.
 */
export async function recordPublishedMetricView(projectId: string, metricId: PublicMetricId, surface: ShareSurface): Promise<void> {
  const { error } = await createAdminClient().rpc("record_published_metric_view", {
    p_project_id: projectId,
    p_metric_id: metricId,
    p_surface: surface,
  });
  if (error) throw new Error("Failed to count a published metric view", { cause: error });
}

/**
 * Counts the serve after the response has gone (`after` in next/server), so the badge or card
 * never waits for the write. A failed count is logged and loses that one view; it never turns a
 * served image into an error.
 */
export function countViewAfterResponse(projectId: string, metricId: PublicMetricId, surface: ShareSurface): void {
  after(async () => {
    try {
      await recordPublishedMetricView(projectId, metricId, surface);
    } catch (error) {
      logError("public_metrics.view_count_failed", error, { surface });
    }
  });
}