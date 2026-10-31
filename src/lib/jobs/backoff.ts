/**
 * Retry timing for sync jobs (#44).
 *
 * Exponential backoff with full jitter: the delay for attempt n is a uniform random value in
 * [0, min(cap, base * 2^(n-1))]. Full jitter spreads retries from many connections that failed at
 * the same moment (a provider outage) instead of having them return in lockstep.
 */

export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_CAP_MS = 3_600_000;
// A provider asking for longer than a day is treated as asking for a day, so a bad Retry-After
// cannot park a connection for months.
export const RETRY_AFTER_MAX_MS = 86_400_000;

/** Upper bound of the jitter window for an attempt (1-based). */
export function backoffCeilingMs(attempt: number, baseMs = BACKOFF_BASE_MS, capMs = BACKOFF_CAP_MS): number {
  if (!Number.isInteger(attempt) || attempt < 1) throw new RangeError("attempt must be a positive integer");
  // 2^(attempt - 1) overflows to Infinity for large attempts; Math.min keeps the cap.
  return Math.min(capMs, baseMs * 2 ** (attempt - 1));
}

/** `random` returns a value in [0, 1), like Math.random, so tests can pin it. */
export function backoffDelayMs(
  attempt: number,
  random: () => number,
  baseMs = BACKOFF_BASE_MS,
  capMs = BACKOFF_CAP_MS,
): number {
  const ceiling = backoffCeilingMs(attempt, baseMs, capMs);
  const sample = random();
  if (!(sample >= 0 && sample < 1)) throw new RangeError("random() must return a value in [0, 1)");
  return Math.floor(sample * ceiling);
}

/**
 * Delay before retrying a rate-limited request: the provider's Retry-After when it sent one
 * (clamped to a day), otherwise the same backoff as any other transient failure.
 */
export function rateLimitDelayMs(retryAfterMs: number | undefined, attempt: number, random: () => number): number {
  if (retryAfterMs === undefined || !Number.isFinite(retryAfterMs) || retryAfterMs < 0) {
    return backoffDelayMs(attempt, random);
  }
  return Math.min(retryAfterMs, RETRY_AFTER_MAX_MS);
}
