import { PlatformLogo, PuzzleIcon } from "@/components/icons";
import type { ConnectionEventCount } from "@/lib/data/timeline";
import { providerName, providerPlatform } from "@/lib/providers";

const countFormat = new Intl.NumberFormat("en-US");

/**
 * Each connection in view with its provider logo and a badge counting its events under the
 * current filters, across every page (#245). The logo is decorative: the provider name is read out
 * before the connection name, and "events" after the number, so neither rests on the picture.
 */
export function ConnectionCounts({ counts }: { counts: readonly ConnectionEventCount[] }) {
  if (counts.length === 0) return null;
  return (
    <section aria-labelledby="timeline-connection-counts" className="mt-6">
      <h2 id="timeline-connection-counts" className="text-sm font-semibold text-foreground">
        Events by connection
      </h2>
      <ul className="mt-2 flex flex-wrap gap-2">
        {counts.map((count) => {
          const platform = providerPlatform(count.provider);
          return (
            <li
              key={count.connectionId}
              className="inline-flex min-h-10 min-w-0 items-center gap-2 rounded-lg border border-line bg-panel py-1.5 pl-1.5 pr-2 text-sm"
            >
              <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-line bg-panel-raised text-foreground">
                {platform === null ? (
                  <PuzzleIcon className="size-4" />
                ) : (
                  <PlatformLogo platform={platform} className="size-4" />
                )}
              </span>
              <span className="min-w-0 break-words">
                <span className="sr-only">{providerName(count.provider)}: </span>
                {count.name}
                <span className="sr-only">, </span>
              </span>
              <span className="shrink-0 rounded-full border border-line-strong px-2 py-0.5 font-mono text-xs text-foreground">
                {countFormat.format(count.events)}
                <span className="sr-only"> {count.events === 1 ? "event" : "events"}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
