import { test } from "@playwright/test";

import { expect, ownerTest, signOutTest } from "./fixtures/auth";

test.describe("signed out", () => {
  test("visiting the app redirects to sign-in and keeps where you were going", async ({ page }) => {
    await page.goto("/app");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);

    await page.goto("/w/someworkspace/dashboard");
    await expect(page).toHaveURL(/\/sign-in\?next=%2Fw%2Fsomeworkspace%2Fdashboard$/);
  });

  test("the sign-in page offers GitHub only and has a sound structure", async ({ page }) => {
    await page.goto("/sign-in");

    await expect(page).toHaveTitle(/Sign in/);
    await expect(page.getByRole("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
    await expect(page.getByText("DevMacro is invite only during the test.")).toBeVisible();

    const buttons = page.getByRole("main").getByRole("button");
    await expect(buttons).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeEnabled();
    await expect(page.getByRole("main").getByRole("textbox")).toHaveCount(0);
    // Scoped to main: Next.js renders its own route announcer as a live region.
    await expect(page.getByRole("main").getByRole("status")).toBeAttached();
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
  });

  test("a not-invited error explains what to do next", async ({ page }) => {
    await page.goto("/sign-in?error=not_invited");
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "This GitHub account's email has not been invited to the DevMacro test. Ask for an invite, then try again.",
    );
  });

  test("an unknown error code is ignored", async ({ page }) => {
    await page.goto("/sign-in?error=%3Cscript%3E");
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeVisible();
  });

  test("sign-out refuses a cross-site post", async ({ request }) => {
    const response = await request.post("/auth/sign-out", {
      headers: { Origin: "https://evil.example" },
      maxRedirects: 0,
    });
    expect(response.status()).toBe(403);
  });
});

ownerTest("a signed-in user visiting sign-in is sent into the app", async ({ page }) => {
  await page.goto("/sign-in");
  await expect(page).not.toHaveURL(/\/sign-in/);
  await expect(page).toHaveURL(/\/(app|w\/)/);
});

ownerTest("the app and a workspace root open on the timeline", async ({ page }) => {
  await page.goto("/app");
  await expect(page).toHaveURL(/\/w\/[a-z0-9]+\/timeline$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Timeline");

  const slug = new URL(page.url()).pathname.split("/")[2];
  await page.goto(`/w/${slug}`);
  await expect(page).toHaveURL(new RegExp(`/w/${slug}/timeline$`));

  const switcher = page.getByRole("button", { name: /^Workspace: / });
  await switcher.click();
  await expect(switcher).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("link", { name: /Current$/ })).toHaveAttribute("href", `/w/${slug}/timeline`);
});

signOutTest("signing out ends the session", async ({ page }) => {
  await page.goto("/app");
  await expect(page).not.toHaveURL(/\/sign-in/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Fapp$/);
});
