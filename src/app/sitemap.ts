import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { requestPublicOrigin } from "@/lib/connections/oauth-state";
import { listSitemapPages } from "@/lib/data/project-pages";
import { listDocs } from "@/lib/docs";
import { legalPages } from "@/lib/legal";
import { projectPagePath } from "@/lib/public-metrics/project-page";
import { sitemapEntries } from "@/lib/site-metadata";

/*
 * /sitemap.xml: the static public pages, every docs page (#338), the privacy policy and terms of
 * use where this instance names an operator (#339) with the date each last changed, and every
 * public project page whose owner allows indexing (#150). Read at request time and never cached, so
 * a page that is turned off, asks not to be indexed, or has nothing published left is gone from the
 * next request on. A sitemap needs absolute URLs: NEXT_PUBLIC_SITE_URL when set, otherwise the
 * request's own origin, as the connect routes do.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const [origin, pages] = await Promise.all([requestPublicOrigin(), listSitemapPages()]);
  return sitemapEntries(origin, {
    docPaths: listDocs().map((doc) => doc.href),
    legalPages: legalPages().map(({ link, updated }) => ({ path: link.href, lastModified: updated })),
    projectPages: pages.map((page) => ({
      path: projectPagePath(page.workspace, page.pageSlug),
      lastModified: page.updatedAt,
    })),
  });
}
