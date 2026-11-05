import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Locator, type Page } from "@playwright/test";

import { ownerTest } from "./fixtures/auth";
import { createTestWorkspace, deleteTestWorkspace } from "./fixtures/db";

// textContent, not innerText: toHaveText compares textContent, and innerText applies CSS such as
// line breaks.
async function newestEvent(rows: Locator): Promise<string> {
  const text = await rows.first().textContent();
  if (!text) throw new Error("The newest live event has no text");
  return text;
}

// Waits until every animation inside the element has finished, so a measurement starts and ends on
// a settled layout. It runs in the page, so it must not reference anything outside itself.
async function settleAnimations(element: Element): Promise<void> {
  await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished));
}

test.describe("landing page", () => {
  test("states the product and sends the primary action to the GitHub repository", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("The big picture of your developer stack.");
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);

    const ctas = page.getByRole("link", { name: "Follow on GitHub" });
    await expect(ctas).toHaveCount(3);
    for (const cta of await ctas.all()) {
      await expect(cta).toHaveAttribute("href", "https://github.com/eddiejaoude/DevMacro");
    }
  });

  test("the header and footer show the brand and lead to the docs and sign in", async ({ page }) => {
    await page.goto("/");

    for (const region of [page.getByRole("banner"), page.getByRole("contentinfo")]) {
      await expect(region.getByRole("img", { name: "DevMacro", exact: true })).toBeVisible();
      await expect(region.getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("href", "/docs");
      await expect(region.getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/sign-in");
    }

    await page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/sign-in");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
  });

  test("the brand and sign in share one header row on a phone", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");

    const brand = page.getByRole("banner").getByRole("img", { name: "DevMacro", exact: true });
    const signIn = page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true });
    await expect(brand).toBeVisible();
    await expect(signIn).toBeVisible();

    // When the actions wrap below the brand, the two boxes stop overlapping vertically.
    const brandBox = await brand.boundingBox();
    const signInBox = await signIn.boundingBox();
    if (!brandBox || !signInBox) throw new Error("The header brand or Sign in link has no layout box");
    expect(signInBox.y).toBeLessThan(brandBox.y + brandBox.height);
    expect(brandBox.y).toBeLessThan(signInBox.y + signInBox.height);
  });

  test("every in-page navigation link lands on a section that exists", async ({ page }) => {
    await page.goto("/");

    const hrefs = await page
      .getByRole("navigation")
      .getByRole("link")
      .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
    const anchors = [...new Set(hrefs.filter((href) => href.startsWith("#")))];
    expect(anchors.length).toBeGreaterThan(0);

    for (const anchor of anchors) {
      await expect(page.locator(anchor), `${anchor} has no matching section`).toHaveCount(1);
    }
  });

  test("labels the illustrative dashboard as example data", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByText("Example data.", { exact: false }).first()).toBeVisible();
  });

  test.describe("live events feed", () => {
    // A fake clock drives the feed's interval, so no test waits on real seconds. The feed only
    // ticks once hydrated, so each step retries until the hydrated feed responds.
    test.beforeEach(async ({ page }) => {
      await page.clock.install();
    });

    test("a new event arrives on top while streaming, and pausing stops it", async ({ page }) => {
      await page.goto("/");
      const rows = page.getByRole("list", { name: "Example live events" }).getByRole("listitem");
      await expect(rows).toHaveCount(10);
      const firstEvent = await newestEvent(rows);

      await expect(async () => {
        await page.clock.runFor(3_000);
        await expect(rows.first()).not.toHaveText(firstEvent, { timeout: 500 });
      }).toPass();
      await expect(rows, "the leaving row stays out of the accessibility tree").toHaveCount(10);

      await page.getByRole("button", { name: "Pause live events" }).click();
      await expect(page.getByRole("button", { name: "Resume live events" })).toBeVisible();
      const pausedEvent = await newestEvent(rows);
      await page.clock.runFor(30_000);
      await expect(rows.first()).toHaveText(pausedEvent);
    });

    test("starts paused when the visitor prefers reduced motion", async ({ page }) => {
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/");
      const rows = page.getByRole("list", { name: "Example live events" }).getByRole("listitem");
      await expect(page.getByRole("button", { name: "Resume live events" })).toBeVisible();
      const firstEvent = await newestEvent(rows);

      await page.clock.runFor(30_000);
      await expect(rows.first()).toHaveText(firstEvent);

      await page.getByRole("button", { name: "Resume live events" }).click();
      await expect(async () => {
        await page.clock.runFor(3_000);
        await expect(rows.first()).not.toHaveText(firstEvent, { timeout: 500 });
      }).toPass();
    });

    // 64rem is the lg breakpoint: from it the feed sits beside the month column and shows ten
    // rows, below it the columns stack and the feed shows six.
    const layouts = [
      { name: "a phone", viewport: { width: 390, height: 844 }, rows: 6 },
      { name: "one pixel below the lg breakpoint", viewport: { width: 1023, height: 900 }, rows: 6 },
      { name: "the lg breakpoint", viewport: { width: 1024, height: 900 }, rows: 10 },
    ] as const;

    for (const layout of layouts) {
      test(`the feed height never dips while an event arrives on ${layout.name}`, async ({ page }) => {
        await page.setViewportSize(layout.viewport);
        await page.goto("/");
        // Jump the page clock a minute ahead and freeze it, so no real-time tick lands mid-measurement.
        // pauseAt fires each due timer at most once, so a feed tick already due can fire during the
        // jump; settleAnimations below absorbs it before the controlled 3-second tick.
        await page.clock.pauseAt(Date.now() + 60_000);
        const list = page.getByRole("list", { name: "Example live events" });
        const rows = list.getByRole("listitem");
        await list.evaluate(settleAnimations);
        await expect(rows).toHaveCount(layout.rows);
        const firstEvent = await newestEvent(rows);

        // Every height the list takes while the rows open and close, starting with the settled one.
        const heights = await list.evaluateHandle((element) => {
          const seen = [element.getBoundingClientRect().height];
          new ResizeObserver(() => seen.push(element.getBoundingClientRect().height)).observe(element);
          return seen;
        });

        await expect(async () => {
          await page.clock.runFor(3_000);
          await expect(rows.first()).not.toHaveText(firstEvent, { timeout: 500 });
        }).toPass();
        await list.evaluate(settleAnimations);

        // The opening and closing rows move together, so the height only travels between the
        // settled heights before and after, which differ when the two rows wrap differently.
        const seen = await heights.jsonValue();
        const before = seen[0];
        if (before === undefined) throw new Error("The settled list height was not recorded");
        const after = await list.evaluate((element) => element.getBoundingClientRect().height);
        const lowest = Math.min(before, after) - 1;
        const highest = Math.max(before, after) + 1;
        for (const height of seen) {
          expect(height, `list height ${height} left the range ${lowest} to ${highest}`).toBeGreaterThanOrEqual(lowest);
          expect(height, `list height ${height} left the range ${lowest} to ${highest}`).toBeLessThanOrEqual(highest);
        }
        await expect(rows, "the closed row leaves the accessibility tree").toHaveCount(layout.rows);
      });
    }
  });
});

