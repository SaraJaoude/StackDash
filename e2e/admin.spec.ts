import { test, type Page } from "@playwright/test";

import { E2E_USERS, expect, ownerTest, viewerTest } from "./fixtures/auth";
import { expectNoAxeViolations } from "./fixtures/axe";
import { adminClient, createTestWorkspace, cronSecret, deleteTestWorkspace } from "./fixtures/db";
import { expectTopRowFits } from "./fixtures/header";
import { expectHydrated } from "./fixtures/hydration";
import { tabTo } from "./fixtures/keyboard";
import { openWith, palette, trigger } from "./fixtures/palette";

// playwright.config.ts names the e2e owner, and only the owner, in DEVMACRO_SUPER_ADMIN_EMAILS.

const OWNER_ACCOUNT = `Account: ${E2E_USERS.owner.userName}`;

function adminLink(page: Page) {
  return page.getByRole("banner").getByRole("link", { name: "Admin", exact: true });
}

function accountLink(page: Page) {
  return page.getByRole("banner").getByRole("link", { name: OWNER_ACCOUNT, exact: true });
}

/** Opens the palette, searches "open admin", and takes the one result to the overview. */
async function openAdminFromPalette(page: Page): Promise<void> {
  await openWith(palette(page), () => trigger(page).click());
  await palette(page).getByRole("combobox", { name: "Search commands" }).fill("open admin");
  await expect(palette(page).getByRole("option")).toHaveCount(1);
  const admin = palette(page).getByRole("option", { name: "Admin", exact: true });
  await expect(admin).toHaveAccessibleDescription("Page");
  await expect(admin).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/app/admin");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Instance overview");
}

ownerTest.describe("the instance overview as a super admin", () => {
  ownerTest("shows each section, counts a new workspace's members and events, and never shows a secret", async ({ page }) => {
    const workspace = await createTestWorkspace("Instance overview");
    try {
      const { error } = await adminClient()
        .from("activity_events")
        .insert(
          [1, 2, 3].map((n) => ({
            workspace_id: workspace.id,
            type_id: "devmacro.daily_summary",
            severity: "info" as const,
            title: "Daily summary",
            occurred_at: new Date(Date.UTC(2026, 10, n)).toISOString(),
            dedupe_key: `admin-overview-${workspace.id}-${n}`,
          })),
        );
      if (error) throw new Error(`Seeding events failed (code ${error.code}).`);

      const response = await page.goto("/app/admin");
      expect(response?.status()).toBe(200);
      await expect(page).toHaveTitle("Instance overview · DevMacro");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Instance overview");
      for (const section of ["Usage", "Configuration", "Providers", "Background jobs", "Workspaces", "Deployment"]) {
        await expect(page.getByRole("heading", { level: 2, name: section })).toBeVisible();
      }

      // Newest first, so the workspace this test just made is on the first page: two members
      // (owner and viewer), no connections, three events.
      const row = page.getByRole("region", { name: "Workspace figures" }).getByRole("row").filter({ hasText: workspace.name });
      await expect(row.getByRole("cell")).toHaveText([/./, "2", "0", "3"]);

      const settings = page.getByRole("region", { name: "Settings" });
      await expect(settings.getByRole("row", { name: /Scheduler secret/ })).toContainText("Set");
      await expect(settings.getByRole("row", { name: /Simulated providers/ })).toContainText("On");
      expect(await page.content()).not.toContain(cronSecret());

      await expectNoAxeViolations(page);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("reaches the overview from the workspace header's Admin link, by keyboard", async ({ page }) => {
    const workspace = await createTestWorkspace("Admin link");
    try {
      await page.goto(`/w/${workspace.slug}/timeline`);
      await expect(adminLink(page)).toHaveAttribute("href", "/app/admin");
      await expectNoAxeViolations(page);

      await expectHydrated(page);
      await tabTo(page, adminLink(page), 10);
      await expect(adminLink(page)).toHaveCSS("outline-style", "solid");
      await page.keyboard.press("Enter");
      await expect(page).toHaveURL("/app/admin");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Instance overview");
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("reaches the overview from the command palette as \"open admin\"", async ({ page }) => {
    const workspace = await createTestWorkspace("Admin palette");
    try {
      await page.goto(`/w/${workspace.slug}/timeline`);
      await openAdminFromPalette(page);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("keeps the Admin link off a phone's header row, and the palette still reaches the overview there", async ({ page }) => {
    const workspace = await createTestWorkspace("Admin phone");
    try {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(`/w/${workspace.slug}/timeline`);
      await expect(accountLink(page)).toBeVisible();
      await expect(adminLink(page)).toBeHidden();
      await expectTopRowFits(page, OWNER_ACCOUNT);
      await openAdminFromPalette(page);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  // The link starts at lg: below it, the role badge and the account name leave the workspace
  // switcher too little room beside it (#364).
  ownerTest("shows the Admin link from the lg breakpoint, with the workspace name still in full", async ({ page }) => {
    const workspace = await createTestWorkspace("Admin breakpoint");
    try {
      const switcherName = page.getByRole("banner").getByRole("button", { name: /^Workspace: / }).getByText(workspace.name, { exact: true });
      const nameFits = () => switcherName.evaluate((element) => element.scrollWidth <= element.clientWidth);

      await page.setViewportSize({ width: 1023, height: 720 });
      await page.goto(`/w/${workspace.slug}/timeline`);
      await expect(accountLink(page)).toBeVisible();
      await expect(adminLink(page)).toBeHidden();
      await expectTopRowFits(page, OWNER_ACCOUNT);
      expect(await nameFits()).toBe(true);

      await page.setViewportSize({ width: 1024, height: 720 });
      await expect(adminLink(page)).toBeVisible();
      await expectTopRowFits(page, OWNER_ACCOUNT, { adminLink: true });
      expect(await nameFits()).toBe(true);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest("a signed-in user who is not a super admin gets page not found", async ({ page }) => {
  const response = await page.goto("/app/admin");
  expect(response?.status()).toBe(404);
  await expect(page).toHaveTitle("Page not found · DevMacro");
  await expect(page.getByRole("heading", { level: 1, name: "We could not find that page" })).toBeVisible();
  await expect(page.getByText("Instance overview")).toHaveCount(0);
});

viewerTest("a signed-in user who is not a super admin is offered no way to the overview", async ({ page }) => {
  const workspace = await createTestWorkspace("Admin hidden");
  try {
    const response = await page.goto(`/w/${workspace.slug}/timeline`);
    // The whole streamed response, HTML and RSC payload, so a link hidden only by style would fail too.
    expect(await response?.text()).not.toContain("/app/admin");
    await expect(page.getByRole("banner").getByRole("link", { name: "Account" })).toBeVisible();
    await expect(adminLink(page)).toHaveCount(0);

    await openWith(palette(page), () => trigger(page).click());
    await palette(page).getByRole("combobox", { name: "Search commands" }).fill("admin");
    await expect(palette(page).getByRole("option")).toHaveCount(0);
    await expect(palette(page).getByText('No commands match "admin"')).toBeVisible();
  } finally {
    await deleteTestWorkspace(workspace);
  }
});

test("a signed-out visitor is sent to sign in and back", async ({ page }) => {
  await page.goto("/app/admin");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp%2Fadmin$/);
});
