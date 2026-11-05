import { connection } from "next/server";
import { z } from "zod";

import { logError } from "@/lib/log/logger";
import { loadPublishedProjectMetrics, type PublishedMetric } from "@/lib/public-metrics/published";

/*
 * GET /api/public/projects/<projectId>/metrics (#148): the metrics a project has published, as
 * JSON, for anyone. Live publications only (public_published_metrics), each value computed from
 * stored snapshots and events. No account, repository, or provider account names, and no money.
 *
 * Caching: one minute in browsers and shared caches, so an unpublished metric stops showing within
 * a minute (#149's acceptance bound) while an embed polled by many readers is computed about once a
 * minute per cache. Not prerendered: every response reads the database at request time.
 */

const CACHE_CONTROL = "public, max-age=60, s-maxage=60";
// `guid`, not `uuid`: fixtures use hand-written ids that skip the RFC version bits.
const ProjectIdSchema = z.guid();

// One answer for a malformed id, an unknown project, and a project with nothing published, so the
// route never reveals which projects exist.
function notFound(): Response {
  return Response.json(
    { error: "not_found", message: "Nothing is published for this project." },
    { status: 404, headers: { "Cache-Control": CACHE_CONTROL } },
  );
}

function serialize(metric: PublishedMetric) {
  if (metric.kind === "self_reported") {
    return {
      kind: metric.kind,
      label: metric.label,
      provenance: metric.provenance,
      value: metric.value,
      unit: metric.unit,
      text: metric.text,
      publishedAt: metric.publishedAt.toISOString(),
    };
  }
  const { value } = metric;
  return {
    kind: metric.kind,
    id: metric.metricId,
    label: metric.label,
    provenance: metric.provenance,
    unit: metric.unit,
    formulaUrl: metric.formulaPath,
    rounding: metric.rounding,
    delayDays: metric.delayDays,
    asOf: metric.asOf.toISOString(),
    publishedAt: metric.publishedAt.toISOString(),
    ...(value.status === "available"
      ? {
          status: value.status,
          value: value.value,
          atLeast: value.atLeast,
          text: value.text,
          lastSyncedAt: value.lastSyncedAt.toISOString(),
          simulated: value.simulated,
        }
      : { status: value.status, reason: value.reason, text: value.text }),
  };
}

export async function GET(_request: Request, ctx: RouteContext<"/api/public/projects/[projectId]/metrics">) {
  // The answer depends on the clock and the database, so it is always rendered at request time.
  await connection();
  const { projectId } = await ctx.params;
  if (!ProjectIdSchema.safeParse(projectId).success) return notFound();

  try {
    const published = await loadPublishedProjectMetrics(projectId, new Date());
    if (published === null) return notFound();
    return Response.json(
      { projectId: published.projectId, metrics: published.metrics.map(serialize) },
      { headers: { "Cache-Control": CACHE_CONTROL } },
    );
  } catch (error) {
    const referenceId = logError("public_metrics.read_failed", error);
    return Response.json(
      { error: "unavailable", message: "Published metrics could not be read. Try again in a moment.", referenceId },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
