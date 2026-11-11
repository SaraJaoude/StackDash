import type { Page } from "@playwright/test";

import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { expectNoAxeViolations } from "./fixtures/axe";
import { adminClient, createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";

// Each test creates its own workspace and seeds only inside it.

const EVENT_TITLE = "Example provider build minutes passed 100 percent of the allowance";
// The short title the alerts page and dashboard lead with (#268), built from the stored columns.
const ALERT_TITLE = "Example provider allowance at 104 percent";
const ALERT_VALUE = "104 percent of the allowance";
const ALERT_MESSAGE =
  "Example provider build minutes is at 104 percent of the allowance (6,240 minutes of 6,000 minutes) for the billing period starting 2026-10-01. The alert threshold is 100 percent.";

/** A 100 percent allowance rule that fired (critical, estimated), plus its timeline event. */
async function seedTriggeredAlert(workspace: TestWorkspace): Promise<string> {
  const admin = adminClient();
  const { data: rule, error: ruleError } = await admin
    .from("alert_rules")
    .insert({ workspace_id: workspace.id, kind: "allowance_percent", scope: "workspace", threshold_percent: 100 })
    .select("id")
    .single();
  if (ruleError) throw new Error(`Seeding a rule failed (code ${ruleError.code}).`);
  const cycleKey = "2026-10-01";
  const { data: alert, error: alertError } = await admin
    .from("triggered_alerts")
    .insert({
      workspace_id: workspace.id,
      rule_id: rule.id,
      cycle_key: cycleKey,
      triggered_at: "2026-10-31T09:30:00Z",
      observed_value: 104,
      provider: "fake",
      threshold_label: "100 percent",
      is_estimated: true,
      message: ALERT_MESSAGE,
    })
    .select("id")
    .single();
  if (alertError) throw new Error(`Seeding a triggered alert failed (code ${alertError.code}).`);
  const { error: eventError } = await admin.from("activity_events").insert({
    workspace_id: workspace.id,
    type_id: "devmacro.alert_triggered",
    severity: "critical",
    title: EVENT_TITLE,
    body: ALERT_MESSAGE,
    occurred_at: "2026-10-31T09:30:00Z",
    dedupe_key: `alert:${rule.id}:${cycleKey}`,
  });
  if (eventError) throw new Error(`Seeding the alert event failed (code ${eventError.code}).`);
  return alert.id;
}

async function acknowledgedBy(alertIds: readonly string[]): Promise<Array<string | null>> {
  const { data, error } = await adminClient().from("triggered_alerts").select("acknowledged_by").in("id", alertIds);
  if (error) throw new Error(`Reading the alerts failed (code ${error.code}).`);
  return data.map((row) => row.acknowledged_by);
}

function triggeredList(page: Page) {
  return page.getByRole("list", { name: "Triggered alerts" });
}

ownerTest.describe("triggered alerts as the owner", () => {
  ownerTest("sees the alert on the alerts page, dashboard, and timeline, then acknowledges it", async ({ page }) => {
    const workspace = await createTestWorkspace("Triggered alerts");
    try {
      const alertId = await seedTriggeredAlert(workspace);

      await page.goto(`/w/${workspace.slug}/dashboard`);
      const summary = page.getByRole("region", { name: "Alerts", exact: true });
      await expect(summary).toContainText("1 unacknowledged alert");
      await expect(summary.getByText(ALERT_TITLE, { exact: true })).toBeVisible();
      await expect(summary.getByText(ALERT_VALUE, { exact: true })).toBeVisible();
      await expect(summary).toContainText("Critical");
      // The full sentence waits behind its disclosure.
      await expect(summary.getByText(ALERT_MESSAGE)).toBeHidden();
      await summary.getByText("Show the full alert").click();
      await expect(summary.getByText(ALERT_MESSAGE)).toBeVisible();
      await expectNoAxeViolations(page);

      await page.goto(`/w/${workspace.slug}/timeline`);
      await expect(page.getByRole("heading", { name: EVENT_TITLE })).toBeVisible();

      await page.goto(`/w/${workspace.slug}/dashboard`);
      await summary.getByRole("link", { name: "View all alerts" }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/alerts$`));

      const item = triggeredList(page).getByRole("listitem").filter({ hasText: ALERT_TITLE });
      await expect(item.getByRole("heading", { level: 3, name: ALERT_TITLE })).toBeVisible();
      await expect(item.getByText(ALERT_VALUE, { exact: true })).toBeVisible();
      await expect(item).toContainText("Critical");
      await expect(item.getByText("Estimated", { exact: true })).toBeVisible();
      await expect(item).toContainText("Threshold 100 percent");
      await expect(item.locator("time").first()).toHaveAttribute("datetime", "2026-10-31T09:30:00.000Z");
      await expect(item).toContainText("2026-10-31 09:30 GMT");
      await expect(item).toContainText("Not acknowledged");
      await expectNoAxeViolations(page);

      // Keyboard only: the disclosure opens and closes with Enter, named after its alert.
      const disclosure = item.getByText("Show the full alert");
      await expect(item.getByText(ALERT_MESSAGE)).toBeHidden();
      await item.locator("summary").focus();
      await page.keyboard.press("Enter");
      await expect(item.getByText(ALERT_MESSAGE)).toBeVisible();
      await expect(item.getByText("Hide the full alert")).toBeVisible();
      await page.keyboard.press("Enter");
      await expect(item.getByText(ALERT_MESSAGE)).toBeHidden();
      await expect(disclosure).toBeVisible();

      // One unacknowledged alert: "Acknowledge all" is offered beside the count.
      const triggered = page.getByRole("region", { name: "Triggered alerts" });
      await expect(triggered).toContainText("1 unacknowledged alert");
      await expect(triggered.getByRole("button", { name: "Acknowledge all" })).toBeVisible();

      // Keyboard only: focus the button and press Enter.
      const button = item.getByRole("button", { name: /^Acknowledge/ });
      await expect(button).toHaveAccessibleName(`Acknowledge : ${ALERT_TITLE}, triggered 2026-10-31 09:30 GMT`);
      await button.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: "Alert acknowledged." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Triggered alerts" })).toBeFocused();
      await expect(page.getByText("No unacknowledged alerts")).toBeVisible();
      await expect(triggered.getByRole("button", { name: "Acknowledge all" })).toHaveCount(0);

      // Still in the history, marked acknowledged.
      await page.getByRole("link", { name: "Show acknowledged alerts" }).click();
      await expect(page).toHaveURL(/acknowledged=show/);
      const acknowledged = triggeredList(page).getByRole("listitem").filter({ hasText: ALERT_TITLE });
      await expect(acknowledged).toContainText("Acknowledged by you");
      await expect(acknowledged.getByRole("button", { name: /^Acknowledge/ })).toHaveCount(0);
      await expectNoAxeViolations(page);

      expect(await acknowledgedBy([alertId])).toEqual([workspace.ownerId]);

      await page.goto(`/w/${workspace.slug}/dashboard`);
      await expect(page.getByRole("region", { name: "Alerts", exact: true })).toContainText("No unacknowledged alerts");
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("acknowledges every alert at once and announces how many", async ({ page }) => {
    const workspace = await createTestWorkspace("Acknowledge all");
    const other = await createTestWorkspace("Acknowledge all elsewhere");
    try {
      const alertIds = [
        await seedTriggeredAlert(workspace),
        await seedTriggeredAlert(workspace),
        await seedTriggeredAlert(workspace),
      ];
      const otherAlertId = await seedTriggeredAlert(other);

      await page.goto(`/w/${workspace.slug}/alerts`);
      const triggered = page.getByRole("region", { name: "Triggered alerts" });
      await expect(triggered).toContainText("3 unacknowledged alerts");
      await expect(triggeredList(page).getByRole("listitem")).toHaveCount(3);
      await expectNoAxeViolations(page);

      // Keyboard only: focus "Acknowledge all" and press Enter.
      await triggered.getByRole("button", { name: "Acknowledge all" }).focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("status").filter({
          hasText: "3 alerts acknowledged. They stay in the alert history. Choose Show acknowledged alerts to see them.",
        }),
      ).toBeVisible();
      await expect(page.getByRole("heading", { name: "Triggered alerts" })).toBeFocused();
      await expect(page.getByText("No unacknowledged alerts")).toBeVisible();
      await expect(triggered.getByRole("button", { name: /^Acknowledge/ })).toHaveCount(0);

      expect(await acknowledgedBy(alertIds)).toEqual([workspace.ownerId, workspace.ownerId, workspace.ownerId]);
      // Another workspace's alert is untouched, even though the same owner holds it.
      expect(await acknowledgedBy([otherAlertId])).toEqual([null]);

      await page.goto(`/w/${workspace.slug}/alerts?acknowledged=show`);
      await expect(triggeredList(page).getByRole("listitem").filter({ hasText: "Acknowledged by you" })).toHaveCount(3);
      await expectNoAxeViolations(page);
    } finally {
      await Promise.all([deleteTestWorkspace(workspace), deleteTestWorkspace(other)]);
    }
  });

  ownerTest("shows an empty state that links to adding an alert rule", async ({ page }) => {
    const workspace = await createTestWorkspace("No triggered alerts");
    try {
      await page.goto(`/w/${workspace.slug}/alerts`);
      await expect(page.getByText("No alerts have fired")).toBeVisible();
      const triggered = page.getByRole("region", { name: "Triggered alerts" });
      await expect(triggered.getByRole("link", { name: "Add an alert rule" })).toHaveAttribute("href", "#add-alert-rule");
      await expect(triggered.getByRole("button", { name: "Acknowledge all" })).toHaveCount(0);

      await page.goto(`/w/${workspace.slug}/dashboard`);
      await expect(page.getByRole("region", { name: "Alerts", exact: true })).toContainText("No unacknowledged alerts");
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest.describe("triggered alerts as a viewer", () => {
  viewerTest("shows the status without acknowledge buttons and says why", async ({ page }) => {
    const workspace = await createTestWorkspace("Viewer triggered alerts");
    try {
      await seedTriggeredAlert(workspace);
      await page.goto(`/w/${workspace.slug}/alerts`);
      const item = triggeredList(page).getByRole("listitem").filter({ hasText: ALERT_TITLE });
      await expect(item).toContainText("Not acknowledged");
      await expect(page.getByRole("button", { name: /^Acknowledge/ })).toHaveCount(0);
      await expect(page.getByText("Only owners and admins can acknowledge alerts.")).toBeVisible();
      await expectNoAxeViolations(page);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
