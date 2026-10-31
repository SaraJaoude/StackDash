import { TIMELINE_TIME_ZONE } from "@/lib/timeline/query";

const absoluteFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMELINE_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

const relativeFormat = new Intl.RelativeTimeFormat("en-US", { numeric: "auto" });

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 60 * 60],
  ["month", 30 * 24 * 60 * 60],
  ["week", 7 * 24 * 60 * 60],
  ["day", 24 * 60 * 60],
  ["hour", 60 * 60],
  ["minute", 60],
];

function relativeLabel(at: Date, now: Date): string {
  const seconds = Math.round((at.getTime() - now.getTime()) / 1000);
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return relativeFormat.format(Math.trunc(seconds / size), unit);
  }
  return relativeFormat.format(0, "second");
}

/**
 * When an event happened: the absolute London time people can quote, then how long ago. Rendered
 * only on the server (no hydration), so the server's ICU data decides the wording.
 */
export function EventTime({ occurredAt, now }: { occurredAt: string; now: Date }) {
  const at = new Date(occurredAt);
  return (
    <span className="font-mono text-[11px] tabular-nums text-muted">
      <time dateTime={at.toISOString()}>{absoluteFormat.format(at)}</time>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">, </span>
      <span>{relativeLabel(at, now)}</span>
    </span>
  );
}
