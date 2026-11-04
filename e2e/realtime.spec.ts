import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import { z } from "zod";

import { authEnv, expect, ownerTest, STORAGE_STATE } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace, type TestWorkspace } from "./fixtures/db";

// Live updates (#129): a row written after the page loaded appears without a reload. Every test
// seeds its own workspaces, and the rows go in with the service role, the way a sync writes them.

// A change reaches an open page within a few seconds: Realtime delivery, the refresh debounce, and
// one server render.
const LIVE_TIMEOUT_MS = 15_000;

// Realtime text frames are [join_ref, ref, topic, event, payload] (realtime-js serializer 2.0.0).
const FrameSchema = z.tuple([z.unknown(), z.unknown(), z.string(), z.string(), z.unknown()]);
// Sent by Realtime once the channel's postgres_changes subscription is streaming.
const SubscribedSchema = z.object({ extension: z.literal("postgres_changes"), status: z.literal("ok") });

type LiveChannel = Readonly<{
  subscribed: () => boolean;
  left: () => boolean;
  changesReceived: () => number;
}>;

/**
 * Watches the page's Realtime socket for the workspace channel that LiveRefresh opens. Call it
 * before navigating, so no frame is missed. Waiting for the subscription before writing a row is
 * what makes the tests deterministic: a row written earlier is never delivered.
 */
function watchLiveChannel(page: Page, workspaceId: string): LiveChannel {
  const topicPrefix = `realtime:workspace-live:${workspaceId}:`;
  let subscribed = false;
  let left = false;
  let changes = 0;

  function frameOf(data: string | Buffer): z.infer<typeof FrameSchema> | null {
    if (typeof data !== "string") return null;
    const frame = FrameSchema.safeParse(JSON.parse(data));
    return frame.success && frame.data[2].startsWith(topicPrefix) ? frame.data : null;
  }

  page.on("websocket", (socket) => {
    if (!socket.url().includes("/realtime/v1/websocket")) return;
    socket.on("framereceived", ({ payload }) => {
      const frame = frameOf(payload);
      if (frame === null) return;
      const [, , , event, body] = frame;
      if (event === "system" && SubscribedSchema.safeParse(body).success) subscribed = true;
      if (event === "postgres_changes") changes += 1;
    });
    socket.on("framesent", ({ payload }) => {
      if (frameOf(payload)?.[3] === "phx_leave") left = true;
    });
  });

  return { subscribed: () => subscribed, left: () => left, changesReceived: () => changes };
}

async function expectSubscribed(channel: LiveChannel): Promise<void> {
  await expect.poll(channel.subscribed, { timeout: LIVE_TIMEOUT_MS }).toBe(true);
}

type SeededConnection = Readonly<{ workspaceId: string; connectionId: string; accountId: string }>;

