import AxeBuilder from "@axe-core/playwright";
import { request as playwrightRequest, type Browser, type Page } from "@playwright/test";

import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";
import { publishStars, seedIncludedAccounts, seedProjectWithHistory, STARS_TODAY, turnOnPage } from "./fixtures/public-pages";

// Public project pages (#150). Each test creates its own workspace and seeds only inside it, so
// tests run in any order. Public reads go through a fresh browser context or request context with
// no session, as a stranger would see them.

function settingsPath(workspace: TestWorkspace, projectId: string): string {
  return `/w/${workspace.slug}/projects/${projectId}/public-metrics`;
}

async function readPublic(baseURL: string, path: string): Promise<{ status: number; body: string }> {
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const response = await context.get(path);
    return { status: response.status(), body: await response.text() };
  } finally {
    await context.dispose();
  }
}

/** Opens `path` signed out, runs `check` on the page, and closes the context. */
async function asStranger(browser: Browser, baseURL: string, path: string, check: (page: Page, status: number | undefined) => Promise<void>): Promise<void> {
  const context = await browser.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  try {
    const page = await context.newPage();
    const response = await page.goto(path);
    await check(page, response?.status());
  } finally {
    await context.close();
  }
}

async function expectNotFound(page: Page, status: number | undefined): Promise<void> {
  expect(status).toBe(404);
  await expect(page).toHaveTitle("Page not found · DevMacro");
  await expect(page.getByRole("heading", { level: 1, name: "We could not find that page" })).toBeVisible();
}

