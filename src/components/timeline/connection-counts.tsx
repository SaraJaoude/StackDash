import { ProviderMark } from "@/components/connections/provider-mark";
import type { ConnectionEventCount } from "@/lib/data/timeline";
import { connectionBadgeText } from "@/lib/timeline/connection-badge";

/**
 * Each connection in view as a small provider logo with a badge counting its events under the
 * current filters, across every page (#245). Sits in the title row. One label serves two
 * audiences: screen readers hear it, and pointer users get it as the tooltip on the picture, which
 * is hidden from assistive tech so the label is never read twice. The items are not focusable, so
 * a sighted keyboard or touch user sees the logo and the short count only (raised on #245).
 */
export function ConnectionCounts({ counts }: { counts: readonly ConnectionEventCount[] }) {
  if (counts.length === 0) return null;
  return (
    // pr-2 keeps the last badge, which overhangs its logo, inside the page's right edge.
    <ul aria-label="Events by connection" className="flex flex-wrap items-center gap-4 pr-2">
      {counts.map((count) => {
        const { label, short } = connectionBadgeText(count);
        return (
          <li key={count.connectionId}>
            <span aria-hidden="true" title={label} className="relative block">
              <ProviderMark provider={count.provider} size={16} frame="sm" />
              <span className="absolute -right-2 -top-2 min-w-5 rounded-full border border-line-strong bg-panel px-1 text-center font-mono text-[10px] leading-4 text-foreground">
                {short}
              </span>
            </span>
            <span className="sr-only">{label}</span>
          </li>
        );
      })}
    </ul>
  );
}
