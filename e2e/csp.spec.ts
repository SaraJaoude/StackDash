import { test, type Page } from "@playwright/test";

import { authEnv, expect, ownerTest } from "./fixtures/auth";
import { createTestWorkspace, deleteTestWorkspace } from "./fixtures/db";

// Content security policy (#125). App routes enforce a per-request nonce policy (src/proxy.ts) and
// render their HTML per request so Next.js can stamp the nonce on every script; the rest of the
// site keeps a static policy (next.config.ts). CI runs these against the production build, where a
// prerendered shell would carry unnonced inline scripts and never hydrate.

// The enforced policy of the landing page (next.config.ts).
const BASELINE_CSP = "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

const NONCE_SOURCE = /^'nonce-[A-Za-z0-9+/=]+'$/;

declare global {
  interface Window {
    reportCspViolation?: (violation: string) => Promise<void>;
  }
}

function directives(policy: string): Map<string, string[]> {
  return new Map(
    policy.split(";").map((directive): [string, string[]] => {
      const [name = "", ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

/**
 * App routes enforce the landing directives plus the nonce policy. form-action also allows
 * exactly the no-JavaScript sign-in chain (Supabase Auth, then GitHub), because browsers check
 * form-action on every redirect after a form post. The connect form leaves by meta refresh, not a
 * redirect, so no provider origin is listed.
 */
function expectAppPolicy(policy: string | undefined): void {
  const app = directives(policy ?? "");
  for (const [name, sources] of directives(BASELINE_CSP)) {
    if (name !== "form-action") expect(app.get(name), name).toEqual(sources);
  }
  const supabaseUrl = new URL(authEnv().NEXT_PUBLIC_SUPABASE_URL);
  expect(new Set(app.get("form-action"))).toEqual(new Set(["'self'", supabaseUrl.origin, "https://github.com"]));
  // Scripts from this origin or carrying this response's nonce, and nothing else: no
  // 'unsafe-inline', and no 'unsafe-eval' outside development.
  expect(app.get("script-src")).toEqual(["'self'", expect.stringMatching(NONCE_SOURCE)]);
  // Live updates (#129) need the Realtime socket.
  expect(app.get("connect-src")).toContain(`${supabaseUrl.protocol === "https:" ? "wss:" : "ws:"}//${supabaseUrl.host}`);
}

/**
 * Collects every CSP violation the page reports, from the DOM event (enforced and report-only
 * alike) and from the browser console, across navigations. Call before the first `goto`.
 */
async function watchViolations(page: Page): Promise<string[]> {
  const violations: string[] = [];
  await page.exposeFunction("reportCspViolation", (violation: string) => {
    violations.push(violation);
  });
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (event) => {
      void window.reportCspViolation?.(
        `${event.disposition} ${event.effectiveDirective}: ${event.blockedURI} on ${location.pathname}`,
      );
    });
  });
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  return violations;
}

/** Next.js mounts its route announcer from an effect, so it exists only once the page hydrated. */
async function expectHydrated(page: Page): Promise<void> {
  await expect(page.locator("next-route-announcer")).toBeAttached();
}

test.describe("signed out", () => {
  test("the landing page keeps its static policy without a nonce", async ({ page }) => {
    const response = await page.goto("/");
    const headers = response?.headers() ?? {};
    expect(headers["content-security-policy"]).toBe(BASELINE_CSP);
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
  });

  test("the sign-in page enforces the nonce policy, hydrates, and reports no violations", async ({ page }) => {
    const violations = await watchViolations(page);
    const response = await page.goto("/sign-in");

    const headers = response?.headers() ?? {};
    expectAppPolicy(headers["content-security-policy"]);
    expect(headers["content-security-policy-report-only"]).toBeUndefined();
    await expect(page.getByRole("button", { name: "Continue with GitHub" })).toBeEnabled();
    await expectHydrated(page);
    expect(violations).toEqual([]);
  });

  test("every app response gets a fresh nonce", async ({ request }) => {
    const nonces = await Promise.all(
      [0, 1].map(async () => {
        const response = await request.get("/sign-in");
        return directives(response.headers()["content-security-policy"] ?? "").get("script-src")?.[1];
      }),
    );
    expect(nonces[0]).toMatch(NONCE_SOURCE);
    expect(nonces[1]).toMatch(NONCE_SOURCE);
    expect(nonces[0]).not.toBe(nonces[1]);
  });

  test("an injected inline script without the nonce is blocked", async ({ page }) => {
    const violations = await watchViolations(page);
    await page.goto("/sign-in");
    await expectHydrated(page);

    // The way a stored or reflected XSS would arrive: an inline script added to the document.
    const ran = await page.evaluate(() => {
      const script = document.createElement("script");
      script.textContent = "document.documentElement.dataset.injected = 'ran'";
      document.body.append(script);
      return document.documentElement.dataset.injected === "ran";
    });

    expect(ran).toBe(false);
    await expect.poll(() => violations.some((violation) => violation.startsWith("enforce script-src-elem"))).toBe(true);
  });
});

ownerTest.describe("signed in", () => {
  ownerTest("app routes enforce the nonce policy, hydrate, and report no violations", async ({ page }) => {
    const workspace = await createTestWorkspace("Content security policy");
    try {
      const violations = await watchViolations(page);
      const paths = [
        "/account",
        "/auth/error",
        `/w/${workspace.slug}/timeline`,
        `/w/${workspace.slug}/dashboard`,
        `/w/${workspace.slug}/projects`,
        `/w/${workspace.slug}/connections`,
        `/w/${workspace.slug}/connections/new/fake`,
        `/w/${workspace.slug}/alerts`,
        `/w/${workspace.slug}/settings`,
      ];

      for (const path of paths) {
        await ownerTest.step(path, async () => {
          const response = await page.goto(path);
          expect(response?.status()).toBe(200);
          const headers = response?.headers() ?? {};
          expectAppPolicy(headers["content-security-policy"]);
          expect(headers["content-security-policy-report-only"]).toBeUndefined();
          await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
          await expectHydrated(page);
        });
      }

      expect(violations).toEqual([]);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("the app entry redirects into a workspace that responds to input", async ({ page }) => {
    const violations = await watchViolations(page);
    await page.goto("/app");
    await expect(page).toHaveURL(/\/w\/[a-z0-9]+\/timeline$/);
    await expectHydrated(page);

    // The switcher opens from a click handler, so this works only on a hydrated page.
    const switcher = page.getByRole("button", { name: /^Workspace: / });
    await switcher.click();
    await expect(switcher).toHaveAttribute("aria-expanded", "true");
    expect(violations).toEqual([]);
  });
});