ownerTest.describe("project pages as the owner", () => {
  ownerTest("turns a page on, shows only what is published, and turns it off", async ({ page, browser, baseURL }) => {
    if (baseURL === undefined) throw new Error("baseURL is not configured");
    const workspace = await createTestWorkspace("Project page");
    try {
      const projectId = await seedProjectWithHistory(workspace);
      await publishStars(workspace, projectId);
      const address = `/@${workspace.slug}/acme-web`;

      await page.goto(settingsPath(workspace, projectId));
      const settings = page.getByRole("region", { name: "Project page" });
      await expect(settings).toContainText("Off. Nothing is public at a project page address until an owner or admin turns it on.");
      // Nothing is public by default: the address answers the same 404 as any unknown one.
      expect((await readPublic(baseURL, address)).status).toBe(404);

      await expect(settings.getByLabel("Address")).toHaveValue("acme-web");
      await settings.getByLabel("Let search engines index this page").check();
      await settings.getByRole("button", { name: "Turn on the project page" }).click();
      await expect(page.getByRole("status").filter({ hasText: `The project page is on at ${address}.` })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Project page" })).toBeFocused();
      await expect(settings.getByRole("link", { name: address })).toHaveAttribute("href", address);
      await expect(settings).toContainText("Search engines may index it.");

      const { data: events, error } = await adminClient()
        .from("activity_events")
        .select("title, body, provider")
        .eq("workspace_id", workspace.id)
        .eq("type_id", "devmacro.project_page_enabled");
      if (error) throw new Error(`Reading events failed (code ${error.code}).`);
      expect(events).toEqual([
        { title: "Turned on the public project page", body: `Project Acme web. Address ${address}. Search engines may index it.`, provider: null },
      ]);

      await asStranger(browser, baseURL, address, async (publicPage, status) => {
        expect(status).toBe(200);
        await expect(publicPage).toHaveTitle("Acme web: public metrics · DevMacro");
        await expect(publicPage.getByRole("heading", { level: 1 })).toHaveText("Acme web");
        await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute("content", "index, follow");

        const published = publicPage.getByRole("region", { name: "Published metrics" });
        await expect(published.getByRole("listitem")).toHaveCount(1);
        await expect(published).toContainText("GitHub stars");
        await expect(published).toContainText(`${STARS_TODAY.toLocaleString("en-US")} stars`);
        await expect(published).toContainText("Verified");
        await expect(published.getByRole("link", { name: "How it is counted for GitHub stars" })).toHaveAttribute(
          "href",
          "/docs/architecture/public-metrics#github-stars",
        );

        // Providers as icons with their names, and only the provider behind a published value.
        await expect(publicPage.getByRole("img", { name: "GitHub", exact: true })).toBeVisible();
        await expect(publicPage.getByRole("img", { name: "Vercel", exact: true })).toHaveCount(0);

        // History charts with text alternatives, and the values as a table.
        await expect(publicPage.getByRole("img", { name: /^GitHub stars, last 30 days: from .* to 1,204 stars on / })).toBeVisible();
        await expect(publicPage.getByRole("img", { name: /^GitHub stars, last 90 days: from / })).toBeVisible();

        const milestones = publicPage.getByRole("region", { name: "Milestones" });
        await expect(milestones).toContainText("Reached 100 GitHub stars");
        await expect(milestones).toContainText("Reached 1,000 GitHub stars");

        // Deployments are stored but not published, so nothing about them shows. Nor do account names.
        const text = await publicPage.locator("main").innerText();
        expect(text).not.toContain("Deployment");
        expect(text).not.toContain("example-org");

        const scan = await new AxeBuilder({ page: publicPage }).analyze();
        expect(scan.violations).toEqual([]);

        // Keyboard: the table behind a chart opens from its summary with Enter.
        const summary = publicPage.getByText("Show the values as a table").first();
        await summary.focus();
        await expect(summary).toBeFocused();
        await publicPage.keyboard.press("Enter");
        await expect(publicPage.getByRole("table", { name: "GitHub stars: daily values for the last 30 days" })).toBeVisible();
        await publicPage.keyboard.press("Tab");
        await expect(publicPage.getByRole("region", { name: "GitHub stars, last 30 days, values" })).toBeFocused();
      });

      const sitemap = await readPublic(baseURL, "/sitemap.xml");
      expect(sitemap.status).toBe(200);
      expect(sitemap.body).toContain(`${address}</loc>`);
      // The route behind the address never answers under its own path.
      expect((await readPublic(baseURL, `/p/${workspace.slug}/acme-web`)).status).toBe(404);

      await settings.getByRole("button", { name: "Turn off the project page" }).click();
      await expect(page.getByRole("status").filter({ hasText: "The project page is off. Its address now answers page not found." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Project page" })).toBeFocused();
      await expect(settings).toContainText(`Off. Its address, ${address}, answers page not found.`);

      // Off: the next request answers 404, the same page as an address that never existed.
      await asStranger(browser, baseURL, address, expectNotFound);
      await asStranger(browser, baseURL, `/@${workspace.slug}/no-such-page`, expectNotFound);
      // A slug longer than any page can have answers the same 404, refused before any query.
      await asStranger(browser, baseURL, `/@${workspace.slug}/${"a".repeat(41)}`, expectNotFound);
      expect((await readPublic(baseURL, "/sitemap.xml")).body).not.toContain(address);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("keeps a page offline until something is published, and out of search when asked", async ({ browser, baseURL }) => {
    if (baseURL === undefined) throw new Error("baseURL is not configured");
    const workspace = await createTestWorkspace("Project page empty");
    try {
      const projectId = await seedProjectWithHistory(workspace);
      const address = `/@${workspace.slug}/acme-web`;
      await turnOnPage(workspace, projectId, "acme-web", false);

      // On, but nothing published: the same 404.
      await asStranger(browser, baseURL, address, expectNotFound);

      await publishStars(workspace, projectId);
      await asStranger(browser, baseURL, address, async (publicPage, status) => {
        expect(status).toBe(200);
        await expect(publicPage.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");
      });
      expect((await readPublic(baseURL, "/sitemap.xml")).body).not.toContain(address);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("past 200 included accounts, shows no number anywhere and keeps the owner's controls", async ({ page, browser, baseURL }) => {
    if (baseURL === undefined) throw new Error("baseURL is not configured");
    const workspace = await createTestWorkspace("Project page many accounts");
    try {
      const projectId = await seedProjectWithHistory(workspace);
      await publishStars(workspace, projectId);
      await turnOnPage(workspace, projectId, "acme-web", false);
      // Two accounts from the history seed plus 199: one past the bound (#220).
      await seedIncludedAccounts(workspace, projectId, 199);

      // A visitor gets the page's error, never a number computed from part of the accounts.
      await asStranger(browser, baseURL, `/@${workspace.slug}/acme-web`, async (publicPage) => {
        await expect(publicPage.getByRole("heading", { level: 1, name: "This project page could not be loaded" })).toBeVisible();
        await expect(publicPage.getByRole("button", { name: "Try again" })).toBeVisible();
        await expect(publicPage.getByText(STARS_TODAY.toLocaleString("en-US"))).toHaveCount(0);
      });

      // The owner keeps the settings page, with the reason and the control to unpublish.
      await page.goto(settingsPath(workspace, projectId));
      const metrics = page.getByRole("region", { name: "Metrics from your connected providers" });
      await expect(metrics).toContainText("These metrics cannot be computed");
      await expect(metrics).toContainText("This project has more than 200 included accounts");
      await expect(metrics.getByRole("link", { name: "Connections" })).toHaveAttribute("href", `/w/${workspace.slug}/connections`);
      await expect(metrics.getByRole("listitem").filter({ hasText: "GitHub stars" }).first()).toContainText(
        "Now: Not computed: too many accounts",
      );
      await expect(metrics.getByRole("button", { name: "Unpublish GitHub stars", exact: true })).toBeVisible();
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("explains a refused address and works with the keyboard alone", async ({ page }) => {
    const workspace = await createTestWorkspace("Project page form");
    try {
      const projectId = await seedProjectWithHistory(workspace);
      const { data: other, error } = await adminClient()
        .from("projects")
        .insert({ workspace_id: workspace.id, name: "Acme docs" })
        .select("id")
        .single();
      if (error) throw new Error(`Seeding a project failed (code ${error.code}).`);
      await turnOnPage(workspace, other.id, "taken", false);

      await page.goto(settingsPath(workspace, projectId));
      const settings = page.getByRole("region", { name: "Project page" });
      const slug = settings.getByLabel("Address");

      await slug.fill("Acme Web");
      await settings.getByRole("button", { name: "Turn on the project page" }).click();
      await expect(slug).toHaveAttribute("aria-invalid", "true");
      await expect(slug).toHaveAccessibleDescription(/Use lowercase letters and numbers, with single hyphens between words\./);
      await expect(slug).toBeFocused();

      await slug.fill("taken");
      await settings.getByRole("button", { name: "Turn on the project page" }).click();
      await expect(slug).toHaveAccessibleDescription(/Another project in this workspace uses this address\. Choose another one\./);

      // Keyboard only: address, then the indexing choice, then the button.
      await slug.fill("acme-web");
      await page.keyboard.press("Tab");
      await expect(settings.getByLabel("Let search engines index this page")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(settings.getByRole("button", { name: "Turn on the project page" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: `The project page is on at /@${workspace.slug}/acme-web.` })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Project page" })).toBeFocused();

      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest.describe("project pages as a viewer", () => {
  viewerTest("sees whether the page is on and no controls", async ({ page }) => {
    const workspace = await createTestWorkspace("Project page viewer");
    try {
      const projectId = await seedProjectWithHistory(workspace);
      await publishStars(workspace, projectId);
      await turnOnPage(workspace, projectId, "acme-web", false);

      await page.goto(settingsPath(workspace, projectId));
      const settings = page.getByRole("region", { name: "Project page" });
      await expect(settings).toContainText(`On. Anyone can open it at /@${workspace.slug}/acme-web.`);
      await expect(settings).toContainText("It asks search engines not to index it.");
      await expect(settings.getByRole("button")).toHaveCount(0);
      await expect(settings.getByLabel("Address")).toHaveCount(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
