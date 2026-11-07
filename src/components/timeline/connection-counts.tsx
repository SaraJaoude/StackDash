import { ProviderMark } from "@/components/connections/provider-mark";
import type { ConnectionEventCount } from "@/lib/data/timeline";
import { providerName } from "@/lib/providers";

const fullCount = new Intl.NumberFormat("en-US");
// The badge is small, so large counts shorten ("12K"); the title and the screen reader text keep
// the exact figure.
const shortCount = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/**
 * Each connection in view as a small provider logo with a badge counting its events under the
 * current filters, across every page (#245). Sits in the title row. The logo is decorative: screen
 * readers hear the provider, the connection name, and the exact count, and pointer users get the
 * same as a tooltip, so the picture and the short number never carry the meaning alone.
 */
export function ConnectionCounts({ counts }: { counts: readonly ConnectionEventCount[] }) {
  if (counts.length === 0) return null;
  return (
    // pr-2 keeps the last badge, which overhangs its logo, inside the page's right edge.
    <ul aria-label="Events by connection" className="flex flex-wrap items-center gap-4 pr-2">
      {counts.map((count) => {
        const events = `${fullCount.format(count.events)} ${count.events === 1 ? "event" : "events"}`;
        return (
          <li
            key={count.connectionId}
            title={`${count.name} (${providerName(count.provider)}): ${events}`}
            className="relative"
          >
            <ProviderMark provider={count.provider} size={16} frame="sm" />
            <span className="sr-only">
              {providerName(count.provider)}: {count.name}, {events}
            </span>
            <span
              aria-hidden="true"
              className="absolute -right-2 -top-2 min-w-5 rounded-full border border-line-strong bg-panel px-1 text-center font-mono text-[10px] leading-4 text-foreground"
            >
              {shortCount.format(count.events)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
