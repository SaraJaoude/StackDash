// Dates are stored in UTC and shown in Europe/London, US English wording (project rules).
const TIME_ZONE = "Europe/London";

const absoluteFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIME_ZONE,
  dateStyle: "medium",
  timeStyle: "short",
});

const relativeFormat = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

const UNITS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
  ["second", 1],
];

/** "Oct 31, 2026, 2:05 PM" in London time. */
export function formatAbsolute(date: Date): string {
  return absoluteFormat.format(date);
}

/** "5 minutes ago", "in 2 hours"; anything under 45 seconds is "now". */
export function formatRelative(date: Date, now: Date): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000);
  if (Math.abs(seconds) < 45) return relativeFormat.format(0, "second");
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.round(seconds / size), unit);
  }
  return relativeFormat.format(0, "second");
}

/** Whole seconds left in a cooldown that started at `startedAt`, never negative. */
export function cooldownRemainingSeconds(startedAt: Date | null, cooldownSeconds: number, now: Date): number {
  if (startedAt === null) return 0;
  return Math.max(0, Math.ceil((startedAt.getTime() + cooldownSeconds * 1000 - now.getTime()) / 1000));
}
