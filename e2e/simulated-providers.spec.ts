import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, ownerTest } from "./fixtures/auth";
import { connectSimulated } from "./fixtures/connections";
import { adminClient, createTestWorkspace, cronSecret, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";

/*
 * Simulated providers (#131), end to end: the web server runs with DEVMACRO_SIMULATE_PROVIDERS=1
 * (playwright.config.ts), so Vercel, Stripe, and Polar connect from the catalog through the dev consent
 * screen without an OAuth app, a tick through POST /api/jobs/tick syncs their made-up data, and
 * every screen labels it "Simulated". Nothing leaves the machine.
 *
 * The tick is instance-wide: it also syncs the connections other specs seed, in their workspaces.
 * So this spec runs in the `instance-wide` Playwright project, after every `chromium` spec has
 * finished (playwright.config.ts). Any spec that runs the tick must live in that project too, and
 * only those: a test here that never ticks belongs in `chromium` (see
 * real-connection-while-simulating.spec.ts).
 */

const VERCEL_CONNECTION = "Vercel (Example team)";
const STRIPE_CONNECTION = "Stripe (Example Stripe account (test mode))";
const POLAR_CONNECTION = "Polar (Example organization)";

/** Ticks until every simulated connection has synced; other specs' jobs may share a tick. */
async function tickUntilSynced(page: Page, workspace: TestWorkspace): Promise<void> {
  const authorization = `Bearer ${cronSecret()}`;
  await expect(async () => {
    const response = await page.request.post("/api/jobs/tick", { headers: { Authorization: authorization }, timeout: 120_000 });
    expect(response.status()).toBe(200);
    const { data, error } = await adminClient()
      .from("connections")
      .select("provider, last_synced_at")
      .eq("workspace_id", workspace.id)
      .limit(10);
    if (error) throw new Error(`Reading connections failed (code ${error.code}).`);
    expect(data.filter((row) => row.last_synced_at !== null).map((row) => row.provider).sort()).toEqual(["polar", "stripe", "vercel"]);
  }).toPass({ timeout: 90_000 });
}

ownerTest.describe("simulated providers", () => {
  ownerTest("connect from the catalog, sync on a tick, and show as simulated everywhere", async ({ page }) => {
    ownerTest.slow();
    const workspace = await createTestWorkspace("Simulated providers");
    try {
      await connectSimulated(page, workspace.slug, "Vercel");
      await connectSimulated(page, workspace.slug, "Stripe");
      await connectSimulated(page, workspace.slug, "Polar");

      await page.goto(`/w/${workspace.slug}/connections`);
      const connections = page.getByRole("list", { name: "Connections" }).getByRole("listitem");
      await expect(connections).toHaveCount(3);
      for (const name of [VERCEL_CONNECTION, STRIPE_CONNECTION, POLAR_CONNECTION]) {
        const row = connections.filter({ has: page.getByRole("link", { name, exact: true }) });
        await expect(row.getByText("Simulated", { exact: true })).toBeVisible();
      }
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);

      await tickUntilSynced(page, workspace);

      // Each provider is checked on its own filtered timeline (the shared scope filter's
      // `provider` parameter), so Stripe's volume never pushes Vercel off the first page.
      const events = page.getByRole("region", { name: "Events", exact: true }).getByRole("listitem");
      const status = page.getByRole("status").filter({ hasText: /^Showing/ });

      // Stripe's 30 minute backfill always holds events (about one every two slots).
      await page.goto(`/w/${workspace.slug}/timeline?provider=stripe`);
      await expect(status).toHaveText(/^Showing \d+ events? for provider Stripe$/);
      await expect(events.first()).toBeVisible();
      await expect(events.first().getByText("Stripe", { exact: true })).toBeVisible();
      await expect(events.first().getByText("Simulated", { exact: true })).toBeVisible();

      // Polar's backfill holds paid orders (about one a minute); each row is labeled.
      await page.goto(`/w/${workspace.slug}/timeline?provider=polar`);
      await expect(status).toHaveText(/^Showing \d+ events? for provider Polar$/);
      await expect(events.first()).toBeVisible();
      await expect(events.first().getByText("Polar", { exact: true })).toBeVisible();
      await expect(events.first().getByText("Simulated", { exact: true })).toBeVisible();

      // A Vercel deployment is not guaranteed in the backfill, so the filtered page may be empty;
      // every Vercel row that is there is labeled. The Vercel dashboard card below always is.
      await page.goto(`/w/${workspace.slug}/timeline?provider=vercel`);
      await expect(status).toHaveText(/^Showing (no events|\d+ events?) for provider Vercel$/);
      const vercelRows = await events.count();
      for (let index = 0; index < vercelRows; index += 1) {
        await expect(events.nth(index).getByText("Vercel", { exact: true })).toBeVisible();
        await expect(events.nth(index).getByText("Simulated", { exact: true })).toBeVisible();
      }

      await page.goto(`/w/${workspace.slug}/dashboard`);
      const byProvider = page.getByRole("region", { name: "By provider" });
      for (const name of [VERCEL_CONNECTION, STRIPE_CONNECTION, POLAR_CONNECTION]) {
        await expect(byProvider.getByRole("article", { name }).getByText("Simulated", { exact: true })).toBeVisible();
      }
      // Polar's revenue shows as revenue and its fees as spend on its own card, never mixed.
      const polarCard = byProvider.getByRole("article", { name: POLAR_CONNECTION });
      await expect(polarCard.getByRole("heading", { name: "Revenue this billing period", level: 4 })).toBeVisible();
      await expect(polarCard.getByRole("heading", { name: "Spend this billing period", level: 4 })).toBeVisible();
      // MRR and ARR are run rates under their own heading, never added into the revenue above.
      await expect(polarCard.getByRole("heading", { name: "Recurring revenue", level: 4 })).toBeVisible();
      for (const label of ["Monthly recurring revenue (USD)", "Annual recurring revenue (USD)"]) {
        await expect(polarCard.getByText(label, { exact: true })).toBeVisible();
      }
      // Every total the simulated connections contribute to says so, not only their own cards.
      const spendCards = page
        .getByRole("region", { name: "Spending this billing period" })
        .getByRole("region", { name: /^Spend in [A-Z]{3}$/ });
      for (let index = 0; index < (await spendCards.count()); index += 1) {
        await expect(spendCards.nth(index).getByText("Simulated", { exact: true })).toBeVisible();
      }
      // Stripe's and Polar's made-up payments arrive as revenue, kept apart per currency.
      const revenueCards = page
        .getByRole("region", { name: "Revenue this billing period" })
        .getByRole("region", { name: /^Revenue in [A-Z]{3}$/ });
      await expect(revenueCards.first()).toBeVisible();
      for (let index = 0; index < (await revenueCards.count()); index += 1) {
        await expect(revenueCards.nth(index).getByText("Simulated", { exact: true })).toBeVisible();
      }
      const trends = page.getByRole("region", { name: "Trends" }).getByRole("figure");
      await expect(trends.first()).toBeVisible();
      for (let index = 0; index < (await trends.count()); index += 1) {
        await expect(trends.nth(index).getByText("Simulated", { exact: true })).toBeVisible();
      }
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
