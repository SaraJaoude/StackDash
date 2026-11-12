import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";
import { expectFailureInDialog } from "./fixtures/dialogs";

// Each test creates its own workspace and seeds only inside it, so tests run in any order.

async function seedProject(workspace: TestWorkspace, name: string): Promise<string> {
  const { data, error } = await adminClient()
    .from("projects")
    .insert({ workspace_id: workspace.id, name })
    .select("id")
    .single();
  if (error) throw new Error(`Seeding a project failed (code ${error.code}).`);
  return data.id;
}

/** A connection with one account assigned to the project, plus a project budget and its rule. */
async function seedProjectDependents(workspace: TestWorkspace, projectId: string) {
  const admin = adminClient();
  const { data: connection, error: connectionError } = await admin
    .from("connections")
    .insert({ workspace_id: workspace.id, provider: "fake", display_name: "Fake", poll_interval_seconds: 3600 })
    .select("id")
    .single();
  if (connectionError) throw new Error(`Seeding a connection failed (code ${connectionError.code}).`);

  const { data: account, error: accountError } = await admin
    .from("external_accounts")
    .insert({
      workspace_id: workspace.id,
      connection_id: connection.id,
      external_id: "acct_projects_e2e",
      display_name: "Fake account",
      kind: "account",
      project_id: projectId,
    })
    .select("id")
    .single();
  if (accountError) throw new Error(`Seeding an account failed (code ${accountError.code}).`);

  const { data: budget, error: budgetError } = await admin
    .from("budgets")
    .insert({
      workspace_id: workspace.id,
      name: "Project budget",
      scope: "project",
      project_id: projectId,
      amount_minor: 10_000,
      currency: "USD",
    })
    .select("id")
    .single();
  if (budgetError) throw new Error(`Seeding a budget failed (code ${budgetError.code}).`);

  const { error: ruleError } = await admin.from("alert_rules").insert({
    workspace_id: workspace.id,
    kind: "budget_percent",
    scope: "project",
    project_id: projectId,
    budget_id: budget.id,
    threshold_percent: 80,
  });
  if (ruleError) throw new Error(`Seeding an alert rule failed (code ${ruleError.code}).`);

  return { accountId: account.id };
}

/** Rows of the project list, scoped so navigation lists never match. */
function projectRows(page: Page): Locator {
  return page.getByRole("region", { name: "All projects" }).getByRole("listitem");
}

