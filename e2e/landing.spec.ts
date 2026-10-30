import { expect, test, type Locator } from "@playwright/test";

// textContent, not innerText: toHaveText compares textContent, and innerText applies CSS such as
// uppercase badges and line breaks.
async function newestEvent(rows: Locator): Promise<string> {
  const text = await rows.first().textContent();
  if (!text) throw new Error("The newest live event has no text");
  return text;
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
  });
});
