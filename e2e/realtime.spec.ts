import { randomUUID } from "node:crypto";

import AxeBuilder from "@axe-core/playwright";
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

/** This month's verified USD spend for the seeded account, dated today; returns the row id. */
async function insertSpendSnapshot(seeded: SeededConnection, amountMinor: number): Promise<string> {
  const now = new Date();
  const { data, error } = await adminClient()
    .from("usage_snapshots")
    .insert({
      workspace_id: seeded.workspaceId,
      connection_id: seeded.connectionId,
      external_account_id: seeded.accountId,
      metric_key: "fake.spend.month",
      kind: "verified_spend",
      label: "Spend this month",
      snapshot_date: now.toISOString().slice(0, 10),
      amount_minor: amountMinor,
      currency: "USD",
      period_start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      period_end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(),
      retrieved_at: now.toISOString(),
      provenance_source: "provider_api",
    })
    .select("id")
    .single();
  if (error) throw new Error(`Inserting a live snapshot failed (code ${error.code}).`);
  return data.id;
}

/** A later sync of the same day's snapshot: an UPDATE, the way a resync rewrites today's value. */
async function updateSpendSnapshot(snapshotId: string, amountMinor: number): Promise<void> {
  const { error } = await adminClient()
    .from("usage_snapshots")
    .update({ amount_minor: amountMinor, retrieved_at: new Date().toISOString() })
    .eq("id", snapshotId);
  if (error) throw new Error(`Updating a live snapshot failed (code ${error.code}).`);
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
      const seeded = await seedConnection(workspace);
      const live = watchLiveChannel(page, workspace.id);
      await page.goto(`/w/${workspace.slug}/dashboard`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Dashboard");
      const usd = page.getByRole("region", { name: "Spending this billing period" }).getByRole("region", {
        name: "Spend in USD",
      });
      await expect(usd).toHaveCount(0);
      await expectSubscribed(live);

      await insertSpendSnapshot(seeded, 4_321);

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

// Arriving data (#171): the keyframes the workspace runs when a live refresh brings new data
// (src/app/globals.css). The landing page runs some of them too, never a workspace page on load.
const ARRIVAL_ANIMATIONS: readonly string[] = [
  "feed-content-in",
  "feed-flash",
  "alert-glow",
  "count-up",
  "bar-fill",
  "spark-ping",
  "live-pulse",
];

// A highlight clears after ARRIVAL_HIGHLIGHT_MS (4 s, src/lib/realtime/arrivals.ts); this leaves
// room for a slow first render.
const HIGHLIGHT_CLEARED_MS = 10_000;

/**
 * Records the name of every arrival animation that starts on the page, from the first document
 * on, so "nothing animated" is an observed fact rather than a check that happened to run late.
 * Call before navigating.
 */
async function recordArrivalAnimations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    const started: string[] = [];
    Reflect.set(window, "__startedAnimations", started);
    document.addEventListener("animationstart", (event) => started.push(event.animationName), true);
  });
  return async () => {
    const started = z.array(z.string()).parse(await page.evaluate(() => Reflect.get(window, "__startedAnimations")));
    return started.filter((name) => ARRIVAL_ANIMATIONS.includes(name));
  };
}

