import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { expectNoAxeViolations } from "./fixtures/axe";
import { createTestWorkspace, deleteTestWorkspace } from "./fixtures/db";

// Each test renames its own workspace, so tests never see each other's names.

ownerTest.describe("renaming a workspace as the owner", () => {
  ownerTest("saves a new name, keeps the URL, and updates the switcher", async ({ page }) => {
    const workspace = await createTestWorkspace("Rename");
    try {
      const settingsUrl = `/w/${workspace.slug}/settings`;
      await page.goto(settingsUrl);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");

      const newName = `Renamed ${workspace.slug}`;
      const field = page.getByLabel("Workspace name");
      await expect(field).toHaveValue(workspace.name);
      await field.fill(`  ${newName}  `);
      await page.getByRole("button", { name: "Save name" }).click();

      await expect(page.getByRole("status").filter({ hasText: "Workspace renamed." })).toBeVisible();
      await expect(page.getByRole("button", { name: `Workspace: ${newName}` })).toBeVisible();
      await expect(page).toHaveURL(new RegExp(`${settingsUrl}$`));

      await page.reload();
      await expect(page.getByLabel("Workspace name")).toHaveValue(newName);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("rejects an empty name and an 81 character name, and accepts 80", async ({ page }) => {
    const workspace = await createTestWorkspace("Rename bounds");
    try {
      await page.goto(`/w/${workspace.slug}/settings`);
      const field = page.getByLabel("Workspace name");
      const save = page.getByRole("button", { name: "Save name" });

      await field.fill("   ");
      await save.click();
      await expect(field).toHaveAttribute("aria-invalid", "true");
      await expect(field).toHaveAccessibleDescription(/Enter a workspace name\./);
      await expect(page.getByRole("status").filter({ hasText: "The name was not saved." })).toBeVisible();

      await field.fill("a".repeat(81));
      await save.click();
      await expect(field).toHaveAccessibleDescription(/Use 80 characters or fewer\./);
      // The rejected value stays in the field so it can be corrected.
      await expect(field).toHaveValue("a".repeat(81));

      await field.fill("b".repeat(80));
      await save.click();
      await expect(page.getByRole("status").filter({ hasText: "Workspace renamed." })).toBeVisible();
      await expect(field).not.toHaveAttribute("aria-invalid", "true");
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("keeps focus on Save name through a keyboard save and blocks a second save while pending", async ({ page }) => {
    const workspace = await createTestWorkspace("Rename focus");
    try {
      const settingsUrl = `/w/${workspace.slug}/settings`;
      // Hold the Server Action request, so the pending state can be checked before it settles.
      const { promise: held, resolve: release } = Promise.withResolvers<void>();
      let saves = 0;
      await page.route(new RegExp(`${settingsUrl}$`), async (route) => {
        if (route.request().method() !== "POST") return route.fallback();
        saves += 1;
        await held;
        return route.fallback();
      });
      await page.goto(settingsUrl);
      await page.getByLabel("Workspace name").fill(`Kept focus ${workspace.slug}`);
      const save = page.getByRole("button", { name: "Save name" });
      await save.focus();
      await page.keyboard.press("Enter");

      // Pending: announced as unavailable, still focused, and a second Enter sends nothing.
      const saving = page.getByRole("button", { name: "Saving" });
      await expect(saving).toHaveAttribute("aria-disabled", "true");
      await expect(saving).toBeFocused();
      await page.keyboard.press("Enter");
      release();

      await expect(page.getByRole("status").filter({ hasText: "Workspace renamed." })).toBeVisible();
      await expect(save).not.toHaveAttribute("aria-disabled");
      await expect(save).toBeFocused();
      expect(saves).toBe(1);
      await expectNoAxeViolations(page);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest.describe("renaming a workspace as a viewer", () => {
  viewerTest("shows the name and the reason, with no form", async ({ page }) => {
    const workspace = await createTestWorkspace("Viewer rename");
    try {
      await page.goto(`/w/${workspace.slug}/settings`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Settings");

      // Scoped to main: the header switcher shows the name too.
      await expect(page.getByRole("main").getByText(workspace.name, { exact: true })).toBeVisible();
      await expect(page.getByText("Only owners and admins can rename this workspace.")).toBeVisible();
      await expect(page.getByLabel("Workspace name")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Save name" })).toHaveCount(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
