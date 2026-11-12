import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { connection } from "next/server";

import { connectOrigin } from "@/lib/connections/oauth-state";
import { listSitemapPages } from "@/lib/data/project-pages";
import { legalLinks } from "@/lib/legal";
import { projectPagePath } from "@/lib/public-metrics/project-page";

/*
 * /sitemap.xml: the landing page, the privacy policy and terms of use where this instance names an
 * operator (#339), and every public project page whose owner allows indexing (#150).
 * Read at request time and never cached, so a page that is turned off, asks not to be indexed, or
 * has nothing published left is gone from the next request on. A sitemap needs absolute URLs:
 * NEXT_PUBLIC_SITE_URL when set, otherwise the request's own origin, as the connect routes do.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";
  const origin = connectOrigin(`${protocol}://${host}`, process.env.NEXT_PUBLIC_SITE_URL);
  const pages = await listSitemapPages();
  return [
    { url: new URL("/", origin).href },
    ...legalLinks().map((link) => ({ url: new URL(link.href, origin).href })),
    ...pages.map((page) => ({
      url: new URL(projectPagePath(page.workspace, page.pageSlug), origin).href,
      lastModified: page.updatedAt,
    })),
  ];
}
