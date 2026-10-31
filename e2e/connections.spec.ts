import { test, type Page } from "@playwright/test";

import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace } from "./fixtures/db";

/*
 * Connecting a provider (#40), end to end against the fake provider: the web server runs with
 * DEVMACRO_ENABLE_FAKE_PROVIDER=1 and FAKE_PROVIDER_CLIENT_ID/SECRET set, so no live provider is
 * ever called. Each test seeds only inside its own workspace.
 */

const PROVIDER_NAME = "Example provider";
const CONNECTION_URL = /\/connections\/([0-9a-f-]{36})(\?|$)/;

function connectionIdFrom(page: Page): string {
  const id = CONNECTION_URL.exec(page.url())?.[1];
  if (id === undefined) throw new Error(`Not on a connection page: ${page.url()}`);
  return id;
}

/**
 * Calls the start route as the signed-in user, lets `edit` change the fake authorize URL (to
 * decline a scope or cancel, as a person would on a real consent screen), then follows it.
 */
async function startFakeConnect(page: Page, slug: string, edit: (url: URL) => void): Promise<void> {
  const response = await page.request.get(
    `/api/connections/fake/start?${new URLSearchParams({ workspace: slug, consent: "1" }).toString()}`,
    { maxRedirects: 0 },
  );
  expect(response.status()).toBe(303);
  const location = response.headers().location;
  if (location === undefined) throw new Error("The start route did not redirect.");
  const authorize = new URL(location);
  expect(authorize.pathname).toBe("/api/dev/fake-provider/authorize");
  edit(authorize);
  await page.goto(authorize.href);
}

