import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test.describe("docs", () => {
  test("the landing page leads to an index of every provider and operations page", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("banner").getByRole("link", { name: "Docs", exact: true }).click();

    await expect(page).toHaveURL("/docs");
    await expect(page).toHaveTitle("Docs · DevMacro");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Documentation");

    const providers = page.getByRole("region", { name: "Providers" });
    for (const name of ["GitHub", "GitLab", "Resend", "Stripe", "Supabase", "Vercel"]) {
      await expect(providers.getByRole("link", { name, exact: true })).toBeVisible();
    }
    const operations = page.getByRole("region", { name: "Operations" });
    for (const name of [
      "Deploy the hosted app",
      "Jobs: scheduled syncs, retries, and retention",
      "Register the OAuth apps",
    ]) {
      await expect(operations.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(
      page.getByRole("region", { name: "Architecture" }).getByRole("link", { name: "Database schema", exact: true }),
    ).toBeVisible();
  });

  test("a provider page renders its heading, its tables, and marks itself in the docs list", async ({ page }) => {
    await page.goto("/docs");
    await page.getByRole("link", { name: "Vercel", exact: true }).click();

    await expect(page).toHaveURL("/docs/providers/vercel");
    await expect(page).toHaveTitle("Vercel · DevMacro");
    const main = page.getByRole("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("Vercel");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(main.getByRole("table").first()).toBeVisible();
    await expect(main.getByRole("columnheader", { name: "Item", exact: true }).first()).toBeVisible();

    const docsList = page.getByRole("navigation", { name: "Docs" });
    await expect(docsList.getByRole("link", { name: "Vercel", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(docsList.getByRole("link", { name: "GitHub", exact: true })).not.toHaveAttribute("aria-current");
  });

  test("a link to another doc opens that doc at the linked heading", async ({ page }) => {
    await page.goto("/docs/operations/oauth-apps");
    await page.getByRole("main").getByRole("link", { name: "Deploy, environment variables", exact: true }).click();

    await expect(page).toHaveURL("/docs/operations/deploy#environment-variables");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Deploy the hosted app");
    await expect(page.getByRole("heading", { name: "Environment variables", exact: true })).toBeInViewport();
  });

  for (const path of ["/docs/providers/not-a-provider", "/docs/Providers/Vercel", "/docs/providers/vercel/extra"]) {
    test(`answers 404 for ${path}`, async ({ page }) => {
      const response = await page.goto(path);

      expect(response?.status()).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("We could not find that doc");
      await page.getByRole("link", { name: "Browse all docs" }).click();
      await expect(page).toHaveURL("/docs");
    });
  }

  for (const path of ["/docs", "/docs/providers/vercel", "/docs/providers/gitlab"]) {
    test(`${path} has no automatically detectable accessibility violations`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);
    });
  }

  test("keyboard focus reaches the docs list and opens a doc", async ({ page }) => {
    await page.goto("/docs/providers/vercel");
    const firstDoc = page.getByRole("navigation", { name: "Docs" }).getByRole("link").first();
    await expect(firstDoc).toHaveText("GitHub");

    // Tab from the top of the page until focus lands on the first doc in the list. Each attempt
    // presses Tab once, so focus walks forward and stops there.
    await expect(async () => {
      await page.keyboard.press("Tab");
      await expect(firstDoc).toBeFocused({ timeout: 100 });
    }).toPass({ timeout: 10_000 });

    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/docs/providers/github");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("GitHub");
  });
});
