import "server-only";

import { cache } from "react";

import { countDeletionCascades, type ProjectDeletionImpact } from "@/components/projects/project-rules";
import type { Database } from "@/lib/supabase/database.types";
import { createClient } from "@/lib/supabase/server";

type ProjectRow = Database["public"]["Tables"]["projects"]["Row"];

/** The page lists at most this many projects; the MVP expects a handful per workspace. */
export const PROJECTS_LIMIT = 100;

// Budgets and alert rules are counted only to explain a delete. A workspace with 100 projects
// holds far fewer project-scoped budgets and rules than this; past it the counts would be low, so
// the cap is deliberately generous rather than paginated.
const CASCADE_ROWS_LIMIT = 1000;

export type ProjectSummary = Pick<ProjectRow, "id" | "name"> & ProjectDeletionImpact;

export type ProjectList = {
  projects: ProjectSummary[];
  /** True when the workspace has more than `PROJECTS_LIMIT` projects and some are not shown. */
  hasMore: boolean;
};

/**
 * Projects in the workspace ordered by name, each with how many external accounts are assigned
 * to it (one grouped count in the same query) and how many budgets and alert rules a delete would
 * remove. Reads run as the signed-in user, so row level security limits them to members.
 */
export const listProjects = cache(async (workspaceId: string): Promise<ProjectList> => {
  const supabase = await createClient();
  const [projectsResult, budgetsResult] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name, external_accounts(count)")
      .eq("workspace_id", workspaceId)
      .order("name", { ascending: true })
      .order("id", { ascending: true })
      // One extra row tells whether the list was cut off.
      .limit(PROJECTS_LIMIT + 1),
    supabase
      .from("budgets")
      .select("id, project_id")
      .eq("workspace_id", workspaceId)
      .not("project_id", "is", null)
      .limit(CASCADE_ROWS_LIMIT),
  ]);
  if (projectsResult.error) throw new Error("Failed to list projects", { cause: projectsResult.error });
  if (budgetsResult.error) throw new Error("Failed to list project budgets", { cause: budgetsResult.error });

  const budgets = budgetsResult.data;
  // Rules scoped to a project, plus budget rules on a project's budget (removed with the budget).
  // Budget ids come from the database, so they are safe inside the PostgREST filter.
  const ruleFilter =
    budgets.length === 0
      ? "project_id.not.is.null"
      : `project_id.not.is.null,budget_id.in.(${budgets.map((budget) => budget.id).join(",")})`;
  const { data: alertRules, error: rulesError } = await supabase
    .from("alert_rules")
    .select("id, project_id, budget_id")
    .eq("workspace_id", workspaceId)
    .or(ruleFilter)
    .limit(CASCADE_ROWS_LIMIT);
  if (rulesError) throw new Error("Failed to list project alert rules", { cause: rulesError });

  const cascades = countDeletionCascades(budgets, alertRules);
  const rows = projectsResult.data;
  const projects = rows.slice(0, PROJECTS_LIMIT).map((row) => {
    const cascade = cascades.get(row.id);
    return {
      id: row.id,
      name: row.name,
      accountCount: row.external_accounts[0]?.count ?? 0,
      budgetCount: cascade?.budgetCount ?? 0,
      alertRuleCount: cascade?.alertRuleCount ?? 0,
    };
  });
  return { projects, hasMore: rows.length > PROJECTS_LIMIT };
});
