import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

/** Scans the whole page with axe and expects no violations. */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
}
