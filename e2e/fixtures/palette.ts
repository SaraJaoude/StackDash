import { expect, type Locator, type Page } from "@playwright/test";

/** The workspace shell's command palette dialog. */
export function palette(page: Page): Locator {
  return page.getByRole("dialog", { name: "Command palette" });
}

/** The header button that opens the palette. */
export function trigger(page: Page): Locator {
  return page.getByRole("button", { name: "Jump to" });
}

/** The palette's search field. */
export function combobox(page: Page): Locator {
  return palette(page).getByRole("combobox", { name: "Search commands" });
}

/**
 * One result by its label, which is its accessible name, and its kind, which is its accessible
 * description and the secondary text beside the label. Exact, because "Vercel" is the name of a
 * provider dashboard and a provider timeline, and part of other names. Find a result this way, not
 * by counting: the e2e owner and viewer belong to every spec's test workspace, and each one is a
 * `Workspace` result that matches its own name.
 */
export function option(page: Page, label: string, kind: string): Locator {
  return palette(page)
    .getByRole("option", { name: label, exact: true })
    .filter({ has: page.getByText(kind, { exact: true }) });
}

/** Every result of one kind, whatever its name. */
export function optionsOfKind(page: Page, kind: string): Locator {
  return palette(page)
    .getByRole("option")
    .filter({ has: page.getByText(kind, { exact: true }) });
}

/** The live region that counts the results, beside the one that reports an action's progress. */
export function resultCount(page: Page): Locator {
  return palette(page)
    .getByRole("status")
    .filter({ hasText: /results?\b|No commands match/ });
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
