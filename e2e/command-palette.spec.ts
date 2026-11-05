import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";

import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";

/** A fresh workspace with one Vercel connection, account, and project, and two Vercel events. */
async function seedPaletteWorkspace(label: string): Promise<TestWorkspace> {
  const workspace = await createTestWorkspace(label);
  const admin = adminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({ workspace_id: workspace.id, name: "Checkout" })
    .select("id")
    .single();
  if (projectError) throw new Error(`Seeding a project failed (code ${projectError.code}).`);
  const { data: connection, error: connectionError } = await admin
    .from("connections")
    .insert({
      workspace_id: workspace.id,
      provider: "vercel",
      status: "active",
      display_name: "Vercel palette team",
      poll_interval_seconds: 3600,
    })
    .select("id")
    .single();
  if (connectionError) throw new Error(`Seeding a connection failed (code ${connectionError.code}).`);
  const { data: account, error: accountError } = await admin
    .from("external_accounts")
    .insert({
      workspace_id: workspace.id,
      connection_id: connection.id,
      external_id: "team_palette",
      display_name: "Palette production",
      kind: "team",
      project_id: project.id,
    })
    .select("id")
    .single();
  if (accountError) throw new Error(`Seeding an account failed (code ${accountError.code}).`);
  const base = { workspace_id: workspace.id, connection_id: connection.id, external_account_id: account.id, provider: "vercel" as const };
  const { error: eventsError } = await admin.from("activity_events").insert([
    {
      ...base,
      type_id: "vercel.deployment.failed",
      severity: "critical",
      title: "Palette deploy failed",
      body: "Synthetic failed deployment",
      occurred_at: "2026-11-04T10:00:00Z",
      dedupe_key: "e2e-palette-failed",
    },
    {
      ...base,
      type_id: "vercel.deployment.succeeded",
      severity: "success",
      title: "Palette deploy succeeded",
      body: "Synthetic successful deployment",
      occurred_at: "2026-11-04T11:00:00Z",
      dedupe_key: "e2e-palette-succeeded",
    },
  ]);
  if (eventsError) throw new Error(`Seeding events failed (code ${eventsError.code}).`);
  return workspace;
}

function palette(page: Page) {
  return page.getByRole("dialog", { name: "Command palette" });
}

function combobox(page: Page) {
  return palette(page).getByRole("combobox", { name: "Search commands" });
}

function trigger(page: Page) {
  return page.getByRole("button", { name: "Jump to" });
}

/**
 * The palette shortcut for the page's own platform. The Desktop Chrome device reports a Windows
 * user agent even on a Mac, so Playwright's `ControlOrMeta` (which follows the host) is not used.
 */
async function pressPaletteShortcut(page: Page): Promise<void> {
  const apple = await page.evaluate(() => /Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
  await page.keyboard.press(apple ? "Meta+K" : "Control+K");
}

/**
 * Repeats `open` until `dialog` shows. The button's handler and the shortcut listener attach when
 * the shell hydrates, which can land after its streamed HTML is already visible (the dev server
 * compiles the client chunk on first use), and an action before that does nothing. Repeating is
 * safe: an open dialog makes the page inert and the shortcut ignores presses while one is open.
 */
async function openWith(dialog: Locator, open: () => Promise<void>): Promise<void> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await open();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}

async function expectNoAxeViolations(page: Page) {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
}

