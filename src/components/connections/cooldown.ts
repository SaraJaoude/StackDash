/** Whole seconds left in a cooldown that started at `startedAt`, never negative. */
export function cooldownRemainingSeconds(startedAt: Date | null, cooldownSeconds: number, now: Date): number {
  if (startedAt === null) return 0;
  return Math.max(0, Math.ceil((startedAt.getTime() + cooldownSeconds * 1000 - now.getTime()) / 1000));
}

/**
 * The hint beside an unavailable "Sync now" while its cooldown runs (#161), or null once it is over.
 * One wording for a connection's page and the dashboard's stale notice (#267).
 */
export function syncCooldownNotice(remainingSeconds: number): string | null {
  if (remainingSeconds <= 0) return null;
  return `Sync now is available again in ${Math.ceil(remainingSeconds / 60)} minute${remainingSeconds > 60 ? "s" : ""}.`;
}
