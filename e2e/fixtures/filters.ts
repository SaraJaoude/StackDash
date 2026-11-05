import { expect, type Page } from "@playwright/test";

/**
 * Opens the shared filter bar (dashboard and timeline) so its checkboxes can be used. The form
 * sits in a `details` element that is hidden from the accessibility tree until opened, and a page
 * load or a client navigation renders it closed, so it is only toggled when closed. `keyboard`
 * opens it the way a keyboard user would: focus the summary and press Enter.
 */
export async function openFilters(page: Page, input: "pointer" | "keyboard" = "pointer"): Promise<void> {
  const filters = page.getByRole("region", { name: "Filters", exact: true });
  const summary = filters.locator("summary");
  if ((await filters.locator("details").getAttribute("open")) === null) {
    if (input === "keyboard") {
      await summary.focus();
      await page.keyboard.press("Enter");
    } else {
      await summary.click();
    }
  }
  await expect(filters.getByRole("button", { name: "Apply filters" })).toBeVisible();
}

function filterBar(page: Page) {
  return page.getByRole("region", { name: "Filters", exact: true });
}

/** Ticks every option in one of the filter's groups ("Provider", "Project", "Account"). */
export async function checkEvery(page: Page, group: string): Promise<void> {
  for (const box of await filterBar(page).getByRole("group", { name: group }).getByRole("checkbox").all()) {
    await box.check();
  }
}

/** A closed bar is one row tall: the status and the summary, with no empty row for the form. */
export async function expectClosedFilterBarOneRow(page: Page): Promise<void> {
  const filters = filterBar(page);
  await expect(filters.getByRole("button", { name: "Apply filters" })).toBeHidden();
  const [barBox, statusBox] = await Promise.all([filters.boundingBox(), filters.getByRole("status").boundingBox()]);
  if (barBox === null || statusBox === null) throw new Error("The filter bar is not rendered.");
  // The bar's own top and bottom borders are the only difference.
  expect(barBox.height - statusBox.height).toBeLessThanOrEqual(2.5);
}

/**
 * The open form starts below the last line of the status sentence (#164). It first checks that
 * the status really wraps, the case where the form used to draw across it, so it cannot pass on a
 * status that fits one line.
 */
export async function expectFormBelowWrappedStatus(page: Page): Promise<void> {
  const filters = filterBar(page);
  const status = filters.getByRole("status");
  const lines = await status.evaluate((element) => {
    const range = document.createRange();
    range.selectNodeContents(element);
    return new Set([...range.getClientRects()].map((rect) => Math.round(rect.top))).size;
  });
  expect(lines, "the status wraps onto more than one line").toBeGreaterThan(1);
  const [statusBox, formBox] = await Promise.all([status.boundingBox(), filters.locator("form").boundingBox()]);
  if (statusBox === null || formBox === null) throw new Error("The filter bar is not rendered.");
  expect(formBox.y).toBeGreaterThanOrEqual(statusBox.y + statusBox.height - 0.5);
}
