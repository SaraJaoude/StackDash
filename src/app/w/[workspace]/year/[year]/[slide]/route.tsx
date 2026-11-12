import { connection } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { loadYearReview } from "@/lib/data/year-review";
import { getWorkspaceMembership } from "@/lib/data/workspaces";
import { logError } from "@/lib/log/logger";
import { cardImageResponse, NoticeCard, YearCard, YearSlideCard } from "@/lib/public-metrics/card-image";
import { parseCardYear, parseYearSlideFile, yearSlides } from "@/lib/public-metrics/yearly";
import { isWorkspaceSlug } from "@/lib/workspaces/paths";

/*
 * GET /w/<workspace>/year/<year>/<slide>.png: one slide of the year in review (#262) as a 1200 by
 * 630 PNG, with the same figure the page shows, for the members of the workspace only. The totals
 * slide keeps the yearly card's address, card.png (#151); the others are busiest-day.png,
 * deployment-run.png, and top-provider.png (`yearSlideFile`). A slide is private until a member
 * downloads it and posts it: never cached by a shared cache, and the same 404 for a stranger, a
 * missing workspace, an unknown slide, and a year that has not started, so the route reveals
 * nothing.
 */

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(_request: Request, ctx: RouteContext<"/w/[workspace]/year/[year]/[slide]">) {
  await connection();
  const { workspace: slug, year: yearParam, slide: slideParam } = await ctx.params;
  const now = new Date();
  const year = parseCardYear(yearParam, now);
  const slideId = parseYearSlideFile(slideParam);
  if (!isWorkspaceSlug(slug) || year === null || slideId === null) return notFound();

  try {
    const user = await getCurrentUser();
    if (user === null) return notFound();
    const membership = await getWorkspaceMembership(user.id, slug);
    if (membership === null) return notFound();
    // Only this slide's reads: the totals image never runs the year's event counts.
    const review = await loadYearReview(membership.workspace.id, year, now, [slideId]);
    const slide = yearSlides(review).find((candidate) => candidate.id === slideId);
    if (slide === undefined) throw new Error(`The year in review has no slide ${slideId}`);
    const card = slide.id === "totals" ? <YearCard summary={review.summary} /> : <YearSlideCard summary={review.summary} slide={slide} />;
    return cardImageResponse(card, { headers: PRIVATE_HEADERS });
  } catch (error) {
    logError("year_slide.render_failed", error);
    return cardImageResponse(<NoticeCard title="Temporarily unavailable" body="Try again in a moment." />, {
      status: 503,
      headers: PRIVATE_HEADERS,
    });
  }
}
