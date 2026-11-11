import "server-only";

import { createSupabaseMetricStore } from "@/lib/public-metrics/supabase-store";
import { computeYearReview, type YearReview, type YearSlideId } from "@/lib/public-metrics/yearly";
import { createClient } from "@/lib/supabase/server";

/*
 * The year in review's figures for one workspace (#151, slides #262). Reads run as the signed-in
 * member, so row level security limits them to workspaces they belong to, and the review's counting
 * functions check membership themselves; the caller has checked membership too. Each surface (the
 * year page and its slide image route) calls it once per request; the image route asks for its one
 * slide, so it skips the reads the others need.
 */

export async function loadYearReview(workspaceId: string, year: number, now: Date, slides?: readonly YearSlideId[]): Promise<YearReview> {
  const supabase = await createClient();
  return computeYearReview(createSupabaseMetricStore(supabase, workspaceId, null), year, now, slides);
}
