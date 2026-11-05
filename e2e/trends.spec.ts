import AxeBuilder from "@axe-core/playwright";

import type { Database } from "../src/lib/supabase/database.types";

import { expect, ownerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";

// Every test seeds its own workspace with synthetic data from the fake provider only.

const DAY_MS = 86_400_000;

type SnapshotInsert = Database["public"]["Tables"]["usage_snapshots"]["Insert"];

function utcDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

type SeededTrends = { today: string; yesterday: string; twoDaysAgo: string; connectionId: string; accountId: string };

/**
 * One fake account with verified spend today and two days ago, but nothing yesterday (a gap), and
 * an estimate reported both today and yesterday.
 */
async function seedTrends(workspace: TestWorkspace): Promise<SeededTrends> {
  const admin = adminClient();
  const now = Date.now();
  const today = utcDate(now);
  const yesterday = utcDate(now - DAY_MS);
  const twoDaysAgo = utcDate(now - 2 * DAY_MS);

  const { data: connection, error: connectionError } = await admin
    .from("connections")
    .insert({
      workspace_id: workspace.id,
      provider: "fake",
      status: "active",
      display_name: "Fake billing account",
      poll_interval_seconds: 3_600,
      last_synced_at: new Date(now).toISOString(),
    })
    .select("id")
    .single();
  if (connectionError) throw new Error(`Seeding a connection failed (code ${connectionError.code}).`);
  const { data: account, error: accountError } = await admin
    .from("external_accounts")
    .insert({
      workspace_id: workspace.id,
      connection_id: connection.id,
      external_id: "acct_trends",
      display_name: "Production",
      kind: "account",
    })
    .select("id")
    .single();
  if (accountError) throw new Error(`Seeding an account failed (code ${accountError.code}).`);

  const row = (date: string, overrides: Partial<SnapshotInsert>): SnapshotInsert => {
    const at = `${date}T06:00:00.000Z`;
    return {
      workspace_id: workspace.id,
      connection_id: connection.id,
      external_account_id: account.id,
      metric_key: "fake.spend.month",
      kind: "verified_spend",
      label: "Spend this month",
      snapshot_date: date,
      currency: "USD",
      point_at: at,
      retrieved_at: at,
      provenance_source: "provider_api",
      ...overrides,
    };
  };
  const estimate = {
    metric_key: "fake.cost.estimate",
    kind: "estimated_spend",
    label: "Estimated spend for the month",
    provenance_source: "derived",
    pricing_source: "Fake price list 2026",
  } as const;
  const { error } = await admin.from("usage_snapshots").insert([
    row(twoDaysAgo, { amount_minor: 100 }),
    row(today, { amount_minor: 300 }),
    row(yesterday, { ...estimate, amount_minor: 450 }),
    row(today, { ...estimate, amount_minor: 500 }),
  ]);
  if (error) throw new Error(`Seeding snapshots failed (code ${error.code}).`);
  return { today, yesterday, twoDaysAgo, connectionId: connection.id, accountId: account.id };
}

type EventInsert = Database["public"]["Tables"]["activity_events"]["Insert"];

/**
 * A burst of 14 deployments two days ago, one signup today, and one triggered alert today (DevMacro's
 * own event, with no provider), all at midday UTC so the UTC and London days agree.
 */
async function seedEvents(workspace: TestWorkspace, seeded: SeededTrends): Promise<void> {
  const event = (date: string, key: string, overrides: Partial<EventInsert>): EventInsert => ({
    workspace_id: workspace.id,
    connection_id: seeded.connectionId,
    external_account_id: seeded.accountId,
    provider: "fake",
    type_id: "fake.deploy.succeeded",
    severity: "success",
    title: "Deployment succeeded",
    occurred_at: `${date}T12:00:00.000Z`,
    dedupe_key: `markers-${key}`,
    ...overrides,
  });
  const { error } = await adminClient()
    .from("activity_events")
    .insert([
      ...Array.from({ length: 14 }, (_, index) => event(seeded.twoDaysAgo, `deploy-${index}`, {})),
      event(seeded.today, "signup", { type_id: "fake.signup", severity: "info", title: "New signup" }),
      event(seeded.today, "alert", {
        connection_id: null,
        external_account_id: null,
        provider: null,
        type_id: "devmacro.alert_triggered",
        severity: "warning",
        title: "Spend passed 80 percent of the budget",
      }),
    ]);
  if (error) throw new Error(`Seeding events failed (code ${error.code}).`);
}

ownerTest.describe("dashboard trends", () => {
  ownerTest("charts each metric with a table, shows a gap as unavailable, and marks estimates", async ({ page }) => {
    const workspace = await createTestWorkspace("Dashboard trends");
    try {
      const { today, yesterday } = await seedTrends(workspace);
      await page.goto(`/w/${workspace.slug}/dashboard`);
      const trends = page.getByRole("region", { name: "Trends" });
      await expect(trends.getByRole("link", { name: "Daily, last 30 days" })).toHaveAttribute("aria-current", "page");

      const spend = trends.getByRole("figure", { name: "Spend this month (Example provider, USD)" });
      await expect(spend).toContainText("No comparison: the previous day is unavailable");
      await expect(spend.getByRole("img")).toHaveAttribute("aria-label", /28 days unavailable\./);
      await expect(spend).toContainText("Break in the line, mark on the baseline: unavailable");

      await spend.getByText("Show the values as a table").click();
      const spendTable = spend.getByRole("table", { name: /daily values for the last 30 days/ });
      await expect(spendTable).toBeVisible();
      const gapRow = spendTable.getByRole("row", { name: new RegExp(`^${yesterday}`) });
      await expect(gapRow.getByRole("cell", { name: "Unavailable", exact: true })).toBeVisible();
      await expect(gapRow).not.toContainText("$0.00");
      const todayRow = spendTable.getByRole("row", { name: new RegExp(`^${today}`) });
      await expect(todayRow).toContainText("$3.00");
      await expect(todayRow.getByRole("cell", { name: "Verified", exact: true })).toBeVisible();

      const estimated = trends.getByRole("figure", { name: "Estimated spend for the month (Example provider, USD)" });
      await expect(estimated).toContainText("Up 11 percent from the previous day");
      await expect(estimated).toContainText("Dashed line, hollow points: estimated");
      await expect(estimated.getByRole("img")).toHaveAttribute("aria-label", /Includes estimated values\./);
      await estimated.getByText("Show the values as a table").click();
      const estimatedRow = estimated.getByRole("table").getByRole("row", { name: new RegExp(`^${today}`) });
      await expect(estimatedRow.getByRole("cell", { name: "Estimated", exact: true })).toBeVisible();

      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);

      await trends.getByRole("link", { name: "Monthly, last 13 months" }).click();
      await expect(page).toHaveURL(/[?&]trend=monthly(&|$)/);
      const monthly = page.getByRole("region", { name: "Trends" });
      await expect(monthly.getByRole("link", { name: "Monthly, last 13 months" })).toHaveAttribute("aria-current", "page");
      await expect(
        monthly.getByRole("figure", { name: "Spend this month (Example provider, USD)" }).getByRole("img"),
      ).toHaveAttribute("aria-label", /last 13 months/);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("marks events under the charts, by keyboard in date order, with a table column and a URL toggle", async ({ page }) => {
    const workspace = await createTestWorkspace("Dashboard trend markers");
    try {
      const seeded = await seedTrends(workspace);
      await seedEvents(workspace, seeded);
      const { today, twoDaysAgo } = seeded;
      await page.goto(`/w/${workspace.slug}/dashboard`);
      const trends = page.getByRole("region", { name: "Trends" });
      const toggles = trends.getByRole("navigation", { name: "Event markers" });
      await expect(toggles.getByRole("link", { name: "Hide deployments" })).toBeVisible();

      // Charts are sorted by label, so the estimate chart comes first; both are the fake provider's.
      const spend = trends.getByRole("figure", { name: "Spend this month (Example provider, USD)" });
      const burst = spend.getByRole("link", { name: `14 deployments on ${twoDaysAgo}` });
      await expect(burst).toHaveAttribute(
        "href",
        `/w/${workspace.slug}/timeline?type=fake.deploy.succeeded&from=${twoDaysAgo}&to=${twoDaysAgo}&provider=fake`,
      );
      await expect(spend.getByRole("link", { name: `1 triggered alert on ${today}` })).toHaveAttribute(
        "href",
        `/w/${workspace.slug}/timeline?type=devmacro.alert_triggered&from=${today}&to=${today}`,
      );
      await expect(spend).toContainText("Marker: deployments");
      await expect(spend).toContainText("Marker: triggered alerts");
      const box = await burst.boundingBox();
      expect(box?.width).toBeGreaterThanOrEqual(24);
      expect(box?.height).toBeGreaterThanOrEqual(24);

      // Keyboard only: from the last toggle, Tab reaches the first chart's markers oldest day first.
      await toggles.getByRole("link", { name: "Hide triggered alerts" }).focus();
      const reached: string[] = [];
      for (let step = 0; step < 3; step += 1) {
        await page.keyboard.press("Tab");
        reached.push(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? ""));
      }
      expect(reached).toEqual([`14 deployments on ${twoDaysAgo}`, `1 signup on ${today}`, `1 triggered alert on ${today}`]);
      const outline = await page.evaluate(() =>
        document.activeElement === null ? "none" : getComputedStyle(document.activeElement).outlineStyle,
      );
      expect(outline).not.toBe("none");

      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);

      await spend.getByText("Show the values as a table").click();
      const table = spend.getByRole("table");
      await expect(table.getByRole("columnheader", { name: "Events" })).toBeVisible();
      const burstRow = table.getByRole("row", { name: new RegExp(`^${twoDaysAgo}`) });
      await expect(burstRow.getByRole("link", { name: "14 deployments" })).toBeVisible();
      await expect(table.getByRole("row", { name: new RegExp(`^${seeded.yesterday}`) })).toContainText("No events");

      // Hiding a category is URL state: the marker and its table entry go, the toggle flips.
      await toggles.getByRole("link", { name: "Hide deployments" }).click();
      await expect(page).toHaveURL(/[?&]hide_marker=deployments(&|$)/);
      await expect(toggles.getByRole("link", { name: "Show deployments" })).toBeVisible();
      await expect(spend.getByRole("link", { name: `14 deployments on ${twoDaysAgo}` })).toHaveCount(0);
      await expect(spend.getByRole("link", { name: `1 signup on ${today}` })).toBeVisible();
      await expect(trends.getByRole("link", { name: "Monthly, last 13 months" })).toHaveAttribute(
        "href",
        /hide_marker=deployments/,
      );

      // The same link reproduces the view, and a marker opens the timeline filtered to its events.
      await page.goto(`/w/${workspace.slug}/dashboard`);
      await trends
        .getByRole("figure", { name: "Spend this month (Example provider, USD)" })
        .getByRole("link", { name: `14 deployments on ${twoDaysAgo}` })
        .click();
      await expect(page).toHaveURL(new RegExp(`/timeline\\?type=fake\\.deploy\\.succeeded&from=${twoDaysAgo}&to=${twoDaysAgo}&provider=fake$`));
      await expect(page.getByText("Showing 14 events for provider Example provider", { exact: true })).toBeVisible();
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
