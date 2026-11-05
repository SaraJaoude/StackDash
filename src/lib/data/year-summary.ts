import "server-only";

import { cache } from "react";

import { createSupabaseMetricStore } from "@/lib/public-metrics/supabase-store";
import { computeYearSummary, type YearSummary } from "@/lib/public-metrics/yearly";
import { createClient } from "@/lib/supabase/server";

/*
 * The yearly card's figures for one workspace (#151). Reads run as the signed-in member, so row
 * level security limits them to workspaces they belong to; the caller has checked membership.
 * Cached per request, so the page and its metadata share one computation.
 */

export const loadYearSummary = cache(async (workspaceId: string, year: number, now: Date): Promise<YearSummary> => {
  const supabase = await createClient();
  return computeYearSummary(createSupabaseMetricStore(supabase, workspaceId, null), year, now);
});
