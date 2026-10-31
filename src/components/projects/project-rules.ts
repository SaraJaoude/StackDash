import { z } from "zod";

/**
 * Project rules shared by the Server Actions, the forms, and the data layer. Plain module (no
 * `server-only`) so the copy and validation are unit tested and identical on both sides.
 */

// Mirrors the database check `char_length(btrim(name)) between 1 and 80`. Counted in code points,
// not UTF-16 units, so a name with emoji is measured the way Postgres measures it.
export const PROJECT_NAME_MAX = 80;

export const projectNameSchema = z
  .string()
  .trim()
  .min(1, "Enter a project name.")
  .refine((name) => [...name].length <= PROJECT_NAME_MAX, {
    message: `Use ${PROJECT_NAME_MAX} characters or fewer.`,
  });

export const DUPLICATE_PROJECT_NAME = "A project with this name already exists.";

/** What deleting one project changes, counted before the owner confirms. */
export type ProjectDeletionImpact = {
  accountCount: number;
  budgetCount: number;
  alertRuleCount: number;
};

export function accountCountLabel(count: number): string {
  if (count === 0) return "No accounts assigned";
  return count === 1 ? "1 account assigned" : `${count} accounts assigned`;
}

/** One sentence per consequence, in the order the delete dialog lists them. */
export function deletionConsequences(impact: ProjectDeletionImpact): string[] {
  const { accountCount, budgetCount, alertRuleCount } = impact;
  return [
    accountCount === 0
      ? "No accounts are assigned to this project, so no accounts change."
      : accountCount === 1
        ? "1 assigned account becomes unassigned and keeps its history."
        : `${accountCount} assigned accounts become unassigned and keep their history.`,
    budgetCount === 0
      ? "No budgets are scoped to this project."
      : budgetCount === 1
        ? "1 budget scoped to this project is deleted."
        : `${budgetCount} budgets scoped to this project are deleted.`,
    alertRuleCount === 0
      ? "No alert rules are scoped to this project or its budgets."
      : alertRuleCount === 1
        ? "1 alert rule scoped to this project or its budgets is deleted."
        : `${alertRuleCount} alert rules scoped to this project or its budgets are deleted.`,
  ];
}

type BudgetRef = { id: string; project_id: string | null };
type AlertRuleRef = { id: string; project_id: string | null; budget_id: string | null };

/**
 * Counts, per project, the budgets and alert rules a delete removes by cascade. A rule goes when
 * it is scoped to the project or belongs to one of the project's budgets; a rule that is both is
 * counted once.
 */
export function countDeletionCascades(
  budgets: readonly BudgetRef[],
  alertRules: readonly AlertRuleRef[],
): Map<string, { budgetCount: number; alertRuleCount: number }> {
  const projectByBudget = new Map<string, string>();
  const counts = new Map<string, { budgetCount: number; alertRuleCount: number }>();
  const entry = (projectId: string) => {
    let current = counts.get(projectId);
    if (current === undefined) {
      current = { budgetCount: 0, alertRuleCount: 0 };
      counts.set(projectId, current);
    }
    return current;
  };

  for (const budget of budgets) {
    if (budget.project_id === null) continue;
    projectByBudget.set(budget.id, budget.project_id);
    entry(budget.project_id).budgetCount += 1;
  }

  for (const rule of alertRules) {
    const projects = new Set<string>();
    if (rule.project_id !== null) projects.add(rule.project_id);
    const budgetProject = rule.budget_id === null ? undefined : projectByBudget.get(rule.budget_id);
    if (budgetProject !== undefined) projects.add(budgetProject);
    for (const projectId of projects) entry(projectId).alertRuleCount += 1;
  }

  return counts;
}
