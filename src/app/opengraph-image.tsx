import { ImageResponse } from "next/og";

import { SiteCard } from "@/lib/public-metrics/card-image";
import { SITE_IMAGE } from "@/lib/site-metadata";

/*
 * The site-wide preview image (#338) at /opengraph-image: the landing page's and the docs' Open
 * Graph and Twitter image, and the fallback for a public project page with no published card.
 * The opengraph-image file convention
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/opengraph-image.md):
 * no request data, so it is generated once at build time and served as a static file. Pages name
 * it through SITE_IMAGE rather than relying on the convention's own tags; see src/lib/site-metadata.ts.
 */

export const alt = SITE_IMAGE.alt;
export const size = { width: SITE_IMAGE.width, height: SITE_IMAGE.height };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(<SiteCard />, size);
}
