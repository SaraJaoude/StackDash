import { connection } from "next/server";

import { getCurrentUser } from "@/lib/auth/session";
import { loadYearSummary } from "@/lib/data/year-summary";
import { getWorkspaceMembership } from "@/lib/data/workspaces";
import { logError } from "@/lib/log/logger";
import { cardImageResponse, NoticeCard, YearCard } from "@/lib/public-metrics/card-image";
import { parseCardYear } from "@/lib/public-metrics/yearly";
import { isWorkspaceSlug } from "@/lib/workspaces/paths";

/*
 * GET /w/<workspace>/year/<year>/card.png (#151): the yearly card as a 1200 by 630 PNG, a past
 * year in full or the current year to date, for the members of the workspace only. It is private
 * until a member downloads it and posts it: never cached by a shared cache, and the same 404 for a
 * stranger, a missing workspace, and a year that has not started, so the route reveals nothing.
 */

const PRIVATE_HEADERS = { "Cache-Control": "private, no-store" };

function notFound(): Response {
  return new Response("Not found", { status: 404, headers: { ...PRIVATE_HEADERS, "Content-Type": "text/plain; charset=utf-8" } });
}

export async function GET(_request: Request, ctx: RouteContext<"/w/[workspace]/year/[year]/card.png">) {
  await connection();
  const { workspace: slug, year: yearParam } = await ctx.params;
  const now = new Date();
  const year = parseCardYear(yearParam, now);
  if (!isWorkspaceSlug(slug) || year === null) return notFound();

  try {
    const user = await getCurrentUser();
    if (user === null) return notFound();
    const membership = await getWorkspaceMembership(user.id, slug);
    if (membership === null) return notFound();
    const summary = await loadYearSummary(membership.workspace.id, year, now);
    return cardImageResponse(<YearCard summary={summary} />, { headers: PRIVATE_HEADERS });
  } catch (error) {
    logError("year_card.render_failed", error);
    return cardImageResponse(<NoticeCard title="Temporarily unavailable" body="Try again in a moment." />, {
      status: 503,
      headers: PRIVATE_HEADERS,
    });
  }
}
