import Link from "next/link";

import { ProviderMark } from "@/components/ui/provider-mark";
import type { ConnectionEventCount } from "@/lib/data/timeline";
import { providerBadgeQuery, providerBadges, providerBadgeText } from "@/lib/timeline/provider-badges";
import { timelineHref, type TimelineQuery } from "@/lib/timeline/query";

// Each badge starts just inside the logo's right edge and grows outwards, so a long count ("1.5K")
// never covers the logo; the item's right padding holds it.
const BADGE = "absolute left-full -ml-2 min-w-5 rounded-full border px-1 text-center font-mono text-[10px] leading-4";

/**
 * One small logo per provider with events in view, in the title row (#245). The top badge counts
 * its events under the current filters across every page, the bottom badge its connections in
 * view. Each logo is a link that shows only that provider, keeping every other filter, or back to
 * every provider when it is already the only one. The picture is hidden from assistive tech; one
 * sentence is both the link's name and the picture's tooltip.
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
    <ul aria-label="Events by provider" className="flex flex-wrap items-center gap-2">
      {badges.map((badge) => {
        const link = providerBadgeQuery(query, badge.provider);
        const { name, short } = providerBadgeText(badge, link.current);
        return (
          <li key={badge.provider} className="pr-7">
            <Link
              href={timelineHref(action, link.query, null)}
              scroll={false}
              aria-current={link.current ? "page" : undefined}
              className={`relative block rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-accent ${
                link.current ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""
              }`}
            >
              <span aria-hidden="true" title={name} className="block">
                <ProviderMark provider={badge.provider} size="sm" />
                <span className={`${BADGE} -top-2 border-line-strong bg-panel text-foreground`}>{short}</span>
                <span className={`${BADGE} -bottom-2 border-line bg-panel-raised text-muted`}>{badge.connections}</span>
              </span>
              <span className="sr-only">{name}</span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
