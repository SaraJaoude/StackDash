import { expect, type Page } from "@playwright/test";

/** Next.js mounts its route announcer from an effect, so it exists only once the page hydrated. */
export async function expectHydrated(page: Page): Promise<void> {
  await expect(page.locator("next-route-announcer")).toBeAttached();
}
