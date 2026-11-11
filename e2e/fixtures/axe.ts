import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/**
 * Scans the whole page with axe and expects no violations, once the document has a title.
 *
 * Every server render of the route keys the page's metadata by its request id
 * (node_modules/next/dist/server/app-render/app-render.js, `getFlightMetadataKey`): a Server Action
 * that calls `refresh()`, a live update's `router.refresh()`, and a client navigation (`<Link>`,
 * `router.push`) alike. React removes the old `<title>` and mounts the new one in a fresh
 * `Suspense` that stays empty until the metadata row of the streamed response arrives
 * (lib/metadata/metadata.js, `MetadataWrapper`). A scan that lands between the two reports
 * `document-title` for a title the page gets moments later (#179). So every full-page scan that
 * follows any of those renders goes through here. Only scans after a document load (`page.goto`,
 * `reload`) stay inline, because the document's HTML carries the title in `<head>`. Waiting for a
 * non-empty title keeps the rule on: a page that never gets one still fails here, on the wait.
 *
 * The wait covers the last render before the scan. When an action also writes a live table, a
 * second render follows it, so wait for that one first (`watchLiveRefresh` in ./realtime.ts).
 */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/\S/);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
}

/**
 * Trends streams in behind its own Suspense boundary after the rest of the dashboard (#263), so a
 * whole-page axe scan of the dashboard waits for it; otherwise it could scan the loading skeleton,
 * not the charts. Only a dashboard with a connection has Trends: the first-provider empty state does not.
 */
export async function waitForTrends(page: Page): Promise<void> {
  await expect(page.getByRole("region", { name: "Trends" })).toBeVisible();
}
