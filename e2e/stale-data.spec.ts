import AxeBuilder from "@axe-core/playwright";

import { STALE_AFTER_MS } from "../src/lib/public-metrics/engine";

import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { expectNoAxeViolations } from "./fixtures/axe";
import { createTestWorkspace, deleteTestWorkspace } from "./fixtures/db";
import { seedStaleWorkspace } from "./fixtures/stale";

// Stale data (#267): every connection of a workspace last synced three days ago. The dashboard says
// so once, with "Sync now", instead of on every value; the headline strip shows the last complete
// week instead of six unavailable figures; and the yearly card counts up to the last sync. Each test
// seeds its own workspace with synthetic data.

const usd = (amountMinor: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amountMinor / 100);

ownerTest.describe("stale data as the owner", () => {
  ownerTest("says it once with a working Sync now, and shows the last complete week", async ({ page }) => {
    const workspace = await createTestWorkspace("Stale dashboard");
    try {
      await seedStaleWorkspace(workspace);
      await page.goto(`/w/${workspace.slug}/dashboard`);

      const notice = page.getByRole("region", { name: /^Data last synced 3 days ago$/ });
      await expect(notice).toContainText("None of the 4 connections in view has synced since");
      await expect(notice).toContainText("so every figure on this page is from then or earlier.");
      // One notice for the page: no value repeats it.
      await expect(page.getByText(/^Stale: last updated/)).toHaveCount(0);
      const totals = page.getByRole("region", { name: "Spending this billing period" });
      await expect(totals.getByText(/^Updated 3 days ago$/).first()).toBeVisible();

      // The week so far cannot be reported, so the last complete week is, labeled with its dates.
      await expect(page.getByRole("region", { name: "This week so far" })).toHaveCount(0);
      const strip = page.getByRole("region", { name: "Last complete week" });
      await expect(strip).toContainText(/\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2} in UTC, compared with \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}\./);
      await expect(strip).toContainText(
        "Nothing can be shown for this week so far: no connection in this view has a reading for every day of it yet. These figures are for the last complete week instead.",
      );
      await expect(strip.getByRole("link", { name: "This week" })).toHaveAttribute("aria-current", "page");
      const labels = ["Revenue", "Spend", "Revenue minus spend", "Signups", "Cost per signup", "Deploys"];
      const figure = (label: string) => strip.getByRole("definition").nth(labels.indexOf(label));
      // 150 a day, two deploys and one signup a day, in both whole weeks.
      await expect(figure("Spend")).toContainText(usd(150 * 7));
      await expect(figure("Spend")).toContainText(`No change from ${usd(150 * 7)} in the week before`);
      await expect(figure("Deploys")).toContainText("14 deploys");
      await expect(figure("Deploys")).toContainText("No change from 14 deploys in the week before");
      await expect(figure("Signups")).toContainText("7 signups");
      // No provider here reports revenue, so revenue and revenue minus spend are the only gaps.
      await expect(strip.getByText("Unavailable", { exact: true })).toHaveCount(2);

      // The month view falls back to the last complete month the same way.
      await strip.getByRole("link", { name: "This month" }).click();
      await expect(page.getByRole("region", { name: "Last complete month" })).toContainText("the month before");

      // Keyboard only: Sync now sits between the page header and the filter bar, so Shift+Tab from
      // the filter bar reaches it, and Enter queues a sync of every stale connection.
      await page.goto(`/w/${workspace.slug}/dashboard`);
      await page.getByRole("region", { name: "Filters", exact: true }).locator("summary").focus();
      await page.keyboard.press("Shift+Tab");
      const sync = page.getByRole("region", { name: /^Data last synced/ }).getByRole("button", { name: "Sync now" });
      await expect(sync).toBeFocused();
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: "Sync queued for 4 connections. New numbers appear within a few minutes." })).toBeVisible();
      // A second request inside the cooldown says how long to wait instead of queueing again.
      await sync.click();
      await expect(page.getByRole("status").filter({ hasText: /^A sync was requested recently\. Try again in / })).toBeVisible();
      await expectNoAxeViolations(page);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("counts the yearly card up to the last sync, with nothing cut off", async ({ page }) => {
    const workspace = await createTestWorkspace("Stale year card");
    try {
      const { syncedAt } = await seedStaleWorkspace(workspace);
      // The sync's own year, so the run does not depend on the date; its card is counted up to the
      // sync whenever that was more than 48 hours before the card's end.
      const year = syncedAt.getUTCFullYear();
      const cardEnd = Math.min(Date.now(), Date.UTC(year + 1, 0, 1));
      const countedUpTo = cardEnd - syncedAt.getTime() > STALE_AFTER_MS ? `counted up to ${syncedAt.toISOString().slice(0, 10)}` : null;
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/w/${workspace.slug}/year/${year}`);

      await expect(page.getByRole("term")).toHaveText(["Deployments shipped", "Stars gained", "Signups", "Providers connected"]);
      const figures = page.getByRole("definition");
      for (const index of [0, 1, 2]) {
        await expect(figures.nth(index)).toHaveText(/^[0-9,]+/);
        if (countedUpTo !== null) await expect(figures.nth(index)).toContainText(countedUpTo);
      }
      await expect(page.getByText("Not synced in the last 2 days")).toHaveCount(0);

      const card = await page.request.get(`/w/${workspace.slug}/year/${year}/card.png`);
      expect(card.status()).toBe(200);
      const body = await card.body();
      // The PNG header's width and height.
      expect([body.readUInt32BE(16), body.readUInt32BE(20)]).toEqual([1200, 630]);

      // Keyboard only: the year links, then Share, which opens its dialog.
      await page.getByRole("navigation", { name: "Years" }).getByRole("link").first().focus();
      await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name: /^Share your \d{4}/ })).toBeFocused();
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest.describe("stale data as a viewer", () => {
  viewerTest("sees the notice and why there is no Sync now", async ({ page }) => {
    const workspace = await createTestWorkspace("Stale dashboard viewer");
    try {
      await seedStaleWorkspace(workspace);
      await page.goto(`/w/${workspace.slug}/dashboard`);
      const notice = page.getByRole("region", { name: /^Data last synced 3 days ago$/ });
      await expect(notice).toContainText("Only owners and admins can connect providers.");
      await expect(notice.getByRole("button", { name: "Sync now" })).toHaveCount(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
