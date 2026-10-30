import { expect, test } from "@playwright/test";

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
});
