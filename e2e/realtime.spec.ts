import { randomUUID } from "node:crypto";

import type { Page } from "@playwright/test";
import { REALTIME_SUBSCRIBE_STATES } from "@supabase/supabase-js";
import { z } from "zod";

import {
  createSyntheticUser,
  expect,
  ownerTest,
  removeSyntheticUser,
  STORAGE_STATE,
  syntheticUserClient,
  type SyntheticUser,
} from "./fixtures/auth";
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

// The columns of a delivered activity event that the isolation test compares.
const DeliveredEventSchema = z.object({ workspace_id: z.string(), title: z.string() });

type OutsideSubscription = Readonly<{
  /** "joining" until Realtime streams the changes, then "subscribed", or the failure status. */
  state: () => string;
  /** Every inserted row delivered, in order, unparsed. */
  delivered: () => readonly unknown[];
  close: () => Promise<void>;
}>;

/**
 * Subscribes to activity event inserts as a signed-in user from outside the app, with a filter per
 * workspace id the test picks: what a hostile client can send. One channel carries every binding,
 * so Realtime delivers its changes in WAL order.
 */
async function subscribeOutsideApp(user: SyntheticUser, workspaceIds: readonly string[]): Promise<OutsideSubscription> {
  const supabase = syntheticUserClient(user);
  // Join with the user's access token, not the publishable key alone (see live-refresh.tsx).
  await supabase.realtime.setAuth();
  let state = "joining";
  const delivered: unknown[] = [];
  const channel = supabase.channel(`e2e-outside:${randomUUID()}`);
  for (const workspaceId of workspaceIds) {
    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "activity_events", filter: `workspace_id=eq.${workspaceId}` },
      ({ new: row }) => delivered.push(row),
    );
  }
  channel.on("system", {}, (payload: unknown) => {
    if (SubscribedSchema.safeParse(payload).success) state = "subscribed";
  });
  channel.subscribe((status) => {
    if (status === REALTIME_SUBSCRIBE_STATES.CHANNEL_ERROR || status === REALTIME_SUBSCRIBE_STATES.TIMED_OUT) {
      state = status;
    }
  });
  return {
    state: () => state,
    delivered: () => delivered,
    close: async () => {
      await supabase.removeAllChannels();
    },
  };
}

ownerTest.describe("live updates", () => {
  ownerTest("shows a new timeline event without a reload and leaves the channel with the workspace", async ({ page }) => {
    const workspace = await createTestWorkspace("Live timeline");
    try {
      const seeded = await seedConnection(workspace);
      const live = watchLiveChannel(page, workspace.id);
      await page.goto(`/w/${workspace.slug}/timeline`);
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

  ownerTest("keeps a workspace's changes from non-members, by the page filter and by row level security", async ({
    page,
    browser,
  }) => {
    const [ownersOnly, viewers, outsider] = await Promise.all([
      createTestWorkspace("Live owner only"),
      createTestWorkspace("Live viewer"),
      createSyntheticUser("live-outsider"),
    ]);
    const viewerContext = await browser.newContext({ storageState: STORAGE_STATE.viewer });
    let outside: OutsideSubscription | undefined;
    try {
      // The viewer and the outsider belong to `viewers` only, so `ownersOnly` is not theirs.
      const admin = adminClient();
      const [{ error: removeError }, { error: addError }] = await Promise.all([
        admin.from("workspace_members").delete().eq("workspace_id", ownersOnly.id).eq("user_id", ownersOnly.viewerId),
        admin.from("workspace_members").insert({ workspace_id: viewers.id, user_id: outsider.id, role: "viewer" }),
      ]);
      if (removeError) throw new Error(`Removing the viewer failed (code ${removeError.code}).`);
      if (addError) throw new Error(`Adding the outsider failed (code ${addError.code}).`);
      const [ownersOnlyConnection, viewersConnection] = await Promise.all([
        seedConnection(ownersOnly),
        seedConnection(viewers),
      ]);

      const viewerPage = await viewerContext.newPage();
      const ownerLive = watchLiveChannel(page, ownersOnly.id);
      const viewerLive = watchLiveChannel(viewerPage, viewers.id);
      // The viewer's page filters on its own workspace, so it never asks for `ownersOnly`. The
      // outsider asks for `ownersOnly` by id, which the app never does: only row level security
      // stands between that subscription and the row.
      const subscription = await subscribeOutsideApp(outsider, [ownersOnly.id, viewers.id]);
      outside = subscription;
      await Promise.all([page.goto(`/w/${ownersOnly.slug}/timeline`), viewerPage.goto(`/w/${viewers.slug}/timeline`)]);
      await expect(page.getByRole("heading", { name: "No activity yet" })).toBeVisible();
      await expect(viewerPage.getByRole("heading", { name: "No activity yet" })).toBeVisible();
      await Promise.all([
        expectSubscribed(ownerLive),
        expectSubscribed(viewerLive),
        expect.poll(subscription.state, { timeout: LIVE_TIMEOUT_MS }).toBe("subscribed"),
      ]);

      const ownerOnlyTitle = `Owner only event ${randomUUID().slice(0, 8)}`;
      await insertEvent(ownersOnlyConnection, ownerOnlyTitle);
      // A member receives it, so Realtime has already decided who gets the row.
      await expect(page.getByRole("heading", { name: ownerOnlyTitle, exact: true })).toBeVisible({
        timeout: LIVE_TIMEOUT_MS,
      });

      // Realtime delivers a channel's changes in WAL order, so once a row written after the owner
      // only row arrives on a channel, the owner only row is not still on its way to that channel.
      const sentinelTitle = `Viewer sentinel ${randomUUID().slice(0, 8)}`;
      await insertEvent(viewersConnection, sentinelTitle);
      await expect(viewerPage.getByRole("heading", { name: sentinelTitle, exact: true })).toBeVisible({
        timeout: LIVE_TIMEOUT_MS,
      });
      await expect.poll(() => subscription.delivered().length, { timeout: LIVE_TIMEOUT_MS }).toBeGreaterThan(0);

      // The page filter: the viewer's tab heard about the sentinel and nothing else.
      expect(viewerLive.changesReceived()).toBe(1);
      await expect(viewerPage.getByRole("heading", { name: ownerOnlyTitle })).toHaveCount(0);
      // Row level security: the binding filtered on `ownersOnly` delivered nothing.
      expect(z.array(DeliveredEventSchema).parse(subscription.delivered())).toEqual([
        { workspace_id: viewers.id, title: sentinelTitle },
      ]);
    } finally {
      await Promise.all([viewerContext.close(), outside?.close()]);
      await Promise.all([deleteTestWorkspace(ownersOnly), deleteTestWorkspace(viewers)]);
      await removeSyntheticUser(outsider);
    }
  });
});
