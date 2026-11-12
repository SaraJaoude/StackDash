import { expect, type Locator, type Page } from "@playwright/test";

/** The workspace shell's command palette dialog. */
export function palette(page: Page): Locator {
  return page.getByRole("dialog", { name: "Command palette" });
}

/** The header button that opens the palette. */
export function trigger(page: Page): Locator {
  return page.getByRole("button", { name: "Jump to" });
}

/**
 * Repeats `open` until `dialog` shows. The button's handler and the shortcut listener attach when
 * the shell hydrates, which can land after its streamed HTML is already visible (the dev server
 * compiles the client chunk on first use), and an action before that does nothing. Repeating is
 * safe: an open dialog makes the page inert and the shortcut ignores presses while one is open.
 * Use it for a test's first open only. Later opens are plain, so a bug that breaks re-opening is not
 * retried away.
 */
export async function openWith(dialog: Locator, open: () => Promise<void>): Promise<void> {
  await expect(async () => {
    if (!(await dialog.isVisible())) await open();
    await expect(dialog).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
}