/** A fake connection with one account, the parents every synced row points at. */
async function seedConnection(workspace: TestWorkspace): Promise<SeededConnection> {
  const admin = adminClient();
  const { data: connection, error: connectionError } = await admin
    .from("connections")
    .insert({
      workspace_id: workspace.id,
      provider: "fake",
      status: "active",
      display_name: "Fake live connection",
      poll_interval_seconds: 3_600,
      last_synced_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (connectionError) throw new Error(`Seeding a connection failed (code ${connectionError.code}).`);
  const { data: account, error: accountError } = await admin
    .from("external_accounts")
    .insert({
      workspace_id: workspace.id,
      connection_id: connection.id,
      external_id: "acct_live",
      display_name: "Live account",
      kind: "account",
    })
    .select("id")
    .single();
  if (accountError) throw new Error(`Seeding an account failed (code ${accountError.code}).`);
  return { workspaceId: workspace.id, connectionId: connection.id, accountId: account.id };
}

async function insertEvent(seeded: SeededConnection, title: string): Promise<void> {
  const { error } = await adminClient().from("activity_events").insert({
    workspace_id: seeded.workspaceId,
    connection_id: seeded.connectionId,
    external_account_id: seeded.accountId,
    provider: "fake",
    type_id: "fake.deploy.succeeded",
    severity: "info",
    title,
    occurred_at: new Date().toISOString(),
    dedupe_key: `e2e-live-${randomUUID()}`,
  });
  if (error) throw new Error(`Inserting a live event failed (code ${error.code}).`);
}

ownerTest.describe("live updates", () => {
  ownerTest("shows a new timeline event without a reload and leaves the channel with the workspace", async ({ page }) => {
    const workspace = await createTestWorkspace("Live timeline");
    try {
      const seeded = await seedConnection(workspace);
      const live = watchLiveChannel(page, workspace.id);
      const response = await page.goto(`/w/${workspace.slug}/timeline`);

      // The app policy lets the page open the Realtime socket on the Supabase host.
      const supabaseUrl = new URL(authEnv().NEXT_PUBLIC_SUPABASE_URL);
      const socketOrigin = `${supabaseUrl.protocol === "https:" ? "wss:" : "ws:"}//${supabaseUrl.host}`;
      const policy = response?.headers()["content-security-policy-report-only"] ?? "";
      expect(policy.split("; ").find((directive) => directive.startsWith("connect-src "))?.split(" ")).toContain(
        socketOrigin,
      );

      await expect(page.getByRole("heading", { name: "No activity yet" })).toBeVisible();
      await expectSubscribed(live);

      const title = `Live event ${randomUUID().slice(0, 8)}`;
      await insertEvent(seeded, title);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: LIVE_TIMEOUT_MS });
      await expect(page.getByRole("heading", { name: "No activity yet" })).toHaveCount(0);

      // Leaving the workspace removes the subscription.
      await page.getByRole("link", { name: "Account", exact: true }).click();
      await expect(page).toHaveURL(/\/account$/);
      await expect.poll(live.left, { timeout: LIVE_TIMEOUT_MS }).toBe(true);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("shows a new dashboard snapshot without a reload", async ({ page }) => {
    const workspace = await createTestWorkspace("Live dashboard");
    try {
      const { connectionId, accountId } = await seedConnection(workspace);
      const live = watchLiveChannel(page, workspace.id);
      await page.goto(`/w/${workspace.slug}/dashboard`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
      const usd = page.getByRole("region", { name: "Spending this billing period" }).getByRole("region", {
        name: "Spend in USD",
      });
      await expect(usd).toHaveCount(0);
      await expectSubscribed(live);

      const now = new Date();
      const { error } = await adminClient().from("usage_snapshots").insert({
        workspace_id: workspace.id,
        connection_id: connectionId,
        external_account_id: accountId,
        metric_key: "fake.spend.month",
        kind: "verified_spend",
        label: "Spend this month",
        snapshot_date: now.toISOString().slice(0, 10),
        amount_minor: 4_321,
        currency: "USD",
        period_start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
        period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
        retrieved_at: now.toISOString(),
        provenance_source: "provider_api",
      });
      if (error) throw new Error(`Inserting a live snapshot failed (code ${error.code}).`);

      await expect(usd).toContainText("$43.21", { timeout: LIVE_TIMEOUT_MS });
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("does not reach a member of a different workspace", async ({ page, browser }) => {
    const [ownersOnly, viewers] = await Promise.all([
      createTestWorkspace("Live owner only"),
      createTestWorkspace("Live viewer"),
    ]);
    const viewerContext = await browser.newContext({ storageState: STORAGE_STATE.viewer });
    try {
      // The viewer belongs to `viewers` only, so the event's workspace is not theirs.
      const { error: removeError } = await adminClient()
        .from("workspace_members")
        .delete()
        .eq("workspace_id", ownersOnly.id)
        .eq("user_id", ownersOnly.viewerId);
      if (removeError) throw new Error(`Removing the viewer failed (code ${removeError.code}).`);
      const [ownersOnlyConnection] = await Promise.all([seedConnection(ownersOnly), seedConnection(viewers)]);

      const viewerPage = await viewerContext.newPage();
      const ownerLive = watchLiveChannel(page, ownersOnly.id);
      const viewerLive = watchLiveChannel(viewerPage, viewers.id);
      await Promise.all([page.goto(`/w/${ownersOnly.slug}/timeline`), viewerPage.goto(`/w/${viewers.slug}/timeline`)]);
      await expect(page.getByRole("heading", { name: "No activity yet" })).toBeVisible();
      await expect(viewerPage.getByRole("heading", { name: "No activity yet" })).toBeVisible();
      await Promise.all([expectSubscribed(ownerLive), expectSubscribed(viewerLive)]);

      const title = `Owner only event ${randomUUID().slice(0, 8)}`;
      await insertEvent(ownersOnlyConnection, title);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible({ timeout: LIVE_TIMEOUT_MS });

      await expect(viewerPage.getByRole("heading", { name: title })).toHaveCount(0);
      await expect(viewerPage.getByRole("heading", { name: "No activity yet" })).toBeVisible();
      // Nothing about the other workspace's row reached the viewer's tab at all.
      expect(viewerLive.changesReceived()).toBe(0);
    } finally {
      await viewerContext.close();
      await Promise.all([deleteTestWorkspace(ownersOnly), deleteTestWorkspace(viewers)]);
    }
  });
});
