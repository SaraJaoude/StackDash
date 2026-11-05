import AxeBuilder from "@axe-core/playwright";

import type { Database } from "../src/lib/supabase/database.types";

import { expect, ownerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";

// Every test seeds its own workspace with synthetic data from the fake provider only (#167).

const DAY_MS = 86_400_000;

type SnapshotInsert = Database["public"]["Tables"]["usage_snapshots"]["Insert"];

function utcDate(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * A 30 day billing period that started five UTC days ago, with one reading at noon on each of the
 * last five days: spend rising $1.00 a day to $5.00, and requests rising 400 a day to 2,000 of a
 * 3,000 allowance that resets at the end of the period. Readings are all in the past, so the
 * expected figures do not depend on the time of day the test runs.
 */
async function seedProjection(workspace: TestWorkspace) {
  const admin = adminClient();
  const todayStart = Math.floor(Date.now() / DAY_MS) * DAY_MS;
  const periodStart = todayStart - 5 * DAY_MS;
  const periodEnd = periodStart + 30 * DAY_MS;
  const period = { period_start: new Date(periodStart).toISOString(), period_end: new Date(periodEnd).toISOString() };

  const { data: connection, error: connectionError } = await admin
    .from("connections")
    .insert({
      workspace_id: workspace.id,
      provider: "fake",
      status: "active",
      display_name: "Fake billing account",
      poll_interval_seconds: 86_400,
      last_synced_at: new Date(todayStart - DAY_MS / 2).toISOString(),
    })
    .select("id")
    .single();
  if (connectionError) throw new Error(`Seeding a connection failed (code ${connectionError.code}).`);
  const { data: account, error: accountError } = await admin
    .from("external_accounts")
    .insert({ workspace_id: workspace.id, connection_id: connection.id, external_id: "acct_projection", display_name: "Production", kind: "account" })
    .select("id")
    .single();
  if (accountError) throw new Error(`Seeding an account failed (code ${accountError.code}).`);

  const rows: SnapshotInsert[] = [];
  for (let day = 1; day <= 5; day += 1) {
    const dayStart = periodStart + (day - 1) * DAY_MS;
    const at = new Date(dayStart + DAY_MS / 2).toISOString();
    const base = {
      workspace_id: workspace.id,
      connection_id: connection.id,
      external_account_id: account.id,
      snapshot_date: utcDate(dayStart),
      retrieved_at: at,
      provenance_source: "provider_api",
      ...period,
    } as const;
    rows.push(
      { ...base, metric_key: "fake.spend.month", kind: "verified_spend", label: "Spend this month", amount_minor: day * 100, currency: "USD" },
      {
        ...base,
        metric_key: "fake.requests.month",
        kind: "usage",
        label: "Requests this month",
        value: day * 400,
        unit: "requests",
        resets_at: period.period_end,
      },
      {
        ...base,
        metric_key: "fake.requests.included",
        kind: "included_allowance",
        label: "Requests included in the plan",
        value: 3000,
        unit: "requests",
        resets_at: period.period_end,
      },
    );
  }
  const { error } = await admin.from("usage_snapshots").insert(rows);
  if (error) throw new Error(`Seeding snapshots failed (code ${error.code}).`);

  const { error: budgetError } = await admin
    .from("budgets")
    .insert({ workspace_id: workspace.id, name: "Production apps", scope: "workspace", amount_minor: 2000, currency: "USD" });
  if (budgetError) throw new Error(`Seeding a budget failed (code ${budgetError.code}).`);

  return {
    // $5.00 plus $1.00 a day from yesterday noon to the end of the period: 25.5 days.
    spend: "$30.50",
    lastDay: utcDate(periodEnd - 1),
    // 2,000 plus 400 a day reaches 3,000 two and a half days after yesterday noon.
    runsOut: utcDate(todayStart - DAY_MS / 2 + 2.5 * DAY_MS),
  };
}

ownerTest.describe("projection to the end of the period", () => {
  ownerTest("shows spend and quota projections as estimates, and a budget projected to cross", async ({ page }) => {
    const workspace = await createTestWorkspace("Projection");
    try {
      const expected = await seedProjection(workspace);
      await page.goto(`/w/${workspace.slug}/dashboard`);

      const totals = page.getByRole("region", { name: "Spending this billing period" }).getByRole("region", { name: "Spend in USD" });
      await expect(totals).toContainText(`On track for ${expected.spend} by ${expected.lastDay}`);
      await expect(totals.getByText("Estimate by DevMacro", { exact: true })).toBeVisible();
      await expect(totals).toContainText("the average daily increase over the last 5 days with data");
      // The projection sits beside the verified amount and is never added to it.
      await expect(totals).toContainText("$5.00");

      const card = page.getByRole("region", { name: "By provider" }).getByRole("article", { name: "Fake billing account" });
      await expect(card).toContainText(`On track for ${expected.spend} by ${expected.lastDay}`);
      const allowance = card.getByRole("article", { name: "Requests included in the plan" });
      await expect(allowance).toContainText(`Runs out around ${expected.runsOut}`);
      await expect(allowance.getByText("Estimate by DevMacro", { exact: true })).toBeVisible();
      await expect(allowance).toContainText("400 requests a day");

      const dashboardScan = await new AxeBuilder({ page }).analyze();
      expect(dashboardScan.violations).toEqual([]);

      await page.goto(`/w/${workspace.slug}/alerts`);
      const budget = page.getByRole("list", { name: "Budgets" }).getByRole("listitem").filter({ hasText: "Production apps" });
      await expect(budget.getByText("Projected to cross", { exact: true })).toBeVisible();
      await expect(budget).toContainText(`On track for ${expected.spend} by ${expected.lastDay}, at or above the $20.00 budget`);
      // Display only: no alert is raised for a projection.
      await expect(page.getByRole("region", { name: "Triggered alerts" })).not.toContainText("Production apps");

      const alertsScan = await new AxeBuilder({ page }).analyze();
      expect(alertsScan.violations).toEqual([]);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("says why there is no projection before 3 days of data", async ({ page }) => {
    const workspace = await createTestWorkspace("Projection early");
    try {
      const admin = adminClient();
      const todayStart = Math.floor(Date.now() / DAY_MS) * DAY_MS;
      const { data: connection, error: connectionError } = await admin
        .from("connections")
        .insert({ workspace_id: workspace.id, provider: "fake", status: "active", display_name: "Fake billing account", poll_interval_seconds: 86_400 })
        .select("id")
        .single();
      if (connectionError) throw new Error(`Seeding a connection failed (code ${connectionError.code}).`);
      const { data: account, error: accountError } = await admin
        .from("external_accounts")
        .insert({ workspace_id: workspace.id, connection_id: connection.id, external_id: "acct_early", display_name: "Production", kind: "account" })
        .select("id")
        .single();
      if (accountError) throw new Error(`Seeding an account failed (code ${accountError.code}).`);
      const at = new Date(todayStart - DAY_MS / 2).toISOString();
      const { error } = await admin.from("usage_snapshots").insert({
        workspace_id: workspace.id,
        connection_id: connection.id,
        external_account_id: account.id,
        metric_key: "fake.spend.month",
        kind: "verified_spend",
        label: "Spend this month",
        snapshot_date: utcDate(todayStart - DAY_MS),
        amount_minor: 100,
        currency: "USD",
        period_start: new Date(todayStart - DAY_MS).toISOString(),
        period_end: new Date(todayStart + 29 * DAY_MS).toISOString(),
        retrieved_at: at,
        provenance_source: "provider_api",
      });
      if (error) throw new Error(`Seeding snapshots failed (code ${error.code}).`);

      await page.goto(`/w/${workspace.slug}/dashboard`);
      const totals = page.getByRole("region", { name: "Spending this billing period" }).getByRole("region", { name: "Spend in USD" });
      await expect(totals).toContainText("Projection unavailable");
      await expect(totals).toContainText("DevMacro needs at least 3 days of data in the current period to project it.");
      await expect(totals.getByText("Estimate by DevMacro", { exact: true })).toHaveCount(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
