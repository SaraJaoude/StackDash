import AxeBuilder from "@axe-core/playwright";

import { expect, ownerTest } from "./fixtures/auth";
import { createTestWorkspace, deleteTestWorkspace } from "./fixtures/db";

/*
 * GitLab (#112) in the connection catalog and through the connect flow. The web server simulates
 * the live providers (playwright.config.ts), so GitLab connects through the dev consent route with
 * no OAuth application registered. It never runs the job tick, so it stays in the `chromium`
 * project; syncing simulated GitLab data is covered by the simulator's unit tests.
 */

ownerTest.describe("GitLab connection", () => {
  ownerTest("is offered in the catalog, says what it collects before connecting, and connects by keyboard", async ({ page }) => {
    const workspace = await createTestWorkspace("GitLab connection");
    try {
      await page.goto(`/w/${workspace.slug}/connections`);
      const card = page
        .getByRole("list", { name: "Providers" })
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name: "GitLab", exact: true }) });
      await expect(card.getByText("Simulated", { exact: true })).toBeVisible();
      await card.getByRole("link", { name: "Connect GitLab" }).click();

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connect GitLab");
      const permissions = page.getByRole("region", { name: "Permissions GitLab will ask you to grant" });
      await expect(permissions.getByText(/^Simulated\. DevMacro makes up example GitLab data/)).toBeVisible();
      const data = page.getByRole("region", { name: "Data collected" });
      for (const item of [
        "Compute minutes used this month, per namespace and per project",
        "Monthly compute minutes included in your plan (estimated from the plan)",
        "Pipelines that succeeded or failed",
        "Deployments per environment",
        "Merged merge requests (numbers only, never titles or authors)",
      ]) {
        await expect(data.getByText(item, { exact: true })).toBeVisible();
      }
      const connectScan = await new AxeBuilder({ page }).analyze();
      expect(connectScan.violations).toEqual([]);

      await page.getByRole("button", { name: "Continue to GitLab" }).focus();
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(/\/connections\/[0-9a-f-]{36}(\?|$)/);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("GitLab (example-group)");
      await expect(page.getByRole("region", { name: "Status" }).getByText("Simulated", { exact: true })).toBeVisible();
      const connectionScan = await new AxeBuilder({ page }).analyze();
      expect(connectionScan.violations).toEqual([]);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
