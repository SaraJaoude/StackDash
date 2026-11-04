import { formatDateTime, formatRelative } from "@/lib/format";

/**
 * When an event happened: the absolute London time people can quote, then how long ago. Rendered
 * only on the server (no hydration), so the server's ICU data decides the wording.
 */
export function EventTime({ occurredAt, now }: { occurredAt: string; now: Date }) {
  const at = new Date(occurredAt);
  return (
    <span className="font-mono text-[11px] tabular-nums text-muted">
      <time dateTime={at.toISOString()}>{formatDateTime(at)}</time>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">, </span>
      <span>{formatRelative(at, now)}</span>
    </span>
  );
}
