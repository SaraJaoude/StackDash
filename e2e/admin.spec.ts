import { test } from "@playwright/test";

import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { expectNoAxeViolations } from "./fixtures/axe";
import { adminClient, createTestWorkspace, cronSecret, deleteTestWorkspace } from "./fixtures/db";

// playwright.config.ts names the e2e owner, and only the owner, in DEVMACRO_SUPER_ADMIN_EMAILS.

ownerTest.describe("the instance overview as a super admin", () => {
  ownerTest("shows each section, counts a new workspace's members and events, and never shows a secret", async ({ page }) => {
    const workspace = await createTestWorkspace("Instance overview");
    try {
      const { error } = await adminClient()
        .from("activity_events")
        .insert(
          [1, 2, 3].map((n) => ({
            workspace_id: workspace.id,
            type_id: "devmacro.daily_summary",
            severity: "info" as const,
            title: "Daily summary",
            occurred_at: new Date(Date.UTC(2026, 10, n)).toISOString(),
            dedupe_key: `admin-overview-${workspace.id}-${n}`,
          })),
        );
      if (error) throw new Error(`Seeding events failed (code ${error.code}).`);

      const response = await page.goto("/app/admin");
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle("Instance overview · DevMacro");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Instance overview");
      for (const section of ["Usage", "Configuration", "Providers", "Background jobs", "Workspaces", "Deployment"]) {
        await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
      }

      // Newest first, so the workspace this test just made is on the first page: two members
      // (owner and viewer), no connections, three events.
      const row = page.getByRole("region", { name: "Workspace figures" }).getByRole("row").filter({ hasText: workspace.name });
      await expect(row.getByRole("cell")).toHaveText([/./, "2", "0", "3"]);

      const settings = page.getByRole("region", { name: "Settings" });
      await expect(settings.getByRole("row", { name: /Scheduler secret/ })).toContainText("Set");
      await expect(settings.getByRole("row", { name: /Simulated providers/ })).toContainText("On");
      expect(await page.content()).not.toContain(cronSecret());

      await expectNoAxeViolations(page);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest("a signed-in user who is not a super admin gets page not found", async ({ page }) => {
  const response = await page.goto("/app/admin");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found · DevMacro");
  await expect(page.getByRole("heading", { level: 1, name: "We could not find that page" })).toBeVisible();
  await expect(page.getByText("Instance overview")).toHaveCount(0);
});

test("a signed-out visitor is sent to sign in and back", async ({ page }) => {
  await page.goto("/app/admin");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fadmin$/);
});
