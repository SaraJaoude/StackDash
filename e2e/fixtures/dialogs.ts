import { expect, type Locator, type Page } from "@playwright/test";

import { expectNoAxeViolations } from "./axe";
import { expectHydrated } from "./hydration";

/**
 * A keyboard-only pass through a confirmation whose action fails (#323), with an axe scan of the
 * failure. Opens the dialog from `trigger` with Enter, runs `breakIt` to make the action fail on
 * the server (delete the row it targets, say), confirms with Tab and Enter, and expects the error
 * inside the still-open dialog: in its assertive live region and focused. Tab then reaches Cancel,
 * and Escape closes the dialog and returns focus to the trigger.
 */
export async function expectFailureInDialog(
  page: Page,
  {
    trigger,
    dialog,
    confirmName,
    breakIt,
    message,
  }: {
    trigger: Locator;
    dialog: Locator;
    confirmName: string;
    breakIt: () => Promise<void>;
    message: string;
  },
): Promise<void> {
  // Enter before hydration reaches a button with no click handler yet.
  await expectHydrated(page);
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  await expect(cancel).toBeFocused();

  await breakIt();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: confirmName, exact: true })).toBeFocused();
  await page.keyboard.press("Enter");

  await expect(dialog.getByRole("alert")).toHaveText(message);
  await expect(dialog.getByText(message)).toBeFocused();
  await expect(dialog).toBeVisible();
  await expectNoAxeViolations(page);

  await page.keyboard.press("Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
}
