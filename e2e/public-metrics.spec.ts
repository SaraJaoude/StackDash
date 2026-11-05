import AxeBuilder from "@axe-core/playwright";
import { request as playwrightRequest, type Page } from "@playwright/test";

import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";

// Each test creates its own workspace and seeds only inside it, so tests run in any order.

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A project with one real (not simulated) GitHub connection whose account reports 1,204 stars
 * today, synced a few minutes ago. Returns the project id.
 */
async function seedStarredProject(workspace: TestWorkspace): Promise<string> {
  const admin = adminClient();
  const now = new Date();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({ workspace_id: workspace.id, name: "Acme web" })
    .select("id")
    .single();
  if (projectError) throw new Error(`Seeding a project failed (code ${projectError.code}).`);

  const { data: connection, error: connectionError } = await admin
    .from("connections")
    .insert({
      workspace_id: workspace.id,
      provider: "github",
      status: "active",
      display_name: "GitHub",
      poll_interval_seconds: 3600,
      // Far in the future, so no tick another spec runs ever syncs this credential-less row.
      next_sync_at: new Date(now.getTime() + 30 * DAY_MS).toISOString(),
      last_synced_at: new Date(now.getTime() - 5 * 60_000).toISOString(),
    })
    .select("id")
    .single();
  if (connectionError) throw new Error(`Seeding a connection failed (code ${connectionError.code}).`);

  const { data: account, error: accountError } = await admin
    .from("external_accounts")
    .insert({
      workspace_id: workspace.id,
      connection_id: connection.id,
      external_id: "public-metrics-e2e",
      display_name: "example-org",
      kind: "organization",
      project_id: project.id,
    })
    .select("id")
    .single();
  if (accountError) throw new Error(`Seeding an account failed (code ${accountError.code}).`);

  const retrievedAt = new Date(now.getTime() - 5 * 60_000);
  const { error: snapshotError } = await admin.from("usage_snapshots").insert({
    workspace_id: workspace.id,
    connection_id: connection.id,
    external_account_id: account.id,
    metric_key: "github.stars.total",
    kind: "usage",
    label: "Stars across connected repositories",
    snapshot_date: retrievedAt.toISOString().slice(0, 10),
    value: 1204,
    unit: "stars",
    point_at: retrievedAt.toISOString(),
    retrieved_at: retrievedAt.toISOString(),
    provenance_source: "provider_api",
  });
  if (snapshotError) throw new Error(`Seeding a snapshot failed (code ${snapshotError.code}).`);
  return project.id;
}

function publicMetricsPath(workspace: TestWorkspace, projectId: string): string {
  return `/w/${workspace.slug}/projects/${projectId}/public-metrics`;
}

function metricRow(page: Page, label: string) {
  return page.getByRole("region", { name: "Metrics from your connected providers" }).getByRole("listitem").filter({
    has: page.getByText(label, { exact: true }),
  });
}

/** The public route, read without any session, as a README or a stranger would. */
async function readPublic(baseURL: string, projectId: string) {
  const context = await playwrightRequest.newContext({ baseURL });
  try {
    const response = await context.get(`/api/public/projects/${projectId}/metrics`);
    return { status: response.status(), body: (await response.json()) as unknown };
  } finally {
    await context.dispose();
  }
}

