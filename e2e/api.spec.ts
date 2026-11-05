import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";

import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";

// The REST API with scoped keys (#162). Each test creates its own workspace and seeds only inside it.

const KEY_PATTERN = /^dmk_[A-Za-z0-9_-]{43}$/;
const REFERENCE_PATTERN = /^REF-[0-9A-Z]{8}$/;
// The order the create form lists them in (the database enum's order).
const SCOPES = ["usage:read", "events:read", "alerts:read", "connections:read"] as const;
type Scope = (typeof SCOPES)[number];

type Seeded = { projectId: string; connectionId: string };

/** A project, a fake connection with one account in that project, one spend snapshot, one event. */
async function seedWorkspaceData(workspace: TestWorkspace): Promise<Seeded> {
  const admin = adminClient();
  const { data: project, error: projectError } = await admin
    .from("projects")
    .insert({ workspace_id: workspace.id, name: "API web" })
    .select("id")
    .single();
  if (projectError) throw new Error(`Seeding a project failed (code ${projectError.code}).`);
  const { data: connection, error: connectionError } = await admin
    .from("connections")
    .insert({
      workspace_id: workspace.id,
      provider: "fake",
      status: "active",
      display_name: "API fake",
      poll_interval_seconds: 3600,
      // Never due, so a sync elsewhere in the run leaves this workspace alone.
      next_sync_at: "2999-01-01T00:00:00Z",
    })
    .select("id")
    .single();
  if (connectionError) throw new Error(`Seeding a connection failed (code ${connectionError.code}).`);
  const { data: account, error: accountError } = await admin
    .from("external_accounts")
    .insert({
      workspace_id: workspace.id,
      connection_id: connection.id,
      external_id: "api-e2e-team",
      display_name: "API team",
      kind: "team",
      project_id: project.id,
    })
    .select("id")
    .single();
  if (accountError) throw new Error(`Seeding an account failed (code ${accountError.code}).`);
  const { error: snapshotError } = await admin.from("usage_snapshots").insert({
    workspace_id: workspace.id,
    connection_id: connection.id,
    external_account_id: account.id,
    metric_key: "fake.spend",
    kind: "verified_spend",
    label: "Spend this month",
    snapshot_date: "2026-10-31",
    amount_minor: 1250,
    currency: "USD",
    period_start: "2026-10-01T00:00:00Z",
    period_end: "2026-11-01T00:00:00Z",
    retrieved_at: "2026-10-31T09:00:00Z",
    provenance_source: "provider_api",
  });
  if (snapshotError) throw new Error(`Seeding a snapshot failed (code ${snapshotError.code}).`);
  const { error: eventError } = await admin.from("activity_events").insert({
    workspace_id: workspace.id,
    connection_id: connection.id,
    external_account_id: account.id,
    provider: "fake",
    type_id: "fake.deployment_failed",
    severity: "critical",
    title: "Deployment failed",
    occurred_at: "2026-10-31T08:00:00Z",
    dedupe_key: "api-e2e:deployment:1",
  });
  if (eventError) throw new Error(`Seeding an event failed (code ${eventError.code}).`);
  return { projectId: project.id, connectionId: connection.id };
}

function keysSection(page: Page) {
  return page.getByRole("region", { name: "API keys" });
}

/**
 * Creates a key with the keyboard only: type the name, Tab through the scope checkboxes pressing
 * Space on the wanted ones, Tab to "Create key", Enter. Returns the key the page shows once.
 */
async function createKeyWithKeyboard(page: Page, name: string, scopes: readonly Scope[]): Promise<string> {
  const section = keysSection(page);
  await section.getByLabel("Key name").focus();
  await page.keyboard.type(name);
  for (const scope of SCOPES) {
    await page.keyboard.press("Tab");
    await expect(section.getByRole("checkbox", { name: new RegExp(scope) })).toBeFocused();
    if (scopes.includes(scope)) await page.keyboard.press("Space");
  }
  await page.keyboard.press("Tab");
  await expect(section.getByRole("button", { name: "Create key" })).toBeFocused();
  await page.keyboard.press("Enter");

  // Focus moves to the one-time key so it is the next thing read.
  await expect(section.getByRole("heading", { name: `Copy the key for ${name} now` })).toBeFocused();
  await expect(page.getByRole("status").filter({ hasText: `Created the key ${name}.` })).toBeVisible();
  const key = await section.getByLabel("API key", { exact: true }).inputValue();
  expect(key).toMatch(KEY_PATTERN);
  return key;
}

async function getJson(request: APIRequestContext, path: string, key: string | null) {
  const response = await request.get(path, key === null ? {} : { headers: { authorization: `Bearer ${key}` } });
  return { status: response.status(), headers: response.headers(), body: (await response.json()) as unknown };
}

