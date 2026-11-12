import type { ConnectionEventCount } from "@/lib/data/timeline";
import { providerName } from "@/lib/providers";

import type { TimelineQuery } from "./query";

type Provider = ConnectionEventCount["provider"];

/** One provider logo in the timeline's title row (#245): its connections in view and their events. */
export type ProviderBadge = Readonly<{ provider: Provider; connections: number; events: number }>;

/**
 * The per connection counts grouped by provider, most events first, then by provider name. Only
 * connections with events under the current filters arrive here, so `connections` counts the
 * provider's connections in view, not every connection it has in the workspace.
 */
export function providerBadges(counts: readonly ConnectionEventCount[]): ProviderBadge[] {
  const byProvider = new Map<Provider, { connections: number; events: number }>();
  for (const count of counts) {
    const badge = byProvider.get(count.provider) ?? { connections: 0, events: 0 };
    byProvider.set(count.provider, { connections: badge.connections + 1, events: badge.events + count.events });
  }
  return [...byProvider]
    .map(([provider, badge]) => ({ provider, ...badge }))
    .sort((a, b) => b.events - a.events || providerName(a.provider).localeCompare(providerName(b.provider)));
}

const FULL_COUNT = new Intl.NumberFormat("en-US");
const SHORT_COUNT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export type ProviderBadgeText = Readonly<{
  /**
   * What the link does and the exact counts, as one sentence: the link's accessible name and the
   * picture's tooltip. "Show only Stripe: 1,540 events from 2 connections", or for the current
   * view, "Show every provider. Now showing only Stripe: 1,540 events from 2 connections".
   */
  name: string;
  /** "1.5K": the event count that fits in the badge on the logo. */
  short: string;
}>;

/**
 * The words for one badge. The badge is too small for large counts, so it shortens them; the name
 * always keeps the provider and the exact counts, so the logo and the short number never carry the
 * meaning alone.
 */
export function providerBadgeText(badge: ProviderBadge, current: boolean): ProviderBadgeText {
  const events = `${FULL_COUNT.format(badge.events)} ${badge.events === 1 ? "event" : "events"}`;
  const connections = `${FULL_COUNT.format(badge.connections)} ${badge.connections === 1 ? "connection" : "connections"}`;
  const counts = `${providerName(badge.provider)}: ${events} from ${connections}`;
  return {
    name: current ? `Show every provider. Now showing only ${counts}` : `Show only ${counts}`,
    short: SHORT_COUNT.format(badge.events),
  };
}

/**
 * Where a badge links: the timeline filtered to only its provider, keeping every other filter and
 * starting from the newest events (no cursor). When that provider is already the whole provider
 * filter, the badge is the current view and links back to every provider instead.
 */
export function providerBadgeQuery(query: TimelineQuery, provider: Provider): { query: TimelineQuery; current: boolean } {
  const current = query.scope.providers.length === 1 && query.scope.providers[0] === provider;
  return {
    query: { ...query, cursor: null, scope: { ...query.scope, providers: current ? [] : [provider] } },
    current,
  };
}
