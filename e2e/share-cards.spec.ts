import AxeBuilder from "@axe-core/playwright";
import { request as playwrightRequest, type APIRequestContext, type Locator, type Page } from "@playwright/test";

import { expect, ownerTest } from "./fixtures/auth";
import { createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";
import { turnOffPage, turnOnPage } from "./fixtures/public-pages";
import { ALL_METRIC_IDS, publishMetrics, seedShareProject, STARS_TODAY } from "./fixtures/share";

// Badges, milestone cards, and the share dialog (#149), the yearly card (#151), and links to the
// project page (#255). Each test creates its own workspace and seeds only inside it, so tests run
// in any order.

const STARS_TEXT = new Intl.NumberFormat("en-US").format(STARS_TODAY);

// The badge's own policy as served (next.config.ts): opened directly, it loads and runs nothing.
const BADGE_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

/** A context with no session, as a README, a social network, or a stranger reads the routes. */
async function anonymous(baseURL: string | undefined): Promise<APIRequestContext> {
  if (baseURL === undefined) throw new Error("baseURL is not configured");
  return playwrightRequest.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
}

/** Width and height from a PNG's IHDR chunk (PNG specification, section 11.2.2). */
function pngSize(body: Buffer): { width: number; height: number } {
  expect(body.subarray(1, 4).toString("latin1")).toBe("PNG");
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

/** The badge as served, with `message` as the text of its right half. */
async function expectBadge(api: APIRequestContext, projectId: string, metricId: string, message: string | RegExp): Promise<string> {
  const response = await api.get(`/badge/${projectId}/${metricId}.svg`);
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["content-type"]).toBe("image/svg+xml; charset=utf-8");
  expect(headers["cache-control"]).toBe("public, max-age=60, s-maxage=60");
  expect(headers["content-security-policy"]).toBe(BADGE_CSP);
  expect(headers["cross-origin-resource-policy"]).toBe("cross-origin");
  expect(headers["set-cookie"]).toBeUndefined();
  const svg = await response.text();
  const shown = /<text [^>]*>([^<]*)<\/text>\s*<\/g>/.exec(svg)?.[1];
  if (typeof message === "string") expect(shown).toBe(message);
  else expect(shown).toMatch(message);
  return svg;
}

async function expectCard(api: APIRequestContext, projectId: string, metricId: string): Promise<Buffer> {
  const response = await api.get(`/card/${projectId}/${metricId}.png`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toBe("image/png");
  expect(response.headers()["set-cookie"]).toBeUndefined();
  const body = await response.body();
  expect(pngSize(body)).toEqual({ width: 1200, height: 630 });
  return body;
}

/** The image finished loading and decoded to its intrinsic size. */
async function expectImageLoaded(image: Locator, width: number): Promise<void> {
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth)).toBe(width);
}

/** The RGB of the image's pixels at its four corners, drawn on a canvas at full size. */
async function cornerColors(image: Locator): Promise<number[][]> {
  return image.evaluate((element: HTMLImageElement) => {
    const canvas = document.createElement("canvas");
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("No 2D canvas");
    context.drawImage(element, 0, 0);
    const { width, height } = canvas;
    return [
      [2, 2],
      [width - 3, 2],
      [2, height - 3],
      [width - 3, height - 3],
    ].map(([x = 0, y = 0]) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)]);
  });
}

function publicMetricsPath(workspace: TestWorkspace, projectId: string): string {
  return `/w/${workspace.slug}/projects/${projectId}/public-metrics`;
}

async function axeViolations(page: Page, selector?: string) {
  const builder = new AxeBuilder({ page });
  return (await (selector === undefined ? builder : builder.include(selector)).analyze()).violations;
}

/** The `url` parameter of a share link's `href`: what the post would link to. */
async function sharedUrl(link: Locator): Promise<string | null> {
  const href = await link.getAttribute("href");
  return href === null ? null : new URL(href).searchParams.get("url");
}