ownerTest.describe("API keys as the owner", () => {
  ownerTest("creates a key, reads the workspace through every endpoint, then revokes it", async ({ page, request }) => {
    const workspace = await createTestWorkspace("API keys");
    try {
      const seeded = await seedWorkspaceData(workspace);
      await page.goto(`/w/${workspace.slug}/settings`);
      const section = keysSection(page);
      await expect(section.getByText("No API keys yet.")).toBeVisible();

      const key = await createKeyWithKeyboard(page, "Reporting script", SCOPES);
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);

      const row = section.getByRole("listitem").filter({ hasText: "Reporting script" });
      await expect(row).toContainText("Active");
      await expect(row).toContainText(key.slice(0, "dmk_".length + 8));
      await expect(row).toContainText("Never used.");

      // Every endpoint answers with the seeded workspace's data.
      const workspaces = await getJson(request, "/api/v1/workspaces", key);
      expect(workspaces.status).toBe(200);
      expect(workspaces.headers["cache-control"]).toBe("no-store");
      expect(workspaces.headers["x-ratelimit-limit"]).toBe("120");
      expect(workspaces.body).toEqual({
        data: [expect.objectContaining({ id: workspace.id, slug: workspace.slug, name: workspace.name })],
        next_cursor: null,
      });
      expect((await getJson(request, "/api/v1/projects", key)).body).toMatchObject({
        data: [{ id: seeded.projectId, name: "API web" }],
      });
      expect((await getJson(request, "/api/v1/connections", key)).body).toMatchObject({
        data: [{ id: seeded.connectionId, provider: "fake", name: "API fake", status: "active", simulated: false }],
      });
      expect(
        (await getJson(request, `/api/v1/usage-snapshots?metric_key=fake.spend&project_id=${seeded.projectId}`, key)).body,
      ).toMatchObject({
        data: [{ metric_key: "fake.spend", amount_minor: 1250, currency: "USD", provenance: "verified", date: "2026-10-31" }],
        next_cursor: null,
      });
      expect((await getJson(request, "/api/v1/events?severity=critical", key)).body).toMatchObject({
        data: [{ type: "fake.deployment_failed", title: "Deployment failed", account_name: "API team" }],
      });
      expect((await getJson(request, "/api/v1/triggered-alerts", key)).body).toEqual({ data: [], next_cursor: null });

      // The settings list records the use; the key itself is never shown again.
      await page.reload();
      await expect(section.getByRole("listitem").filter({ hasText: "Reporting script" })).toContainText("Last used");
      await expect(page.getByText(key)).toHaveCount(0);

      // Revoke through the confirmation dialog, then the same key gets 401 with a reference id.
      await section.getByRole("button", { name: "Revoke Reporting script" }).click();
      const dialog = page.getByRole("dialog", { name: "Revoke Reporting script?" });
      await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
      await dialog.getByRole("button", { name: "Revoke key" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Revoked the key Reporting script." })).toBeVisible();
      await expect(section.getByRole("listitem").filter({ hasText: "Reporting script" })).toContainText("Revoked");

      const revoked = await getJson(request, "/api/v1/workspaces", key);
      expect(revoked.status).toBe(401);
      expect(revoked.body).toEqual({
        error: {
          code: "unauthorized",
          message: "The API key is missing or no longer works. Send a working key as a bearer token.",
          reference_id: expect.stringMatching(REFERENCE_PATTERN),
        },
      });
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("a key reads only what its scopes allow", async ({ page, request }) => {
    const workspace = await createTestWorkspace("API scopes");
    try {
      await seedWorkspaceData(workspace);
      await page.goto(`/w/${workspace.slug}/settings`);
      const key = await createKeyWithKeyboard(page, "Usage only", ["usage:read"]);

      expect((await getJson(request, "/api/v1/usage-snapshots", key)).status).toBe(200);
      expect((await getJson(request, "/api/v1/projects", key)).status).toBe(200);
      const events = await getJson(request, "/api/v1/events", key);
      expect(events.status).toBe(403);
      expect(events.body).toMatchObject({ error: { code: "forbidden", reference_id: expect.stringMatching(REFERENCE_PATTERN) } });
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("explains a missing name and scope without creating a key", async ({ page }) => {
    const workspace = await createTestWorkspace("API key errors");
    try {
      await page.goto(`/w/${workspace.slug}/settings`);
      const section = keysSection(page);
      await section.getByRole("button", { name: "Create key" }).click();
      await expect(section.getByText("Enter a name for the key, such as the script or tool that will use it.").first()).toBeVisible();
      await expect(section.getByText("Choose at least one thing the key may read.")).toBeVisible();
      await expect(section.getByLabel("Key name")).toHaveAttribute("aria-invalid", "true");
      await expect(section.getByText("No API keys yet.")).toBeVisible();
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("a signed-in session is not an API key", async ({ page }) => {
    const response = await page.request.get("/api/v1/workspaces");
    expect(response.status()).toBe(401);
    expect(response.headers()["www-authenticate"]).toMatch(/^Bearer/);
    expect(await response.json()).toMatchObject({ error: { code: "unauthorized" } });
  });
});

viewerTest.describe("API keys as a viewer", () => {
  viewerTest("sees why the section is locked and no keys", async ({ page }) => {
    const workspace = await createTestWorkspace("API keys viewer");
    try {
      await page.goto(`/w/${workspace.slug}/settings`);
      const section = keysSection(page);
      await expect(section).toContainText("Only owners and admins can create, see, or revoke API keys.");
      await expect(section.getByLabel("Key name")).toHaveCount(0);
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

ownerTest.describe("API docs", () => {
  ownerTest("publishes the guide at /docs/api and the OpenAPI document beside it", async ({ page, request }) => {
    await page.goto("/docs/api");
    await expect(page.getByRole("heading", { level: 1, name: "REST API" })).toBeVisible();
    const scan = await new AxeBuilder({ page }).analyze();
    expect(scan.violations).toEqual([]);

    const response = await request.get("/docs/api/openapi.json");
    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({
      openapi: "3.1.0",
      paths: { "/api/v1/events": { get: { security: [{ apiKey: ["events:read"] }] } } },
    });
  });
});
