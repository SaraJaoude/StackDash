import AxeBuilder from "@axe-core/playwright";

import { expect, ownerTest } from "./fixtures/auth";
import { createTestWorkspace, deleteTestWorkspace } from "./fixtures/db";

/*
 * PostHog (#115) end to end. The web server simulates the live providers (playwright.config.ts), so
 * PostHog connects from the catalog through the dev consent screen without a metadata document or a
 * signing key. It never runs the job tick, so it stays in the `chromium` project. The two public
 * routes PostHog itself calls answer 404 here, because CI sets no PostHog variables.
 */

const CONNECTION_URL = /\/connections\/([0-9a-f-]{36})(\?|$)/;

ownerTest.describe("PostHog", () => {
  ownerTest("connects from the catalog with the keyboard and lists the organization", async ({ page }) => {
    const workspace = await createTestWorkspace("PostHog connection");
    try {
      await page.goto(`/w/${workspace.slug}/connections`);
      const card = page
        .getByRole("list", { name: "Providers" })
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name: "PostHog", exact: true }) });
      await expect(card.getByText("Simulated", { exact: true })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await card.getByRole("link", { name: "Connect PostHog" }).focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connect PostHog");
      // The simulated adapter reuses the real adapter's list of what is collected.
      await expect(page.getByText("Signups per project per day", { exact: true })).toBeVisible();
      await expect(page.getByText("When a product nears or reaches its billing limit", { exact: true })).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      await page.getByRole("button", { name: "Continue to PostHog" }).focus();
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL(CONNECTION_URL);
      await expect(page.getByRole("region", { name: "Status" }).getByText("Simulated", { exact: true })).toBeVisible();
      await expect(page.getByText("Example organization").first()).toBeVisible();
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("answers 404 for the metadata document and JWKS when PostHog is not set up", async ({ request }) => {
    for (const path of ["/oauth/posthog/client-metadata", "/oauth/posthog/jwks"]) {
      const response = await request.get(path);
      expect(response.status()).toBe(404);
      expect(await response.text()).toBe("PostHog is not set up on this DevMacro instance.");
    }
  });
});