ownerTest.describe("managing projects as the owner", () => {
  ownerTest("creates the first project from the focused empty state form", async ({ page }) => {
    const workspace = await createTestWorkspace("Projects create");
    try {
      await page.goto(`/w/${workspace.slug}/projects`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Projects");
      await expect(page.getByRole("heading", { name: "Create your first project" })).toBeVisible();

      const field = page.getByLabel("Project name", { exact: true });
      await expect(field).toBeFocused();
      await field.fill("  Acme web  ");
      await page.getByRole("button", { name: "Create project" }).click();

      await expect(page.getByRole("status").filter({ hasText: "Created project Acme web." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "All projects" })).toBeFocused();
      const row = projectRows(page).filter({ hasText: "Acme web" });
      await expect(row).toContainText("No accounts assigned");

      await page.reload();
      await expect(projectRows(page).filter({ hasText: "Acme web" })).toBeVisible();
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("renames a project, and Escape cancels a rename", async ({ page }) => {
    const workspace = await createTestWorkspace("Projects rename");
    try {
      await seedProject(workspace, "Old name");
      await page.goto(`/w/${workspace.slug}/projects`);

      await page.getByRole("button", { name: "Rename Old name" }).click();
      const field = page.getByLabel("New name for Old name");
      await expect(field).toBeFocused();
      await page.keyboard.press("Escape");
      await expect(field).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Rename Old name" })).toBeFocused();

      await page.getByRole("button", { name: "Rename Old name" }).click();
      await page.getByLabel("New name for Old name").fill("New name");
      await page.getByRole("button", { name: "Save name" }).click();

      await expect(page.getByRole("status").filter({ hasText: "Renamed Old name to New name." })).toBeVisible();
      await expect(page.getByRole("button", { name: "Rename New name" })).toBeFocused();

      await page.reload();
      await expect(page.getByRole("button", { name: "Rename New name" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Rename Old name" })).toHaveCount(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("rejects a name that differs from an existing one only by case", async ({ page }) => {
    const workspace = await createTestWorkspace("Projects duplicate");
    try {
      await seedProject(workspace, "Acme");
      await page.goto(`/w/${workspace.slug}/projects`);

      const field = page.getByLabel("Project name", { exact: true });
      await field.fill("  acme  ");
      await page.getByRole("button", { name: "Create project" }).click();

      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toHaveAccessibleDescription(/A project with this name already exists\./);
      await expect(
        page.getByRole("link", { name: "The project was not created. A project with this name already exists." }),
      ).toBeVisible();
      // The rejected value stays in the field so it can be corrected.
      await expect(field).toHaveValue("  acme  ");
      await expect(projectRows(page)).toHaveCount(1);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("explains the consequences, then deletes and keeps the account", async ({ page }) => {
    const workspace = await createTestWorkspace("Projects delete");
    try {
      const projectId = await seedProject(workspace, "Billing");
      const { accountId } = await seedProjectDependents(workspace, projectId);
      await page.goto(`/w/${workspace.slug}/projects`);
      await expect(projectRows(page).filter({ hasText: "Billing" })).toContainText("1 account assigned");

      const trigger = page.getByRole("button", { name: "Delete Billing" });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: "Delete Billing?" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("1 assigned account becomes unassigned and keeps its history.");
      await expect(dialog).toContainText("1 budget scoped to this project is deleted.");
      await expect(dialog).toContainText("1 alert rule scoped to this project or its budgets is deleted.");
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();

      await trigger.click();
      await dialog.getByRole("button", { name: "Delete project" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Deleted project Billing." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Create your first project" })).toBeVisible();

      const admin = adminClient();
      const { data: account, error } = await admin
        .from("external_accounts")
        .select("project_id")
        .eq("id", accountId)
        .single();
      if (error) throw new Error(`Reading the account failed (code ${error.code}).`);
      expect(account.project_id).toBeNull();
      const { count, error: budgetError } = await admin
        .from("budgets")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id);
      if (budgetError) throw new Error(`Counting budgets failed (code ${budgetError.code}).`);
      expect(count).toBe(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("shows a failed delete inside the open dialog", async ({ page }) => {
    const workspace = await createTestWorkspace("Projects delete failure");
    try {
      const projectId = await seedProject(workspace, "Billing");
      await page.goto(`/w/${workspace.slug}/projects`);
      await expectFailureInDialog(page, {
        trigger: page.getByRole("button", { name: "Delete Billing" }),
        dialog: page.getByRole("dialog", { name: "Delete Billing?" }),
        confirmName: "Delete project",
        // Deleted behind the open dialog, so the action finds nothing to delete.
        breakIt: async () => {
          const { error } = await adminClient().from("projects").delete().eq("id", projectId);
          if (error) throw new Error(`Deleting the project failed (code ${error.code}).`);
        },
        message: "This project no longer exists. Reload the page to see the current list.",
      });
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest.describe("projects as a viewer", () => {
  viewerTest("lists projects and explains why there is no form", async ({ page }) => {
    const workspace = await createTestWorkspace("Projects viewer");
    try {
      await seedProject(workspace, "Visible to viewers");
      await page.goto(`/w/${workspace.slug}/projects`);

      await expect(projectRows(page).filter({ hasText: "Visible to viewers" })).toBeVisible();
      await expect(page.getByText("Only owners and admins can create, rename, or delete projects.")).toBeVisible();
      await expect(page.getByLabel("Project name", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Create project" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: /^(Rename|Delete) / })).toHaveCount(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