ownerTest.describe("public metrics as the owner", () => {
  ownerTest("publishes a rounded metric, shows it publicly, and unpublishes everything", async ({ page, baseURL }) => {
    if (baseURL === undefined) throw new Error("baseURL is not configured");
    const workspace = await createTestWorkspace("Public metrics");
    try {
      const projectId = await seedStarredProject(workspace);

      await page.goto(`/w/${workspace.slug}/projects`);
      await page.getByRole("link", { name: "Public metrics for Acme web" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Public metrics for Acme web");

      const stars = metricRow(page, "GitHub stars");
      await expect(stars).toContainText("Now: 1,204 stars");
      await expect(stars).toContainText("Verified");
      await expect(stars).toContainText("Not published");
      // A metric with nothing behind it says why instead of showing a number.
      await expect(metricRow(page, "Deployments in 7 days")).toContainText("Not connected");
      // Nothing published yet: no public link, no way to read anything.
      expect((await readPublic(baseURL, projectId)).status).toBe(404);

      await stars.getByLabel("Rounding").selectOption({ label: "Rounded down to 100" });
      await stars.getByRole("button", { name: "Publish GitHub stars" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Published GitHub stars." })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Metrics from your connected providers" })).toBeFocused();
      await expect(stars).toContainText("Published (Rounded down to 100, current)");
      await expect(stars).toContainText("Public value: at least 1,200 stars");

      const published = await readPublic(baseURL, projectId);
      expect(published.status).toBe(200);
      expect(published.body).toMatchObject({
        projectId,
        metrics: [
          {
            kind: "engine",
            id: "github-stars",
            provenance: "verified",
            status: "available",
            value: 1200,
            atLeast: true,
            simulated: false,
          },
        ],
      });
      // Never an account name, even though the account has one.
      expect(JSON.stringify(published.body)).not.toContain("example-org");

      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);

      const { data: events, error } = await adminClient()
        .from("activity_events")
        .select("title, provider")
        .eq("workspace_id", workspace.id)
        .eq("type_id", "devmacro.metric_published");
      if (error) throw new Error(`Reading events failed (code ${error.code}).`);
      expect(events).toEqual([{ title: "Published GitHub stars", provider: null }]);

      await page.getByRole("button", { name: "Unpublish everything" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: "Unpublished everything in this workspace: 1 metric." }),
      ).toBeVisible();
      await expect(stars).toContainText("Not published");
      expect((await readPublic(baseURL, projectId)).status).toBe(404);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("publishes a self-reported value and explains a field error", async ({ page }) => {
    const workspace = await createTestWorkspace("Public metrics self");
    try {
      const projectId = await seedStarredProject(workspace);
      await page.goto(publicMetricsPath(workspace, projectId));

      const form = page.getByRole("region", { name: "Self-reported values" });
      await form.getByLabel("Name").fill("Downloads this month");
      await form.getByLabel("Value").fill("12.5");
      await form.getByLabel("Unit").fill("downloads");
      await form.getByRole("button", { name: "Publish value" }).click();
      await expect(form.getByLabel("Value")).toHaveAttribute("aria-invalid", "true");
      await expect(form.getByLabel("Value")).toHaveAccessibleDescription(/Enter a whole number, such as 1200\./);

      await form.getByLabel("Value").fill("4200");
      await form.getByRole("button", { name: "Publish value" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Published Downloads this month as a self-reported value." })).toBeVisible();
      await expect(form.getByRole("listitem")).toContainText("Downloads this month: 4,200 downloads");
      await expect(form.getByRole("listitem")).toContainText("Self-reported");
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("publishes and unpublishes with the keyboard alone", async ({ page }) => {
    const workspace = await createTestWorkspace("Public metrics keyboard");
    try {
      const projectId = await seedStarredProject(workspace);
      await page.goto(publicMetricsPath(workspace, projectId));

      const stars = metricRow(page, "GitHub stars");
      const rounding = stars.getByLabel("Rounding");
      await rounding.focus();
      await page.keyboard.press("Tab");
      await expect(stars.getByLabel("Timing")).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(stars.getByRole("button", { name: "Publish GitHub stars" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: "Published GitHub stars." })).toBeVisible();
      // The form is replaced by Unpublish; focus lands on the list heading, not on the page body.
      await expect(page.getByRole("heading", { name: "Metrics from your connected providers" })).toBeFocused();

      // The first stop after the heading is the row's formula link, then its Unpublish button.
      await page.keyboard.press("Tab");
      await expect(stars.getByRole("link", { name: "How it is counted for GitHub stars" })).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(stars.getByRole("button", { name: "Unpublish GitHub stars" })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("status").filter({ hasText: "Unpublished GitHub stars. It is no longer public." })).toBeVisible();
      await expect(stars).toContainText("Not published");
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest.describe("public metrics as a viewer", () => {
  viewerTest("sees what is published and no controls", async ({ page }) => {
    const workspace = await createTestWorkspace("Public metrics viewer");
    try {
      const projectId = await seedStarredProject(workspace);
      const { error } = await adminClient().rpc("publish_metric", {
        p_workspace_id: workspace.id,
        p_project_id: projectId,
        p_actor_id: workspace.ownerId,
        p_metric_id: "github-stars",
        p_rounding: "exact",
        p_delay_days: 0,
        p_title: "Published GitHub stars",
        p_body: "Project Acme web. Exact, current.",
      });
      if (error) throw new Error(`Publishing failed (code ${error.code}).`);

      await page.goto(publicMetricsPath(workspace, projectId));
      await expect(page.getByText("Only owners and admins can publish or unpublish metrics.")).toBeVisible();
      await expect(metricRow(page, "GitHub stars")).toContainText("Published (Exact, current)");
      await expect(metricRow(page, "GitHub stars")).toContainText("Public value: 1,204 stars");
      await expect(page.getByRole("button", { name: /^(Publish|Unpublish)/ })).toHaveCount(0);
      await expect(page.getByLabel("Rounding")).toHaveCount(0);

      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
