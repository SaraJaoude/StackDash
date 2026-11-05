import { existsSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { z } from "zod";

import { expect, ownerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace } from "./fixtures/db";

/*
 * The Sentry adapter (#117), simulated end to end: Sentry connects from the catalog through the
 * dev consent screen with its three example projects as accounts, a tick syncs them, and the
 * timeline shows Sentry's issues and releases labeled "Simulated". Like simulated-providers.spec.ts
 * it runs the instance-wide tick, so it lives in the `instance-wide` Playwright project.
 */

const CONNECTION_URL = /\/connections\/([0-9a-f-]{36})(\?|$)/;

function cronSecret(): string {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  return z.string().min(32).parse(process.env.CRON_SECRET);
}

ownerTest.describe("simulated Sentry", () => {
  ownerTest("connects with its projects as accounts and puts issues and releases on the timeline", async ({ page }) => {
    ownerTest.slow();
    const workspace = await createTestWorkspace("Simulated Sentry");
    try {
      await page.goto(`/w/${workspace.slug}/connections`);
      const card = page
        .getByRole("list", { name: "Providers" })
        .getByRole("listitem")
        .filter({ has: page.getByRole("heading", { name: "Sentry", exact: true }) });
      await expect(card.getByText("Simulated", { exact: true })).toBeVisible();
      await expect(card.getByText("Read access only.")).toBeVisible();
      await card.getByRole("link", { name: "Connect Sentry" }).click();

      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connect Sentry");
      const data = page.getByRole("region", { name: "Data collected" });
      await expect(data.getByText(/^Error events per project over the last 24 hours/)).toBeVisible();
      await expect(data.getByText(/^New, regressed, and resolved issues per project/)).toBeVisible();
      const disclosure = await new AxeBuilder({ page }).analyze();
      expect(disclosure.violations).toEqual([]);
      await page.getByRole("button", { name: "Continue to Sentry" }).focus();
      await page.keyboard.press("Enter");

      await expect(page).toHaveURL(CONNECTION_URL);
      await expect(page.getByRole("region", { name: "Status" }).getByText("Simulated", { exact: true })).toBeVisible();
      const accounts = page.getByRole("list", { name: "Accounts" }).getByRole("listitem");
      await expect(accounts).toHaveCount(3);
      for (const name of ["web", "api", "ios"]) {
        await expect(accounts.filter({ hasText: name }).getByText("project", { exact: true })).toBeVisible();
      }
      const connection = await new AxeBuilder({ page }).analyze();
      expect(connection.violations).toEqual([]);

      const authorization = `Bearer ${cronSecret()}`;
      await expect(async () => {
        const response = await page.request.post("/api/jobs/tick", { headers: { Authorization: authorization }, timeout: 120_000 });
        expect(response.status()).toBe(200);
        const { data: rows, error } = await adminClient()
          .from("connections")
          .select("last_synced_at")
          .eq("workspace_id", workspace.id)
          .eq("provider", "sentry")
          .limit(1);
        if (error) throw new Error(`Reading connections failed (code ${error.code}).`);
        expect(rows[0]?.last_synced_at ?? null).not.toBeNull();
      }).toPass({ timeout: 90_000 });

      // Every project gets a release every 20 minutes, so the 30 minute backfill always has one.
      await page.goto(`/w/${workspace.slug}/timeline?provider=sentry`);
      await expect(page.getByRole("status").filter({ hasText: /^Showing/ })).toHaveText(
        /^Showing \d+ events? for provider Sentry$/,
      );
      const events = page.getByRole("region", { name: "Events", exact: true }).getByRole("listitem");
      const release = events.filter({ hasText: /Release \S+ created/ }).first();
      await expect(release).toBeVisible();
      await expect(release.getByText("Sentry", { exact: true })).toBeVisible();
      await expect(release.getByText("Simulated", { exact: true })).toBeVisible();
      const timeline = await new AxeBuilder({ page }).analyze();
      expect(timeline.violations).toEqual([]);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
