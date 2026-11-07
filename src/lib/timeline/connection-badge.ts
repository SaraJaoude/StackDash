import type { ProviderId } from "@/lib/adapters/types";
import { providerName } from "@/lib/providers";

const FULL_COUNT = new Intl.NumberFormat("en-US");
const SHORT_COUNT = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

export type ConnectionBadgeText = Readonly<{
  /** "Stripe: Acme billing, 1,240 events": the tooltip and the screen reader text. */
  label: string;
  /** "1.2K": what fits in the badge on the logo. */
  short: string;
}>;

/**
 * The words for one connection badge in the timeline's title row (#245). The badge is too small for
 * large counts, so it shortens them; the label always keeps the provider, the connection, and the
 * exact count, so the logo and the short number never carry the meaning alone.
 */
export function connectionBadgeText(connection: {
  provider: ProviderId;
  name: string;
  events: number;
}): ConnectionBadgeText {
  const noun = connection.events === 1 ? "event" : "events";
  return {
    label: `${providerName(connection.provider)}: ${connection.name}, ${FULL_COUNT.format(connection.events)} ${noun}`,
    short: SHORT_COUNT.format(connection.events),
  };
}