/** Records every sentence the polite arrival region says from now on. */
async function recordAnnouncements(page: Page): Promise<() => Promise<string[]>> {
  await page.getByTestId("arrival-announcement").evaluate((region) => {
    const said: string[] = [];
    Reflect.set(window, "__announcements", said);
    new MutationObserver(() => {
      const text = region.textContent ?? "";
      if (text !== "") said.push(text);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  });
  return async () => z.array(z.string()).parse(await page.evaluate(() => Reflect.get(window, "__announcements")));
}

ownerTest.describe("arriving data", () => {
  ownerTest("marks a new timeline event once, announces it, and animates nothing on load", async ({ page }) => {
    const workspace = await createTestWorkspace("Arrival timeline");
    try {
      const seeded = await seedConnection(workspace);
      await insertEvent(seeded, "Earlier event");
      const animations = await recordArrivalAnimations(page);
      const live = watchLiveChannel(page, workspace.id);
      await page.goto(`/w/${workspace.slug}/timeline`);
      await expect(page.getByRole("heading", { name: "Earlier event", exact: true })).toBeVisible();
      await expectSubscribed(live);
      const announcements = await recordAnnouncements(page);
      const indicator = page.getByRole("button", { name: "Live updates" });
      await expect(indicator).toBeVisible();
      // Subscribed: the name is exactly "Live updates" and the visible word says Live.
      await expect(indicator).toHaveAccessibleName("Live updates");
      await expect(indicator.getByText("Live", { exact: true })).toBeVisible();
      await expect(page.getByTestId("live-pulse")).toHaveCount(0);
      expect(await animations()).toEqual([]);

      const title = `Arriving event ${randomUUID().slice(0, 8)}`;
      await insertEvent(seeded, title);
      const row = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
      const label = row.getByText(/^,?\s*New$/);
      await expect(label).toBeVisible({ timeout: LIVE_TIMEOUT_MS });
      await expect(page.getByTestId("arrival-announcement")).toHaveText("1 new event.");
      await expect.poll(animations).toEqual(expect.arrayContaining(["live-pulse", "feed-content-in", "feed-flash"]));
      // The row that was already there is not marked.
      const earlier = page.getByRole("listitem").filter({ has: page.getByRole("heading", { name: "Earlier event" }) });
      await expect(earlier.getByText(/^,?\s*New$/)).toHaveCount(0);

      // The highlight clears on its own, and the batch was announced exactly once.
      await expect(label).toBeHidden({ timeout: HIGHLIGHT_CLEARED_MS });
      expect(await announcements()).toEqual(["1 new event."]);

      // Focus shows when data last arrived; Escape hides it.
      await indicator.focus();
      await expect(page.getByRole("tooltip")).toContainText("Data last arrived");
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);
      await page.keyboard.press("Escape");
      await expect(page.getByRole("tooltip")).toBeHidden();
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("counts, pulses, and pings a changed dashboard value, and not after a period change", async ({ page }) => {
    const workspace = await createTestWorkspace("Arrival dashboard");
    try {
      const seeded = await seedConnection(workspace);
      const snapshotId = await insertSpendSnapshot(seeded, 4_321);
      const animations = await recordArrivalAnimations(page);
      const live = watchLiveChannel(page, workspace.id);
      await page.goto(`/w/${workspace.slug}/dashboard`);
      const usd = page.getByRole("region", { name: "Spending this billing period" }).getByRole("region", {
        name: "Spend in USD",
      });
      await expect(usd).toContainText("$43.21");
      await expectSubscribed(live);
      expect(await animations()).toEqual([]);

      await updateSpendSnapshot(snapshotId, 5_000);
      await expect(usd).toContainText("$50.00", { timeout: LIVE_TIMEOUT_MS });
      await expect(usd.getByText("Updated", { exact: true })).toBeVisible();
      await expect(page.getByTestId("arrival-announcement")).toContainText("Spend in USD updated.");
      await expect
        .poll(animations)
        .toEqual(expect.arrayContaining(["live-pulse", "count-up", "alert-glow", "spark-ping"]));
      await expect(usd.getByText("Updated", { exact: true })).toBeHidden({ timeout: HIGHLIGHT_CLEARED_MS });

      // Changing the trend period is navigation, not arrival: nothing new animates.
      const before = (await animations()).length;
      await page.getByRole("link", { name: /^Monthly/ }).click();
      await expect(page).toHaveURL(/trend=monthly/);
      await expect(page.getByRole("link", { name: /^Monthly/ })).toHaveAttribute("aria-current", "page");
      expect(await animations()).toHaveLength(before);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("under reduced motion, marks a changed value with a static label and announces it once", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    const workspace = await createTestWorkspace("Arrival reduced motion");
    try {
      const seeded = await seedConnection(workspace);
      const snapshotId = await insertSpendSnapshot(seeded, 4_321);
      const animations = await recordArrivalAnimations(page);
      const live = watchLiveChannel(page, workspace.id);
      await page.goto(`/w/${workspace.slug}/dashboard`);
      const usd = page.getByRole("region", { name: "Spending this billing period" }).getByRole("region", {
        name: "Spend in USD",
      });
      await expect(usd).toContainText("$43.21");
      await expectSubscribed(live);
      const announcements = await recordAnnouncements(page);
      await expect(usd.getByText("Updated", { exact: true })).toHaveCount(0);

      await updateSpendSnapshot(snapshotId, 5_000);
      await expect(usd.getByText("Updated", { exact: true })).toBeVisible({ timeout: LIVE_TIMEOUT_MS });
      await expect(usd).toContainText("$50.00");
      await expect(page.getByTestId("arrival-announcement")).toContainText("Spend in USD updated.");
      // The static highlight and its label, scanned while they show.
      const scan = await new AxeBuilder({ page }).analyze();
      expect(scan.violations).toEqual([]);

      // The static label clears on its own; nothing moved, scaled, or counted on the way.
      await expect(usd.getByText("Updated", { exact: true })).toBeHidden({ timeout: HIGHLIGHT_CLEARED_MS });
      expect(await animations()).toEqual([]);
      expect(await announcements()).toHaveLength(1);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