/** Connects the fake provider through the catalog and disclosure page, with the keyboard. */
async function connectThroughUi(page: Page, slug: string): Promise<string> {
  await page.goto(`/w/${slug}/connections`);
  await page.getByRole("link", { name: `Connect ${PROVIDER_NAME}` }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Connect ${PROVIDER_NAME}`);
  const consent = page.getByRole("checkbox", {
    name: `I understand DevMacro gets full access to my ${PROVIDER_NAME} account`,
  });
  await consent.focus();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
  await page.getByRole("button", { name: `Continue to ${PROVIDER_NAME}` }).focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(CONNECTION_URL);
  return connectionIdFrom(page);
}

ownerTest.describe("connecting a provider as the owner", () => {
  ownerTest("discloses full access, requires consent, and lands on the connection with its accounts", async ({ page }) => {
    const workspace = await createTestWorkspace("Connect");
    try {
      await page.goto(`/w/${workspace.slug}/connections`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connections");
      await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
      await expect(page.getByText("No connections yet")).toBeVisible();

      const card = page.getByRole("list", { name: "Providers" }).getByRole("listitem").filter({ hasText: PROVIDER_NAME }).first();
      await expect(card.getByText("Requests per month and the requests included in the plan")).toBeVisible();
      await card.getByRole("link", { name: `Connect ${PROVIDER_NAME}` }).click();

      // Disclosure: every permission with its access label, and the reason for full access.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Connect ${PROVIDER_NAME}`);
      const permissions = page.getByRole("region", { name: `Permissions ${PROVIDER_NAME} will ask you to grant` });
      const usage = permissions.getByRole("listitem").filter({ hasText: "usage:read" });
      const admin = permissions.getByRole("listitem").filter({ hasText: "admin" }).filter({ hasText: "Full access" });
      await expect(usage.getByText("Read", { exact: true })).toBeVisible();
      await expect(admin.getByText("Full access", { exact: true })).toBeVisible();
      await expect(admin.getByText(/Why full access:/)).toBeVisible();

      // Continuing without consent is refused, and focus moves to the error summary.
      await page.getByRole("button", { name: `Continue to ${PROVIDER_NAME}` }).click();
      const summary = page.getByRole("alert").filter({ hasText: "Confirm full access to continue" });
      await expect(summary).toBeVisible();
      await expect(summary).toBeFocused();
      const consent = page.getByRole("checkbox", {
        name: `I understand DevMacro gets full access to my ${PROVIDER_NAME} account`,
      });
      await expect(consent).toHaveAttribute("aria-invalid", "true");
      await expect(consent).toHaveAccessibleDescription(/Tick this box to continue\./);

      const connectionId = await connectThroughUi(page, workspace.slug);
      await expect(page.getByRole("heading", { level: 1 })).toContainText(PROVIDER_NAME);
      await expect(page.getByRole("status").filter({ hasText: `${PROVIDER_NAME} connected` })).toBeVisible();
      await expect(page.getByText("Status: Active").first()).toBeVisible();
      const accounts = page.getByRole("list", { name: "Accounts" });
      await expect(accounts.getByRole("listitem")).toHaveCount(2);
      await expect(accounts.getByText("Example team", { exact: true })).toBeVisible();
      await expect(accounts.getByText("Example sandbox", { exact: true })).toBeVisible();
      await expect(page.getByLabel("Project for Example team")).toBeVisible();

      // Stored server side only: the page never carries the credential.
      const { data: credential } = await adminClient()
        .from("connection_credentials")
        .select("connection_id")
        .eq("connection_id", connectionId)
        .maybeSingle();
      expect(credential?.connection_id).toBe(connectionId);
      expect(await page.content()).not.toContain("fake-at-");

      // The list shows it with its status in words.
      await page.goto(`/w/${workspace.slug}/connections`);
      const row = page.getByRole("list", { name: "Connections" }).getByRole("listitem").first();
      await expect(row.getByText("Status: Active")).toBeVisible();
      // Exact: the display name link contains the same words in parentheses.
      await expect(row.getByText("Example team, Example sandbox", { exact: true })).toBeVisible();
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("keeps two connections of the same provider separate", async ({ page }) => {
    const workspace = await createTestWorkspace("Connect twice");
    try {
      const first = await connectThroughUi(page, workspace.slug);
      const second = await connectThroughUi(page, workspace.slug);
      expect(second).not.toBe(first);

      const { data: rows, error } = await adminClient()
        .from("external_accounts")
        .select("id, connection_id, external_id")
        .eq("workspace_id", workspace.id);
      expect(error).toBeNull();
      expect(rows).toHaveLength(4);
      const byConnection = new Map<string, string[]>();
      for (const row of rows ?? []) {
        byConnection.set(row.connection_id, [...(byConnection.get(row.connection_id) ?? []), row.id]);
      }
      expect([...byConnection.keys()].sort()).toEqual([first, second].sort());
      expect(byConnection.get(first)).toHaveLength(2);
      expect(byConnection.get(second)).toHaveLength(2);
      // Same provider accounts, never the same rows.
      expect(new Set((rows ?? []).map((row) => row.id)).size).toBe(4);

      await page.goto(`/w/${workspace.slug}/connections`);
      await expect(page.getByRole("list", { name: "Connections" }).getByRole("listitem")).toHaveCount(2);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("names a declined permission and offers to reconnect", async ({ page }) => {
    const workspace = await createTestWorkspace("Connect declined");
    try {
      await page.goto(`/w/${workspace.slug}/connections`);
      await startFakeConnect(page, workspace.slug, (url) => url.searchParams.set("decline", "usage:read"));
      await expect(page).toHaveURL(CONNECTION_URL);
      await expect(page.getByText("Status: Needs attention").first()).toBeVisible();
      const attention = page.getByRole("region", {
        name: `${PROVIDER_NAME} did not grant every permission DevMacro needs`,
      });
      await expect(attention).toContainText("Missing: usage:read");
      await attention.getByRole("link", { name: `Reconnect ${PROVIDER_NAME}` }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Reconnect ${PROVIDER_NAME}`);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("says so when the person cancels at the provider", async ({ page }) => {
    const workspace = await createTestWorkspace("Connect cancelled");
    try {
      await page.goto(`/w/${workspace.slug}/connections`);
      await startFakeConnect(page, workspace.slug, (url) => url.searchParams.set("error", "access_denied"));
      await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/connections\\?error=cancelled`));
      const alert = page.getByRole("alert").filter({ hasText: `You cancelled connecting ${PROVIDER_NAME}.` });
      await expect(alert).toBeVisible();
      await expect(alert).toBeFocused();
      const { count } = await adminClient()
        .from("connections")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id);
      expect(count).toBe(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("refuses a state that was already used", async ({ page }) => {
    const workspace = await createTestWorkspace("Connect replay");
    try {
      await page.goto(`/w/${workspace.slug}/connections`);
      let callback = "";
      page.on("request", (request) => {
        if (request.url().includes("/api/connections/fake/callback")) callback = request.url();
      });
      await startFakeConnect(page, workspace.slug, () => undefined);
      await expect(page).toHaveURL(CONNECTION_URL);
      expect(callback).not.toBe("");

      // Replay the exact callback. A consumed state names no workspace, so the route falls back to
      // the user's last-opened workspace, which parallel specs change; assert on the redirect
      // itself (never a connection page, always the invalid outcome) rather than where it lands.
      const replay = await page.request.get(callback, { maxRedirects: 0 });
      expect(replay.status()).toBe(303);
      const location = new URL(replay.headers().location ?? "", callback);
      expect(location.pathname).not.toMatch(CONNECTION_URL);
      if (location.pathname !== "/app") {
        expect(location.pathname).toMatch(/^\/w\/[a-z0-9]+\/connections$/);
        expect(location.searchParams.get("error")).toBe("invalid");
        expect(location.searchParams.get("provider")).toBe("fake");
      }
      const { count } = await adminClient()
        .from("connections")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id);
      expect(count).toBe(1);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("disconnects after confirming, keeping the history and deleting the credential", async ({ page }) => {
    const workspace = await createTestWorkspace("Disconnect");
    try {
      const connectionId = await connectThroughUi(page, workspace.slug);
      // Scoped to main and exact: the workspace switcher's name contains "Disconnect" too.
      const main = page.getByRole("main");
      await main.getByRole("button", { name: "Disconnect", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: `Disconnect ${PROVIDER_NAME}?` });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText("Deletes the stored credential");
      await expect(dialog).toContainText("Keeps the history already collected");

      // Cancel leaves everything as it was.
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toBeHidden();

      await main.getByRole("button", { name: "Disconnect", exact: true }).click();
      await dialog.getByRole("button", { name: "Disconnect", exact: true }).click();
      await expect(page.getByRole("status").filter({ hasText: "Disconnected. The credential is deleted" })).toBeVisible();
      await expect(page.getByText("Status: Disconnected").first()).toBeVisible();

      const admin = adminClient();
      const [{ data: credential }, { data: connection }, { count: accounts }] = await Promise.all([
        admin.from("connection_credentials").select("connection_id").eq("connection_id", connectionId).maybeSingle(),
        admin.from("connections").select("status").eq("id", connectionId).single(),
        admin
          .from("external_accounts")
          .select("id", { count: "exact", head: true })
          .eq("connection_id", connectionId),
      ]);
      expect(credential).toBeNull();
      expect(connection?.status).toBe("revoked");
      expect(accounts).toBe(2);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("deletes a connection and its history after a separate confirmation", async ({ page }) => {
    const workspace = await createTestWorkspace("Delete connection");
    try {
      const connectionId = await connectThroughUi(page, workspace.slug);
      await page.getByRole("main").getByRole("button", { name: "Delete connection and history", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Delete this connection and its history?" });
      await dialog.getByRole("button", { name: "Delete connection and history", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`/w/${workspace.slug}/connections\\?deleted=fake`));
      await expect(page.getByRole("status").filter({ hasText: "Connection deleted" })).toBeVisible();
      const { count } = await adminClient()
        .from("connections")
        .select("id", { count: "exact", head: true })
        .eq("id", connectionId);
      expect(count).toBe(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest.describe("connections as a viewer", () => {
  viewerTest("shows status only, with no Connect or management controls", async ({ page }) => {
    const workspace = await createTestWorkspace("Viewer connections");
    try {
      const { data: seeded, error } = await adminClient()
        .from("connections")
        .insert({
          workspace_id: workspace.id,
          provider: "fake",
          status: "active",
          display_name: `${PROVIDER_NAME} (Seeded team)`,
          authorized_account_label: "Seeded team",
          poll_interval_seconds: 3600,
        })
        .select("id")
        .single();
      if (error) throw new Error(`Seeding a connection failed (code ${error.code}).`);

      await page.goto(`/w/${workspace.slug}/connections`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connections");
      await expect(page.getByRole("link", { name: /^Connect / })).toHaveCount(0);
      await expect(page.getByText("Only owners and admins can connect providers.").first()).toBeVisible();
      const row = page.getByRole("list", { name: "Connections" }).getByRole("listitem").first();
      await expect(row.getByText("Status: Active")).toBeVisible();

      await page.goto(`/w/${workspace.slug}/connections/${seeded.id}`);
      await expect(page.getByText("Status: Active").first()).toBeVisible();
      for (const name of ["Sync now", "Disconnect", "Delete connection and history"]) {
        await expect(page.getByRole("button", { name })).toHaveCount(0);
      }
      await expect(page.getByRole("link", { name: "Reconnect" })).toHaveCount(0);

      // The start route refuses a viewer even when called directly.
      const response = await page.request.get(
        `/api/connections/fake/start?${new URLSearchParams({ workspace: workspace.slug, consent: "1" }).toString()}`,
        { maxRedirects: 0 },
      );
      expect(response.status()).toBe(303);
      expect(response.headers().location).toContain("error=forbidden");
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

test.describe("connections when signed out", () => {
  test("sends the start route to sign-in", async ({ page }) => {
    const response = await page.request.get("/api/connections/fake/start?workspace=abcdefghij&consent=1", {
      maxRedirects: 0,
    });
    expect([303, 307]).toContain(response.status());
    expect(response.headers().location).toContain("/sign-in");
  });
});
