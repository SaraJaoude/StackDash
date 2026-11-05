import { connection } from "next/server";
import { z } from "zod";

import { logError } from "@/lib/log/logger";
import { badgeContent, RATE_LIMITED_BADGE, renderBadgeSvg, UNAVAILABLE_BADGE, type BadgeContent } from "@/lib/public-metrics/badge";
import { loadPublishedMetric } from "@/lib/public-metrics/published";
import {
  checkPublicRateLimit,
  countViewAfterResponse,
  NO_STORE,
  PUBLIC_CACHE_CONTROL,
  rateLimitedHeaders,
} from "@/lib/public-metrics/requests";
import { metricIdFromFile } from "@/lib/public-metrics/share";

/*
 * GET /badge/<project id>/<metric id>.svg (#149): the live badge of a published metric, for a
 * README or any page. Reads the value through the public engine (loadPublishedMetric), so it shows
 * exactly what the JSON route of #148 shows, and never spend, budgets, alerts, or names.
 *
 * A project that does not exist, a metric that is not published or was unpublished, and a
 * malformed id all get the same neutral "Unpublished" badge with a 200, rather than a 404 that
 * would tell a stranger which projects exist; an embed then shows "Unpublished" instead of a broken
 * image. The one minute cache (requests.ts) bounds how long an unpublished value can still show.
 *
 * Safe to embed anywhere: outside the proxy matcher, so no session is read and no cookie is set;
 * an SVG with text only (badge.ts); its own CSP so that, opened directly, it can load and run
 * nothing; and Cross-Origin-Resource-Policy so other sites may load it as an image.
 */

const ProjectIdSchema = z.guid();

const SVG_HEADERS = {
  "Content-Type": "image/svg+xml; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

function svgResponse(content: BadgeContent, status: number, headers: Record<string, string>): Response {
  return new Response(renderBadgeSvg(content), { status, headers: { ...SVG_HEADERS, ...headers } });
}

export async function GET(request: Request, ctx: RouteContext<"/badge/[projectId]/[file]">) {
  // The answer depends on the clock and the database, so it is always rendered at request time.
  await connection();
  const { projectId, file } = await ctx.params;

  try {
    const now = new Date();
    const limit = await checkPublicRateLimit(request.headers, now);
    if (!limit.allowed) return svgResponse(RATE_LIMITED_BADGE, 429, rateLimitedHeaders(limit));

    const metricId = metricIdFromFile(file, "svg");
    const metric =
      metricId === null || !ProjectIdSchema.safeParse(projectId).success ? null : await loadPublishedMetric(projectId, metricId, now);
    if (metric !== null) countViewAfterResponse(projectId, metric.metricId, "badge");
    return svgResponse(badgeContent(metric), 200, { "Cache-Control": PUBLIC_CACHE_CONTROL });
  } catch (error) {
    logError("public_metrics.badge_failed", error);
    return svgResponse(UNAVAILABLE_BADGE, 503, { "Cache-Control": NO_STORE });
  }
}
