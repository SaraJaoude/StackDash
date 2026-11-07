import { existsSync } from "node:fs";

import AxeBuilder from "@axe-core/playwright";
import { request as playwrightRequest, type Page } from "@playwright/test";
import { z } from "zod";

import type { FakeEmail } from "../src/lib/email/fake-resend-api";

import { E2E_USERS, expect, ownerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";
import { FAKE_RESEND, fakeEmails } from "./fixtures/fake-resend";

/*
 * Alert email (#152), end to end: a triggered alert goes out on the next tick through the `resend`
 * package to the fake Resend API (#244), to the workspace's owner and not its viewer; the email's
 * unsubscribe link works signed out; once it is off, the next alert is not emailed.
 * playwright.config.ts starts the fake and points the app at it, so no email leaves this computer.
 *
 * It runs the job tick, which is instance-wide, so it lives in the `instance-wide` Playwright
 * project (playwright.config.ts).
 */

function cronSecret(): string {
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  return z.string().min(32).parse(process.env.CRON_SECRET);
}

/** What the fake accepted for one recipient in this spec's workspace, which other specs never touch. */
async function mailFor(to: string, workspace: TestWorkspace): Promise<FakeEmail[]> {
  return (await fakeEmails()).filter((email) => email.to.includes(to) && email.subject.includes(workspace.name));
}

/** A 100 percent allowance rule that fired on the fake provider and has not been sent yet. */
async function seedTriggeredAlert(workspace: TestWorkspace, cycleKey: string, title: string): Promise<string> {
  const admin = adminClient();
  const { data: rule, error: ruleError } = await admin
    .from("alert_rules")
    .insert({ workspace_id: workspace.id, kind: "allowance_percent", scope: "workspace", threshold_percent: 100 })
    .select("id")
    .single();
  if (ruleError) throw new Error(`Seeding a rule failed (code ${ruleError.code}).`);
  const { data: alert, error: alertError } = await admin
    .from("triggered_alerts")
    .insert({
      workspace_id: workspace.id,
      rule_id: rule.id,
      cycle_key: cycleKey,
      triggered_at: new Date().toISOString(),
      observed_value: 104,
      threshold_label: "100 percent",
      is_estimated: true,
      title,
      provider: "fake",
      message: `Fake build minutes is at 104 percent of the allowance for the billing period starting ${cycleKey}. The alert threshold is 100 percent.`,
    })
    .select("id")
    .single();
  if (alertError) throw new Error(`Seeding a triggered alert failed (code ${alertError.code}).`);
  return alert.id;
}

/** Ticks until the alert dispatch job has handled the alert; other workspaces' jobs may share a tick. */
async function tickUntilDispatched(page: Page, alertId: string): Promise<void> {
  const authorization = `Bearer ${cronSecret()}`;
  await expect(async () => {
    const response = await page.request.post("/api/jobs/tick", { headers: { Authorization: authorization }, timeout: 120_000 });
    expect(response.status()).toBe(200);
    const { data, error } = await adminClient().from("triggered_alerts").select("dispatched_at").eq("id", alertId).single();
    if (error) throw new Error(`Reading the alert failed (code ${error.code}).`);
    expect(data.dispatched_at).not.toBeNull();
  }).toPass({ timeout: 90_000 });
}

ownerTest.describe("alert email", () => {
  ownerTest("emails a triggered alert to the owner only, unsubscribes signed out, then stops", async ({ page, browser, baseURL }) => {
    ownerTest.slow();
    const workspace = await createTestWorkspace("Alert email");
    try {
      const title = "Fake build minutes passed 100 percent of the allowance";
      const firstAlert = await seedTriggeredAlert(workspace, "2026-10-01", title);
      await tickUntilDispatched(page, firstAlert);

      // One email, to the owner; the viewer is a member but receives no alert email.
      let messages: FakeEmail[] = [];
      await expect(async () => {
        messages = await mailFor(E2E_USERS.owner.email, workspace);
        expect(messages).toHaveLength(1);
      }).toPass({ timeout: 30_000 });
      expect(await mailFor(E2E_USERS.viewer.email, workspace)).toEqual([]);
      const [message] = messages;
      if (message === undefined) throw new Error("expected one email");
      expect(message.from).toBe(FAKE_RESEND.from);
      expect(message.to).toEqual([E2E_USERS.owner.email]);
      expect(message.subject).toBe(`Alert in ${workspace.name}: ${title}`);

      const text = message.text ?? "";
      expect(text).toContain(title);
      expect(text).toContain("Example provider");
      expect(text).toContain(`/w/${workspace.slug}/alerts`);
      expect(text).not.toMatch(/[\u2013\u2014!]/);
      expect(message.html).toContain(title);

      // RFC 8058 headers: a one-click URI and the fixed List-Unsubscribe-Post value.
      expect(message.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
      const oneClick = /^<(.+)>$/.exec(message.headers["List-Unsubscribe"] ?? "")?.[1];
      expect(oneClick).toMatch(/\/api\/notifications\/unsubscribe\?token=/);

      // The unsubscribe link in the body, opened in a browser with no session.
      const unsubscribeLink = /^Unsubscribe: (\S+)$/m.exec(text)?.[1];
      if (unsubscribeLink === undefined) throw new Error("the email has no unsubscribe link");
      const link = new URL(unsubscribeLink);
      const signedOut = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        const visitor = await signedOut.newPage();
        await visitor.goto(`${link.pathname}${link.search}`);
        await expect(visitor.getByRole("heading", { level: 1 })).toHaveText("Unsubscribe from alert emails");
        await expect(visitor.getByText(`Your alert emails for ${workspace.name} are set to as each alert happens.`, { exact: false })).toBeVisible();
        expect((await new AxeBuilder({ page: visitor }).analyze()).violations).toEqual([]);

        // Keyboard only: the button is reachable by Tab and works with Enter.
        const button = visitor.getByRole("button", { name: "Turn off alert emails" });
        for (let presses = 0; presses < 10 && !(await button.evaluate((element) => element === document.activeElement)); presses += 1) {
          await visitor.keyboard.press("Tab");
        }
        await expect(button).toBeFocused();
        await visitor.keyboard.press("Enter");
        await expect(visitor.getByRole("status")).toContainText(`Alert emails for ${workspace.name} are off.`);
        // Answered in place: focus moves to the confirmation, and the page keeps its title.
        await expect(visitor.getByRole("status")).toBeFocused();
        await expect(visitor).toHaveTitle(/Unsubscribe from alert emails/);
        expect((await new AxeBuilder({ page: visitor }).analyze()).violations).toEqual([]);

        // A broken link says so instead of failing.
        await visitor.goto("/unsubscribe?token=not-a-token");
        await expect(visitor.getByText("This unsubscribe link is incomplete or no longer valid.", { exact: false })).toBeVisible();
      } finally {
        await signedOut.close();
      }

      const { data: preference, error } = await adminClient()
        .from("notification_preferences")
        .select("email_frequency")
        .eq("workspace_id", workspace.id)
        .eq("user_id", workspace.ownerId)
        .single();
      if (error) throw new Error(`Reading the preference failed (code ${error.code}).`);
      expect(preference.email_frequency).toBe("off");

      // The mail client's one-click POST, without cookies, answers 200 and never redirects.
      if (oneClick === undefined || baseURL === undefined) throw new Error("the email has no one-click URI, or the config no baseURL");
      const client = await playwrightRequest.newContext({ baseURL });
      try {
        const target = new URL(oneClick);
        const response = await client.post(`${target.pathname}${target.search}`, {
          form: { "List-Unsubscribe": "One-Click" },
          maxRedirects: 0,
        });
        expect(response.status()).toBe(200);
      } finally {
        await client.dispose();
      }

      // Off means off: the next alert in this workspace is handled but not emailed.
      const secondAlert = await seedTriggeredAlert(workspace, "2026-11-01", "Fake build minutes passed 100 percent again");
      await tickUntilDispatched(page, secondAlert);
      expect(await mailFor(E2E_USERS.owner.email, workspace)).toHaveLength(1);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
