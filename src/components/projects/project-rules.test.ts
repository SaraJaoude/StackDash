import { describe, expect, it } from "vitest";

import {
  accountCountLabel,
  countDeletionCascades,
  deletionConsequences,
  projectNameSchema,
} from "@/components/projects/project-rules";

describe("projectNameSchema", () => {
  it("accepts a name and trims surrounding whitespace", () => {
    expect(projectNameSchema.parse("  Acme web  ")).toBe("Acme web");
  });

  it("rejects an empty or whitespace-only name (boundary: 0 characters)", () => {
    const result = projectNameSchema.safeParse("   ");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Enter a project name.");
  });

  it("accepts exactly 80 characters and rejects 81 (boundary)", () => {
    expect(projectNameSchema.safeParse("a".repeat(80)).success).toBe(true);
    const result = projectNameSchema.safeParse("a".repeat(81));
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Use 80 characters or fewer.");
  });

  it("counts emoji as one character each, the way Postgres does (boundary: 80 code points)", () => {
    expect(projectNameSchema.safeParse("🚀".repeat(80)).success).toBe(true);
    expect(projectNameSchema.safeParse("🚀".repeat(81)).success).toBe(false);
  });
});

describe("accountCountLabel", () => {
  it("names zero, one, and many accounts (boundary: 0 and 1)", () => {
    expect(accountCountLabel(0)).toBe("No accounts assigned");
    expect(accountCountLabel(1)).toBe("1 account assigned");
    expect(accountCountLabel(12)).toBe("12 accounts assigned");
  });
});

describe("deletionConsequences", () => {
  it("lists the numbers for accounts, budgets, and alert rules", () => {
    expect(deletionConsequences({ accountCount: 3, budgetCount: 2, alertRuleCount: 4 })).toEqual([
      "3 assigned accounts become unassigned and keep their history.",
      "2 budgets scoped to this project are deleted.",
      "4 alert rules scoped to this project or its budgets are deleted.",
    ]);
  });

  it("uses the singular for one of each (boundary: 1)", () => {
    expect(deletionConsequences({ accountCount: 1, budgetCount: 1, alertRuleCount: 1 })).toEqual([
      "1 assigned account becomes unassigned and keeps its history.",
      "1 budget scoped to this project is deleted.",
      "1 alert rule scoped to this project or its budgets is deleted.",
    ]);
  });

  it("still explains each consequence when nothing is affected (boundary: 0)", () => {
    expect(deletionConsequences({ accountCount: 0, budgetCount: 0, alertRuleCount: 0 })).toEqual([
      "No accounts are assigned to this project, so no accounts change.",
      "No budgets are scoped to this project.",
      "No alert rules are scoped to this project or its budgets.",
    ]);
  });
});

describe("countDeletionCascades", () => {
  it("counts budgets and rules per project, including rules on the project's budgets", () => {
    const counts = countDeletionCascades(
      [
        { id: "b1", project_id: "p1" },
        { id: "b2", project_id: "p1" },
        { id: "b3", project_id: "p2" },
      ],
      [
        { id: "r1", project_id: "p1", budget_id: null },
        { id: "r2", project_id: null, budget_id: "b3" },
        { id: "r3", project_id: null, budget_id: "b1" },
      ],
    );
    expect(counts.get("p1")).toEqual({ budgetCount: 2, alertRuleCount: 2 });
    expect(counts.get("p2")).toEqual({ budgetCount: 1, alertRuleCount: 1 });
  });

  it("counts a rule once when it is scoped to the project and on one of its budgets", () => {
    const counts = countDeletionCascades(
      [{ id: "b1", project_id: "p1" }],
      [{ id: "r1", project_id: "p1", budget_id: "b1" }],
    );
    expect(counts.get("p1")).toEqual({ budgetCount: 1, alertRuleCount: 1 });
  });

  it("counts a rule against both projects when its scope and its budget differ", () => {
    const counts = countDeletionCascades(
      [{ id: "b1", project_id: "p2" }],
      [{ id: "r1", project_id: "p1", budget_id: "b1" }],
    );
    expect(counts.get("p1")).toEqual({ budgetCount: 0, alertRuleCount: 1 });
    expect(counts.get("p2")).toEqual({ budgetCount: 1, alertRuleCount: 1 });
  });

  it("ignores workspace budgets and rules with no project (boundary: empty input)", () => {
    expect(countDeletionCascades([], []).size).toBe(0);
    const counts = countDeletionCascades(
      [{ id: "b1", project_id: null }],
      [{ id: "r1", project_id: null, budget_id: "b1" }],
    );
    expect(counts.size).toBe(0);
  });
});
