import { createServer, type IncomingHttpHeaders, type Server } from "node:http";

import AxeBuilder from "@axe-core/playwright";

import { expect, ownerTest, viewerTest } from "./fixtures/auth";
import { adminClient, createTestWorkspace, deleteTestWorkspace } from "./fixtures/db";

/*
 * Alert channels (#153), end to end: an owner adds a generic webhook channel, sends a test message
 * that reaches a receiver on this machine with a Standard Webhooks signature, and removes the
 * channel, which deletes its sealed URL. A plain http URL on 127.0.0.1 is a private address: the
 * dev server allows it, and CI's production build sets DEVMACRO_ALLOW_PRIVATE_WEBHOOKS=1.
 * No tick runs here, so it stays in the `chromium` project.
 */

type Received = { headers: IncomingHttpHeaders; body: string };

async function startReceiver(): Promise<{ server: Server; url: string; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      received.push({ headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      response.writeHead(204).end();
    });
  });
  const listening = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => listening.resolve());
  await listening.promise;
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("the receiver has no TCP address");
  return { server, url: `http://127.0.0.1:${address.port}/devmacro`, received };
}

async function stopReceiver(server: Server): Promise<void> {
  const closed = Promise.withResolvers<void>();
  server.close(() => closed.resolve());
  await closed.promise;
}

ownerTest.describe("alert channels as the owner", () => {
  ownerTest("adds a webhook, sends a test message to it, and removing it deletes the URL", async ({ page }) => {
    const workspace = await createTestWorkspace("Alert channels");
    const receiver = await startReceiver();
    try {
      await page.goto(`/w/${workspace.slug}/alerts`);
      const channels = page.getByRole("region", { name: "Channels" });
      await expect(channels.getByText("No channels yet")).toBeVisible();

      const form = channels.getByRole("form", { name: "Add a channel" });
      await form.getByLabel("Where to post").selectOption({ label: "Webhook" });
      await form.getByLabel("Channel name").fill("Ops webhook");
      await form.getByLabel("Webhook URL").fill(receiver.url);
      await form.getByRole("button", { name: "Add channel" }).click();
      await expect(form.getByRole("status")).toContainText("Channel added. Send a test message to check it.");
      // The signing secret is shown once, for the receiver to verify signatures with.
      await expect(form.getByText(/^whsec_/)).toBeVisible();

      const row = channels.getByRole("list", { name: "Channels" }).getByRole("listitem").filter({ hasText: "Ops webhook" });
      await expect(row.getByText("Webhook at 127.0.0.1", { exact: false })).toBeVisible();
      await expect(row.getByText(receiver.url)).toHaveCount(0);
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

      const { data: destination, error } = await adminClient()
        .from("notification_destinations")
        .select("id")
        .eq("workspace_id", workspace.id)
        .single();
      if (error) throw new Error(`Reading the channel failed (code ${error.code}).`);
      const secrets = () =>
        adminClient().from("notification_destination_secrets").select("destination_id", { count: "exact", head: true }).eq("destination_id", destination.id);
      expect((await secrets()).count).toBe(1);

      await row.getByRole("button", { name: "Send test message: Ops webhook" }).click();
      await expect(row.getByText("Test message sent to Ops webhook.")).toBeVisible();
      expect(receiver.received).toHaveLength(1);
      const [delivery] = receiver.received;
      expect(delivery?.headers["webhook-signature"]).toMatch(/^v1,/);
      expect(delivery?.headers["webhook-id"]).toBeTruthy();
      expect(delivery?.body).toContain(`Test message from DevMacro for ${workspace.name}`);
      expect(delivery?.body).not.toContain(receiver.url);

      // Keyboard: the remove button opens the dialog, and Enter on its confirm button removes it.
      await row.getByRole("button", { name: "Remove channel: Ops webhook" }).focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Remove this channel?" });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Remove channel" }).focus();
      await page.keyboard.press("Enter");
      await expect(channels.getByText("No channels yet")).toBeVisible();
      await expect(page.getByRole("heading", { name: "Channels" })).toBeFocused();

      expect((await secrets()).count).toBe(0);
    } finally {
      await stopReceiver(receiver.server);
      await deleteTestWorkspace(workspace);
    }
  });

  ownerTest("refuses a Discord channel with a URL that is not a Discord webhook", async ({ page }) => {
    const workspace = await createTestWorkspace("Alert channel errors");
    try {
      await page.goto(`/w/${workspace.slug}/alerts`);
      const form = page.getByRole("form", { name: "Add a channel" });
      await form.getByLabel("Channel name").fill("#alerts");
      await form.getByLabel("Webhook URL").fill("https://example.com/not-discord");
      await form.getByRole("button", { name: "Add channel" }).click();
      await expect(form.getByRole("alert")).toContainText("The channel was not added");
      await expect(form.getByLabel("Webhook URL")).toHaveAttribute("aria-invalid", "true");
      const { count } = await adminClient()
        .from("notification_destinations")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspace.id);
      expect(count).toBe(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});

viewerTest.describe("alert channels and emails as a viewer", () => {
  viewerTest("sees why they cannot add a channel or receive alert emails", async ({ page }) => {
    const workspace = await createTestWorkspace("Alert channels viewer");
    try {
      await page.goto(`/w/${workspace.slug}/alerts`);
      await expect(page.getByRole("region", { name: "Alert emails" }).getByText("Only owners and admins receive alert emails for this workspace.")).toBeVisible();
      const channels = page.getByRole("region", { name: "Channels" });
      await expect(channels.getByText("Only owners and admins can add or change where alerts are posted.")).toBeVisible();
      await expect(channels.getByRole("form", { name: "Add a channel" })).toHaveCount(0);
    } finally {
      await deleteTestWorkspace(workspace);
    }
  });
});
