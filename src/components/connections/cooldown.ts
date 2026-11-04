/** Whole seconds left in a cooldown that started at `startedAt`, never negative. */
export function cooldownRemainingSeconds(startedAt: Date | null, cooldownSeconds: number, now: Date): number {
  if (startedAt === null) return 0;
  return Math.max(0, Math.ceil((startedAt.getTime() + cooldownSeconds * 1000 - now.getTime()) / 1000));
}
