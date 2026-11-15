"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * Sends Vercel Web Analytics an event's page address without its query string or fragment (#439).
 * Those carry secrets: the token in an /unsubscribe link and the OAuth `code` and `state` on the
 * auth and connection callbacks. The path itself is sent, workspace handle included, and the
 * component reports the route pattern beside it (`/w/[workspace]/timeline`).
 *
 * A cut at the first `?` or `#` rather than a `URL` round trip: `URL.parse` and `URL.canParse` are
 * newer than the browsers Next.js supports (Safari 16.4, node_modules/next/dist/docs/03-architecture/
 * supported-browsers.md), so calling one there throws inside the insights script and drops the view.
 * In an address the query comes before the fragment and neither character appears unencoded in the
 * path, so the first of the two starts whatever follows the path.
 */
export function withoutQueryOrFragment(event: BeforeSendEvent): BeforeSendEvent {
  const end = event.url.search(/[?#]/);
  return end === -1 ? event : { ...event, url: event.url.slice(0, end) };
}

/**
 * Counts page views with Vercel Web Analytics: no cookies, and on Vercel the script and the intake
 * are this origin's own, so the content security policies need no change. A client component
 * because `beforeSend` is a function, which a Server Component cannot pass down. The root documents
 * render it only on Vercel (`onVercel`), so a self-hosted install loads nothing.
 */
export function WebAnalytics() {
  return <Analytics beforeSend={withoutQueryOrFragment} />;
}
