import { expect, type Locator, type Page } from "@playwright/test";

/**
 * Presses Tab until `target` has focus, the way a keyboard user reaches it, and fails if it still
 * does not after `maxPresses`. It checks before each press, so a target that already has focus
 * stays focused rather than being tabbed past.
 */
export async function tabTo(page: Page, target: Locator, maxPresses: number): Promise<void> {
  for (let presses = 0; presses < maxPresses; presses += 1) {
    if (await target.evaluate((element) => element === document.activeElement)) return;
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
}