/**
 * Keyboard only, from a fresh load: the first Tab reaches the skip link, Enter moves focus onto
 * the main landmark, and the next Tab continues inside it rather than at the page navigation. The
 * focusable landmark must not cost an accessibility violation either.
 */
async function expectSkipToContent(page: Page): Promise<void> {
  const skip = page.getByRole("link", { name: "Skip to content" });
  const main = page.getByRole("main");
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main$/);
  await expect(main).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(page.locator("main :focus")).toHaveCount(1);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
}

test.describe("skip to content", () => {
  // The landing page fades its hero in; a scan mid-fade reports contrast the settled page has not.
  test.use({ reducedMotion: "reduce" });

  for (const route of ["/", "/docs", "/sign-in"]) {
    test(`moves keyboard focus to the main content on ${route}`, async ({ page }) => {
      await page.goto(route);
      await expectSkipToContent(page);
    });
  }

  test("moves focus again when the address already ends in #main", async ({ page }) => {
    await page.goto("/");
    await expectSkipToContent(page);
    // A second press is a navigation to the fragment already in the address bar.
    await page.getByRole("link", { name: "Skip to content" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("main")).toBeFocused();
  });

  ownerTest("moves keyboard focus past the workspace navigation", async ({ page }) => {
    const workspace = await createTestWorkspace("Skip link");
    try {
      await page.goto(`/w/${workspace.slug}/dashboard`);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expectSkipToContent(page);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
