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

/**
 * One fake account with verified spend today and two days ago, but nothing yesterday (a gap), and
 * an estimate reported both today and yesterday.
 */
async function seedTrends(workspace: TestWorkspace): Promise<{ today: string; yesterday: string }> {
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
  return { today, yesterday };
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
});
