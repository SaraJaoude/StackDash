import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { requestPublicOrigin } from "@/lib/connections/oauth-state";
import { robotsRules } from "@/lib/site-metadata";

/*
 * /robots.txt (#338): public pages allowed, the signed-in app and its plumbing disallowed, and the
 * sitemap named by its absolute URL, from the same origin as the sitemap's own addresses. That
 * origin can be the request's, so this renders per request like the sitemap.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  await connection();
  return robotsRules(await requestPublicOrigin());
}