ownerTest.describe("command palette as the owner", () => {
  ownerTest("opens from the shell button, filters, and opens the chosen result", async ({ page }) => {
    const workspace = await seedPaletteWorkspace("Palette choose");
    try {
      await page.goto(`/w/${workspace.slug}/dashboard`);
      await openWith(palette(page), () => trigger(page).click());
      await expect(combobox(page)).toBeFocused();
      await expect(palette(page).getByRole("option", { name: "Go to timeline" })).toBeVisible();
      await expectNoAxeViolations(page);

      await combobox(page).fill("failed vercel");
      const options = palette(page).getByRole("option");
      await expect(options).toHaveCount(1);
      await expect(palette(page).getByRole("status")).toHaveText("1 result");
      const failed = palette(page).getByRole("option", { name: "Show timeline for Vercel: Deployment failed" });
      await expect(failed).toHaveAttribute("aria-selected", "true");
      // The selected result is the combobox's active descendant, which is what a screen reader reads.
      await expect(combobox(page)).toHaveAttribute("aria-activedescendant", (await failed.getAttribute("id")) ?? "missing");
      await expectNoAxeViolations(page);

      await page.keyboard.press("Enter");
      await expect(palette(page)).toBeHidden();
      await expect(page).toHaveURL(`/w/${workspace.slug}/timeline?type=vercel.deployment.failed`);
      await expect(page.getByRole("heading", { name: "Palette deploy failed" })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Palette deploy succeeded" })).toHaveCount(0);
      await expect(trigger(page)).toBeFocused();
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("moves through results with the arrow keys and scopes the dashboard to a project", async ({ page }) => {
    const workspace = await seedPaletteWorkspace("Palette arrows");
    try {
      await page.goto(`/w/${workspace.slug}/timeline`);
      await openWith(palette(page), () => trigger(page).click());
      await combobox(page).fill("show dashboard for");
      const options = palette(page).getByRole("option");
      // Provider, then the projects (Checkout, Unassigned), then the account.
      const names = [
        "Show dashboard for provider Vercel",
        "Show dashboard for project Checkout",
        "Show dashboard for project Unassigned",
        "Show dashboard for account Palette production (Vercel palette team)",
      ];
      await expect(options).toHaveCount(names.length);
      for (const [index, name] of names.entries()) await expect(options.nth(index)).toHaveAccessibleName(name);
      const provider = options.nth(0);
      const project = options.nth(1);
      const account = options.nth(3);
      await expect(provider).toHaveAttribute("aria-selected", "true");
      // Before the first result the selection wraps to the last, and back.
      await page.keyboard.press("ArrowUp");
      await expect(account).toHaveAttribute("aria-selected", "true");
      await expect(provider).toHaveAttribute("aria-selected", "false");
      await page.keyboard.press("ArrowDown");
      await expect(provider).toHaveAttribute("aria-selected", "true");
      await page.keyboard.press("ArrowDown");
      await expect(project).toHaveAttribute("aria-selected", "true");
      await expect(combobox(page)).toHaveAttribute("aria-activedescendant", (await project.getAttribute("id")) ?? "missing");

      await page.keyboard.press("Enter");
      await expect(palette(page)).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/dashboard\\?project=[0-9a-f-]{36}$`));
      await expect(page.getByRole("status").filter({ hasText: "project Checkout" })).toBeVisible();
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("leaves Enter and the arrow keys to an IME while it composes", async ({ page }) => {
    const workspace = await createTestWorkspace("Palette IME");
    try {
      await page.goto(`/w/${workspace.slug}/dashboard`);
      await openWith(palette(page), () => trigger(page).click());
      await combobox(page).fill("go to");
      const timeline = palette(page).getByRole("option", { name: "Go to timeline" });
      await expect(timeline).toHaveAttribute("aria-selected", "true");

      // While an IME composes, the browser marks its keys with isComposing: Enter commits the
      // composed text and the arrow keys move through the candidates, so the palette ignores them.
      for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "Enter"]) {
        await combobox(page).dispatchEvent("keydown", { key, isComposing: true });
      }
      await expect(timeline).toHaveAttribute("aria-selected", "true");
      await expect(palette(page)).toBeVisible();
      await expect(page).toHaveURL(`/w/${workspace.slug}/dashboard`);

      // Once the composition ends, the same keys move and choose again.
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("ArrowDown");
      await expect(palette(page).getByRole("option", { name: "Go to connections" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      await page.keyboard.press("Enter");
      await expect(palette(page)).toBeHidden();
      await expect(page).toHaveURL(`/w/${workspace.slug}/connections`);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("keeps the keyboard's selection when the list scrolls under a resting pointer", async ({ page }) => {
    const workspace = await seedPaletteWorkspace("Palette pointer");
    try {
      await page.goto(`/w/${workspace.slug}/timeline`);
      await openWith(palette(page), () => trigger(page).click());
      const options = palette(page).getByRole("option");
      await expect(options.nth(2)).toBeVisible();

      // Moving over a row selects it. Entering only records where the pointer is, so move twice.
      const box = await options.nth(2).boundingBox();
      if (box === null) throw new Error("The third result has no layout box.");
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      await page.mouse.move(x - 8, y);
      await page.mouse.move(x, y);
      await expect(options.nth(2)).toHaveAttribute("aria-selected", "true");

      // Down to the last result scrolls the list, which slides other rows under the resting pointer.
      const total = await options.count();
      for (let index = 2; index < total - 1; index += 1) await page.keyboard.press("ArrowDown");
      const last = options.nth(total - 1);
      await expect(last).toHaveAttribute("aria-selected", "true");
      expect(await palette(page).getByRole("listbox").evaluate((list) => list.scrollTop)).toBeGreaterThan(0);

      // What a browser sends after that scroll (Firefox always does): the row now under the
      // pointer gets an enter and a move at the same position. The selection stays.
      const underId = await page.evaluate(
        ({ x, y }) => {
          const row = document.elementFromPoint(x, y)?.closest('[role="option"]');
          if (!(row instanceof HTMLElement)) return null;
          for (const type of ["pointerover", "pointermove"]) {
            row.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: "mouse" }));
          }
          return row.id;
        },
        { x, y },
      );
      if (underId === null) throw new Error("No result is under the pointer.");
      expect(underId).not.toBe(await last.getAttribute("id"));
      await expect(last).toHaveAttribute("aria-selected", "true");
      await expect(palette(page).getByRole("option", { selected: true })).toHaveCount(1);

      // Real movement selects the row under the pointer again.
      await page.mouse.move(x + 8, y, { steps: 2 });
      await expect(palette(page).locator(`[id="${underId}"]`)).toHaveAttribute("aria-selected", "true");
      await expect(last).toHaveAttribute("aria-selected", "false");
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("opens with the shortcut, keeps focus inside, and Escape returns focus", async ({ page }) => {
    const workspace = await seedPaletteWorkspace("Palette shortcut");
    try {
      await page.goto(`/w/${workspace.slug}/timeline`);
      const navLink = page.getByRole("navigation", { name: "Workspace" }).getByRole("link", { name: "Dashboard" });
      await navLink.focus();
      await openWith(palette(page), () => pressPaletteShortcut(page));
      await expect(combobox(page)).toBeFocused();

      const close = palette(page).getByRole("button", { name: "Close" });
      await page.keyboard.press("Tab");
      await expect(close).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(combobox(page)).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(close).toBeFocused();

      await combobox(page).fill("nothing matches this");
      await expect(palette(page).getByRole("option")).toHaveCount(0);
      await expect(palette(page).getByRole("status")).toContainText('No commands match "nothing matches this"');
      await expect(combobox(page)).toHaveAttribute("aria-expanded", "false");

      await page.keyboard.press("Escape");
      await expect(palette(page)).toBeHidden();
      await expect(navLink).toBeFocused();
      await expect(page).toHaveURL(`/w/${workspace.slug}/timeline`);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("never opens a shortcut while typing in a field", async ({ page }) => {
    const workspace = await createTestWorkspace("Palette typing");
    try {
      await page.goto(`/w/${workspace.slug}/settings`);
      // The shortcut works once the shell has hydrated, so a pass below means the guard held.
      await openWith(palette(page), () => pressPaletteShortcut(page));
      await page.keyboard.press("Escape");
      await expect(palette(page)).toBeHidden();
      // The dialog's close event, which returns focus, fires a task after it hides; wait for it so
      // it cannot pull focus out of the field mid-typing.
      await expect(trigger(page)).toBeFocused();

      const name = page.getByRole("textbox", { name: "Workspace name" });
      await name.fill("");
      await name.focus();
      await pressPaletteShortcut(page);
      await page.keyboard.type("Renamed?");
      await expect(name).toHaveValue("Renamed?");
      await expect(palette(page)).toBeHidden();
      await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeHidden();
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("lists the shortcuts with ? and from the palette", async ({ page }) => {
    const workspace = await createTestWorkspace("Palette help");
    try {
      await page.goto(`/w/${workspace.slug}/timeline`);
      const shortcuts = page.getByRole("dialog", { name: "Keyboard shortcuts" });
      // Focus is on the page itself after load, not in a field.
      await openWith(shortcuts, () => page.keyboard.press("Shift+Slash"));
      await expect(shortcuts).toContainText("Open the command palette");
      await expect(shortcuts.getByRole("button", { name: "Close" })).toBeFocused();
      await expectNoAxeViolations(page);
      await page.keyboard.press("Escape");
      await expect(shortcuts).toBeHidden();

      await openWith(palette(page), () => trigger(page).click());
      await combobox(page).fill("shortcuts");
      await page.keyboard.press("Enter");
      await expect(palette(page)).toBeHidden();
      await expect(shortcuts).toBeVisible();
      await shortcuts.getByRole("button", { name: "Close" }).click();
      await expect(trigger(page)).toBeFocused();
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("offers to connect a provider", async ({ page }) => {
    const workspace = await createTestWorkspace("Palette connect");
    try {
      await page.goto(`/w/${workspace.slug}/timeline`);
      await openWith(palette(page), () => trigger(page).click());
      await combobox(page).fill("connect");
      await palette(page).getByRole("option", { name: "Connect Vercel" }).click();
      await expect(page).toHaveURL(`/w/${workspace.slug}/connections/new/vercel`);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest("a viewer is not offered to connect a provider", async ({ page }) => {
  const workspace = await createTestWorkspace("Palette viewer");
  try {
    await page.goto(`/w/${workspace.slug}/timeline`);
    await openWith(palette(page), () => trigger(page).click());
    await combobox(page).fill("connect");
    await expect(palette(page).getByRole("option", { name: "Go to connections" })).toBeVisible();
    await expect(palette(page).getByRole("option", { name: /^Connect / })).toHaveCount(0);
  } finally {
    await deleteTestWorkspace(workspace);
  }
});
