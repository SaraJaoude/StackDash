import { expect, type Locator, type Page } from "@playwright/test";

import { expectHydrated } from "./hydration";

/**
 * Opens a create form on alert settings from its "New" button (#343) and returns the form. The
 * button only works once the page has hydrated, so this waits for that first rather than clicking
 * a server-rendered button that does nothing yet. `scope` narrows the button to one section.
 */
export async function openCreateForm(page: Page, button: string, form: string, scope: Page | Locator = page): Promise<Locator> {
  await expectHydrated(page);
  await scope.getByRole("button", { name: button, exact: true }).click();
  const opened = scope.getByRole("form", { name: form });
  await expect(opened).toBeVisible();
  return opened;
}