ownerTest.describe("badges and cards", () => {
  ownerTest("publishing serves a live badge and card, and unpublishing turns the badge Unpublished", async ({ page, baseURL }) => {
    const workspace = await createTestWorkspace("Share badge");
    const api = await anonymous(baseURL);
    try {
      const { projectId } = await seedShareProject(workspace);
      // Not published yet: the same neutral badge as an unknown project, with a 200.
      await expectBadge(api, projectId, "github-stars", "Unpublished");

      await page.goto(publicMetricsPath(workspace, projectId));
      await page.getByRole("button", { name: "Publish GitHub stars", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Published GitHub stars." })).toBeVisible();

      const svg = await expectBadge(api, projectId, "github-stars", `${STARS_TEXT} verified`);
      expect(svg).not.toContain("example-github");
      await expectCard(api, projectId, "github-stars");

      await page.getByRole("button", { name: "Unpublish GitHub stars", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Unpublished GitHub stars. It is no longer public." })).toBeVisible();
      await expectBadge(api, projectId, "github-stars", "Unpublished");
      // The card turns into the neutral card, still a 1200 by 630 PNG with a 200.
      await expectCard(api, projectId, "github-stars");
    } finally {
      await api.dispose();
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("every metric in the engine has a badge and a card", async ({ page, baseURL }, testInfo) => {
    const workspace = await createTestWorkspace("Share every metric");
    const api = await anonymous(baseURL);
    try {
      const { projectId } = await seedShareProject(workspace);
      await publishMetrics(workspace, projectId, ALL_METRIC_IDS);
      await page.setViewportSize({ width: 1200, height: 630 });

      for (const metricId of ALL_METRIC_IDS) {
        await ownerTest.step(metricId, async () => {
          // Every seeded metric has a number: the badge shows it as verified, never "Not connected".
          const svg = await expectBadge(api, projectId, metricId, /^[0-9,%]+ verified$/);
          expect(svg).not.toMatch(/Not connected|Not enough history|No data|Stale/);
          // Public surfaces never carry spend, amounts, or account names.
          expect(svg).not.toMatch(/\$|USD|example-/);
          await expectCard(api, projectId, metricId);

          // The card as a browser renders it, attached to the report as this metric's screenshot.
          await page.goto(`/card/${projectId}/${metricId}.png`);
          const image = page.getByRole("img");
          await expectImageLoaded(image, 1200);
          // The card's background reaches every corner: no band of empty image under short content.
          expect(await cornerColors(image)).toEqual(Array.from({ length: 4 }, () => [10, 10, 10]));
          await testInfo.attach(`card-${metricId}`, { body: await page.screenshot(), contentType: "image/png" });
        });
      }
    } finally {
      await api.dispose();
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("the share dialog passes axe and works from the keyboard", async ({ page }) => {
    const workspace = await createTestWorkspace("Share dialog");
    try {
      const { projectId } = await seedShareProject(workspace);
      await publishMetrics(workspace, projectId, ["github-stars"]);
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.goto(publicMetricsPath(workspace, projectId));

      const trigger = page.getByRole("button", { name: "Share GitHub stars", exact: true });
      await trigger.focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Share GitHub stars" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
      await expect(dialog).toContainText("In the last 7 days DevMacro served the badge");

      const markdown = dialog.getByLabel("Badge Markdown for a README");
      await expect(markdown).toHaveValue(new RegExp(`/badge/${projectId}/github-stars\\.svg`));
      const cardUrl = dialog.getByLabel("Card URL");
      await expect(cardUrl).toHaveValue(new RegExp(`/card/${projectId}/github-stars\\.png$`));
      await expect(dialog.getByLabel("Alt text for the card")).toHaveValue(/^DevMacro card\. GitHub stars/);
      await expectImageLoaded(dialog.getByRole("img", { name: /^DevMacro card/ }), 1200);
      const shareToX = dialog.getByRole("link", { name: "Share to X (opens in a new tab)" });
      const shareToLinkedIn = dialog.getByRole("link", { name: "Share to LinkedIn (opens in a new tab)" });
      await expect(shareToX).toHaveAttribute("href", /^https:\/\/x\.com\/intent\/tweet\?text=/);
      await expect(shareToLinkedIn).toHaveAttribute("href", /^https:\/\/www\.linkedin\.com\/sharing\/share-offsite\/\?url=/);
      // The project page is off, so posts link to the card itself and the badge to its formula.
      const link = dialog.getByLabel("Link for a post");
      await expect(link).toHaveValue(await cardUrl.inputValue());
      expect(await sharedUrl(shareToX)).toBe(await cardUrl.inputValue());
      expect(await sharedUrl(shareToLinkedIn)).toBe(await cardUrl.inputValue());
      await expect(markdown).toHaveValue(/\/docs\/architecture\/public-metrics#github-stars\)$/);

      expect(await axeViolations(page, "dialog[open]")).toEqual([]);

      // Every control in reading order, by Tab alone.
      const order = [
        markdown,
        dialog.getByRole("button", { name: "Copy badge Markdown" }),
        cardUrl,
        dialog.getByRole("button", { name: "Copy card URL" }),
        dialog.getByLabel("Alt text for the card"),
        dialog.getByRole("button", { name: "Copy alt text" }),
        link,
        dialog.getByRole("button", { name: "Copy link" }),
        shareToX,
        shareToLinkedIn,
      ];
      for (const control of order) {
        await page.keyboard.press("Tab");
        await expect(control).toBeFocused();
      }
      await page.keyboard.press("Shift+Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(dialog.getByRole("button", { name: "Copy link" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(dialog.getByRole("status")).toHaveText("Copied the link.");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(await cardUrl.inputValue());

      await dialog.getByRole("button", { name: "Copy alt text" }).focus();
      await page.keyboard.press("Enter");
      await expect(dialog.getByRole("status")).toHaveText("Copied the alt text.");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^DevMacro card\. GitHub stars/);

      await page.keyboard.press("Escape");
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      expect(await axeViolations(page)).toEqual([]);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("with the project page on, the card names the project and posts and the badge lead to the page", async ({ page, baseURL }) => {
    const workspace = await createTestWorkspace("Share project page");
    const api = await anonymous(baseURL);
    try {
      const { projectId } = await seedShareProject(workspace);
      await publishMetrics(workspace, projectId, ["github-stars"]);
      const unnamed = await expectCard(api, projectId, "github-stars");
      await turnOnPage(workspace, projectId, "acme-web", false);
      // The same card with the project's name added: the route reads the page, not only the metric.
      const named = await expectCard(api, projectId, "github-stars");
      expect(named.equals(unnamed)).toBe(false);

      await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
      await page.goto(publicMetricsPath(workspace, projectId));
      await page.getByRole("button", { name: "Share GitHub stars", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Share GitHub stars" });
      const pageUrl = new RegExp(`/@${workspace.slug}/acme-web$`);
      const link = dialog.getByLabel("Link for a post");
      await expect(link).toHaveValue(pageUrl);
      const address = await link.inputValue();
      const shareToX = dialog.getByRole("link", { name: "Share to X (opens in a new tab)" });
      expect(await sharedUrl(shareToX)).toBe(address);
      const xText = new URL((await shareToX.getAttribute("href")) ?? "").searchParams.get("text");
      expect(xText).toBe(`GitHub stars for Acme web: ${STARS_TEXT} stars. Verified by DevMacro.`);
      expect(await sharedUrl(dialog.getByRole("link", { name: "Share to LinkedIn (opens in a new tab)" }))).toBe(address);
      expect(await dialog.getByLabel("Badge Markdown for a README").inputValue()).toMatch(new RegExp(`/badge/${projectId}/github-stars\\.svg\\)\\]\\(`));
      expect((await dialog.getByLabel("Badge Markdown for a README").inputValue()).endsWith(`](${address})`)).toBe(true);
      await expect(dialog.getByLabel("Alt text for the card")).toHaveValue(/^DevMacro card for Acme web\. GitHub stars/);
      await expect(dialog).toContainText(`Posts and the badge link to the project page at /@${workspace.slug}/acme-web.`);
      await expectImageLoaded(dialog.getByRole("img", { name: /^DevMacro card for Acme web\./ }), 1200);

      await dialog.getByRole("button", { name: "Copy link" }).click();
      await expect(dialog.getByRole("status")).toHaveText("Copied the link.");
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(address);

      // Turned off, the page answers 404 again: nothing links to it, and the card drops the name.
      await turnOffPage(workspace, projectId);
      expect((await expectCard(api, projectId, "github-stars")).equals(unnamed)).toBe(true);
      await page.reload();
      await page.getByRole("button", { name: "Share GitHub stars", exact: true }).click();
      await expect(link).toHaveValue(new RegExp(`/card/${projectId}/github-stars\\.png$`));
      expect(await sharedUrl(shareToX)).not.toContain("/@");
      await expect(dialog.getByLabel("Badge Markdown for a README")).not.toHaveValue(/\/@/);
    } finally {
      await api.dispose();
      await deleteTestWorkspace(workspace);
    }
  });
});

ownerTest.describe("yearly card", () => {
  ownerTest("shows this year so far and last year in full, shares by download, and stays private", async ({ page, baseURL }, testInfo) => {
    const workspace = await createTestWorkspace("Year card");
    const api = await anonymous(baseURL);
    const year = new Date().getUTCFullYear();
    try {
      await seedShareProject(workspace);
      await page.setViewportSize({ width: 1280, height: 900 });

      await page.goto(`/w/${workspace.slug}/dashboard`);
      await page.getByRole("link", { name: `Your ${year} so far` }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/year/${year}$`));
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Your stack in ${year} so far`);
      await expect(page.getByRole("heading", { level: 2, name: new RegExp(`^Year to date: ${year}-01-01 to `) })).toBeVisible();
      await expect(page.getByText(`${year} is not over yet.`)).toHaveText(
        `${year} is not over yet. This card counts up to today and covers the whole year from ${year + 1}-01-01.`,
      );
      await expectImageLoaded(page.getByRole("img", { name: `Your ${year} year to date card. Its figures are listed below.` }), 1200);
      const figures = page.getByRole("definition");
      await expect(figures).toHaveCount(4);
      await expect(page.getByRole("term")).toHaveText(["Deployments shipped", "Stars gained", "Signups", "Providers connected"]);
      await expect(figures.last()).toHaveText("5");
      expect(await axeViolations(page)).toEqual([]);
      await testInfo.attach(`year-${year}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });

      const trigger = page.getByRole("button", { name: `Share your ${year} year to date card` });
      await trigger.click();
      const dialog = page.getByRole("dialog", { name: `Share your ${year} year to date card` });
      await expect(dialog.getByRole("button", { name: "Close" })).toBeFocused();
      await expect(dialog.getByRole("link", { name: "Download card" })).toHaveAttribute("download", `devmacro-${year}-so-far.png`);
      // Private: no public URL to copy, only the image to download and post.
      await expect(dialog.getByLabel("Card URL")).toHaveCount(0);
      await expect(dialog.getByLabel("Alt text for the card")).toHaveValue(new RegExp(`^DevMacro card: your stack in ${year} so far, `));
      await expect(dialog.getByRole("link", { name: "Share to X (opens in a new tab)" })).toHaveAttribute(
        "href",
        new RegExp(`text=My\\+stack\\+in\\+${year}\\+so\\+far\\+on\\+DevMacro`),
      );
      expect(await axeViolations(page, "dialog[open]")).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();

      // Last year is a whole year: no "so far", and no figure claims days before the data starts.
      await page.getByRole("navigation", { name: "Years" }).getByRole("link", { name: String(year - 1) }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Your stack in ${year - 1}`);
      await expect(page.getByRole("heading", { level: 2, name: `${year - 1}-01-01 to ${year - 1}-12-31` })).toBeVisible();
      await expect(page.getByRole("button", { name: `Share your ${year - 1} card` })).toBeVisible();

      // Members only: without a session the image sends you to sign in, and next year does not exist yet.
      const stranger = await api.get(`/w/${workspace.slug}/year/${year}/card.png`, { maxRedirects: 0 });
      expect(stranger.status()).toBe(307);
      expect(stranger.headers()["location"]).toMatch(/\/sign-in\?next=/);
      const own = await page.request.get(`/w/${workspace.slug}/year/${year}/card.png`);
      expect(own.status()).toBe(200);
      expect(own.headers()["cache-control"]).toBe("private, no-store");
      expect(pngSize(await own.body())).toEqual({ width: 1200, height: 630 });
      expect((await page.request.get(`/w/${workspace.slug}/year/${year + 1}/card.png`)).status()).toBe(404);
      // Like a missing project, a year that has not started renders the workspace's not-found page.
      await page.goto(`/w/${workspace.slug}/year/${year + 1}`);
      await expect(page.getByRole("heading", { name: "We could not find that workspace" })).toBeVisible();
    } finally {
      await api.dispose();
      await deleteTestWorkspace(workspace);
    }
  });
});
