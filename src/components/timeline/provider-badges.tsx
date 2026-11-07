import Link from "next/link";

import { ProviderMark } from "@/components/connections/provider-mark";
import type { ConnectionEventCount } from "@/lib/data/timeline";
import { providerName } from "@/lib/providers";
import { providerBadgeQuery, providerBadges, providerBadgeText } from "@/lib/timeline/provider-badges";
import { timelineHref, type TimelineQuery } from "@/lib/timeline/query";

const BADGE = "absolute -right-2 min-w-5 rounded-full border px-1 text-center font-mono text-[10px] leading-4";

/**
 * One small logo per provider with events in view, in the title row (#245). The top badge counts
 * its events under the current filters across every page, the bottom badge its connections in
 * view. Each logo is a link that shows only that provider, keeping every other filter, or back
 * every provider when it is already the only one. The picture and the tooltip are hidden from
 * assistive tech; the link's name carries the provider and the exact counts.
 */
export function ProviderBadges({
  counts,
  action,
  query,
}: {
  counts: readonly ConnectionEventCount[];
  action: string;
  query: TimelineQuery;
}) {
  const badges = providerBadges(counts);
  if (badges.length === 0) return null;
  return (
    // pr-2 keeps the last badges, which overhang their logo, inside the page's right edge.
    <ul aria-label="Events by provider" className="flex flex-wrap items-center gap-4 pr-2">
      {badges.map((badge) => {
        const { label, short } = providerBadgeText(badge);
        const link = providerBadgeQuery(query, badge.provider);
        return (
          <li key={badge.provider}>
            <Link
              href={timelineHref(action, link.query, null)}
              aria-current={link.current ? "page" : undefined}
              className={`relative block rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${
                link.current ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""
              }`}
            >
              <span aria-hidden="true" title={label} className="block">
                <ProviderMark provider={badge.provider} size={16} frame="sm" />
                <span className={`${BADGE} -top-2 border-line-strong bg-panel text-foreground`}>{short}</span>
                <span className={`${BADGE} -bottom-2 border-line bg-panel-raised text-muted`}>{badge.connections}</span>
              </span>
              <span className="sr-only">
                {link.current ? `Show every provider, not only ${providerName(badge.provider)}. ${label}` : `Show only ${label}`}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
