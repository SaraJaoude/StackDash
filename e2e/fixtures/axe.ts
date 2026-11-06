import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Scans the whole page with axe and expects no violations, once the document has a title.
 *
 * Every server render of the route (a Server Action that calls `refresh()`, or a live update's
 * `router.refresh()`) keys the page's metadata by its request id
 * (node_modules/next/dist/server/app-render/app-render.js, `getFlightMetadataKey`), so React
 * removes the old `<title>` and mounts the new one in a fresh `Suspense` that stays empty until
 * the metadata row of the streamed response arrives (lib/metadata/metadata.js, `MetadataWrapper`).
 * A scan that lands between the two reports `document-title` for a title the page gets moments
 * later (#179). Waiting for a non-empty title keeps the rule on: a page that never gets one still
 * fails here, on the wait.
 */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/\S/);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
}
