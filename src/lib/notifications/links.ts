import { connectOrigin } from "@/lib/connections/oauth-state";

import type { WorkspaceLinks } from "./notice";

/*
 * Absolute links for messages sent from a job (#152), where there is no request to take an origin
 * from. NEXT_PUBLIC_SITE_URL is the instance's public origin, as for provider callbacks.
 */

// What `npm run dev` serves; only used when NEXT_PUBLIC_SITE_URL is not set outside production.
export const LOCAL_ORIGIN = "http://localhost:3000";

/** The origin links in messages use. A production instance without NEXT_PUBLIC_SITE_URL is misconfigured. */
export function messageOrigin(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const site = env.NEXT_PUBLIC_SITE_URL;
  if ((site === undefined || site.trim() === "") && env.NODE_ENV === "production") {
    throw new Error("NEXT_PUBLIC_SITE_URL is not set, so alert messages cannot link back to this instance.");
  }
  return connectOrigin(LOCAL_ORIGIN, site);
}

export function workspaceLinks(origin: string, slug: string): WorkspaceLinks {
  return {
    alerts: new URL(`/w/${slug}/alerts`, origin).href,
    connections: new URL(`/w/${slug}/connections`, origin).href,
    timeline: new URL(`/w/${slug}/timeline`, origin).href,
  };
}

/** The member's email setting on the alerts page. The fragment is the section's heading id. */
export const ALERT_EMAILS_SECTION_ID = "alert-emails";

export function emailPreferenceUrl(origin: string, slug: string): string {
  return new URL(`/w/${slug}/alerts#${ALERT_EMAILS_SECTION_ID}`, origin).href;
}

export const UNSUBSCRIBE_PAGE_PATH = "/unsubscribe";
export const UNSUBSCRIBE_ONE_CLICK_PATH = "/api/notifications/unsubscribe";

/** The page with the unsubscribe button, and the RFC 8058 one-click endpoint, for one token. */
export function unsubscribeUrls(origin: string, token: string): { page: string; oneClick: string } {
  const query = new URLSearchParams({ token }).toString();
  return {
    page: new URL(`${UNSUBSCRIBE_PAGE_PATH}?${query}`, origin).href,
    oneClick: new URL(`${UNSUBSCRIBE_ONE_CLICK_PATH}?${query}`, origin).href,
  };
}
