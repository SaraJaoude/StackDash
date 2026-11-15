"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";

/**
 * Sends Vercel Web Analytics an event's page address without its query string or fragment (#439).
 * Those carry secrets: the token in an /unsubscribe link and the OAuth `code` and `state` on the
 * auth and connection callbacks. The path itself is sent, workspace handle included, and the
 * component reports the route pattern beside it (`/w/[workspace]/timeline`). An address that does
 * not parse is dropped rather than sent as it is.
 */
export function withoutQueryOrFragment(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = URL.parse(event.url);
  if (url === null) return null;
  url.search = "";
  url.hash = "";
  return { ...event, url: url.href };
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
