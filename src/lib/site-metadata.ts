import type { Metadata, MetadataRoute } from "next";

import { DOCS_ROUTE } from "@/lib/docs";
import { CARD_SIZE } from "@/lib/public-metrics/share";
import { site } from "@/lib/site";

/*
 * What a public page tells search engines and link previews (#338): its own Open Graph and Twitter
 * title, description, address, and image, its canonical address, and the sitemap and robots.txt
 * that list and fence the public pages.
 *
 * Absolute addresses come from NEXT_PUBLIC_SITE_URL, the root layout's `metadataBase`. The public
 * origin is configuration, not code: the domain is not registered yet, and self-hosters serve from
 * their own. Unset means no absolute URLs in page metadata (no canonical, og:url, or image), never
 * a guessed localhost one; the sitemap and robots.txt fall back to the request origin instead,
 * because they cannot list relative addresses.
 */

/** The landing page's title, which every page without its own title also uses: the promise (#305). */
export const LANDING_TITLE = `${site.name} · ${site.headline}`;

/**
 * The site-wide preview image, src/app/opengraph-image.tsx. Next.js serves a root metadata image
 * at this path (node_modules/next/dist/build/webpack/loaders/next-metadata-image-loader.js,
 * fillStaticMetadataSegment). Pages name it explicitly, because a page that sets its own
 * `openGraph` replaces the parent's whole object, image included ("Merging" in
 * node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md).
 */
export const SITE_IMAGE = {
  url: "/opengraph-image",
  ...CARD_SIZE,
  alt: `${site.name}: ${site.headline}`,
} as const;

type SocialImage = Readonly<{ url: string; width: number; height: number; alt: string }>;

/** True when NEXT_PUBLIC_SITE_URL is set, so relative metadata URLs resolve against it. */
function hasSiteUrl(siteUrl: string | undefined): siteUrl is string {
  return siteUrl !== undefined && siteUrl.trim() !== "";
}

/** The root layout's `metadataBase`: NEXT_PUBLIC_SITE_URL, or null when it is not set. */
export function siteMetadataBase(siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL): URL | null {
  return hasSiteUrl(siteUrl) ? new URL(siteUrl) : null;
}

export type SocialPage = Readonly<{
  /** The preview title, without the site name: og:site_name carries it. */
  title: string;
  description: string;
  /**
   * The page's path, relative to the site origin: its canonical address and og:url. The root
   * layout leaves it out, because every page without its own metadata inherits the layout's.
   */
  path?: string;
  /** Preview images; the site image when omitted. */
  images?: readonly SocialImage[];
}>;

/**
 * A public page's canonical address and its Open Graph and Twitter cards, one shared object as the
 * Next.js docs recommend for fields a page overrides ("Merging" in generate-metadata.md). The title
 * and description are the page's own, so a shared link never unfurls with the landing page's.
 */
export function socialMetadata(
  page: SocialPage,
  siteUrl: string | undefined = process.env.NEXT_PUBLIC_SITE_URL,
): Pick<Metadata, "alternates" | "openGraph" | "twitter"> {
  const absolute = hasSiteUrl(siteUrl);
  const path = absolute ? page.path : undefined;
  const images = absolute ? [...(page.images ?? [SITE_IMAGE])] : [];
  return {
    ...(path === undefined ? {} : { alternates: { canonical: path } }),
    openGraph: {
      type: "website",
      siteName: site.name,
      title: page.title,
      description: page.description,
      ...(path === undefined ? {} : { url: path }),
      images,
    },
    twitter: {
      card: images.length > 0 ? "summary_large_image" : "summary",
      title: page.title,
      description: page.description,
      images,
    },
  };
}

/**
 * Public pages that are not data, listed first in the sitemap. A new static public page is added
 * here and nowhere else.
 */
export const STATIC_PUBLIC_PATHS: readonly string[] = ["/", DOCS_ROUTE];

export type SitemapSources = Readonly<{
  /** Paths of the published docs pages. */
  docPaths: readonly string[];
  /** Indexable public project pages, newest change first. */
  projectPages: readonly Readonly<{ path: string; lastModified: Date }>[];
}>;

/** /sitemap.xml's entries: the static public pages, every docs page, then the project pages. */
export function sitemapEntries(origin: string, sources: SitemapSources): MetadataRoute.Sitemap {
  return [
    ...[...STATIC_PUBLIC_PATHS, ...sources.docPaths].map((path) => ({ url: new URL(path, origin).href })),
    ...sources.projectPages.map((page) => ({ url: new URL(page.path, origin).href, lastModified: page.lastModified })),
  ];
}

/**
 * Paths no crawler needs: the signed-in app, the API, the account page, and the auth and OAuth
 * routes. Badges and cards stay allowed, since link previews fetch them.
 */
export const ROBOTS_DISALLOW: readonly string[] = ["/w/", "/app", "/api/", "/auth/", "/account", "/oauth"];

/** /robots.txt: everything public is allowed, the signed-in paths are not, and the sitemap is named. */
export function robotsRules(origin: string): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: [...ROBOTS_DISALLOW] },
    sitemap: new URL("/sitemap.xml", origin).href,
  };
}
