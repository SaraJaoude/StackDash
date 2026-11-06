import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";
import { z } from "zod";

/**
 * Scans the whole page with axe and expects no violations, once the document has a title.
 *
 * Every server render of the route keys the page's metadata by its request id
 * (node_modules/next/dist/server/app-render/app-render.js, `getFlightMetadataKey`): a Server Action
 * that calls `refresh()`, a live update's `router.refresh()`, and a client navigation (`<Link>`,
 * `router.push`) alike. React removes the old `<title>` and mounts the new one in a fresh
 * `Suspense` that stays empty until the metadata row of the streamed response arrives
 * (lib/metadata/metadata.js, `MetadataWrapper`). A scan that lands between the two reports
 * `document-title` for a title the page gets moments later (#179). So every full-page scan that
 * follows any of those renders goes through here. Only scans after a document load (`page.goto`,
 * `reload`) stay inline, because the document's HTML carries the title in `<head>`. Waiting for a
 * non-empty title keeps the rule on: a page that never gets one still fails here, on the wait.
 *
 * The wait covers the last render before the scan. When an action also writes a live table, a
 * second render follows it, so wait for that one first (`watchLiveRefresh`).
 */
export async function expectNoAxeViolations(page: Page): Promise<void> {
  await expect(page).toHaveTitle(/\S/);
  const scan = await new AxeBuilder({ page }).analyze();
  expect(scan.violations).toEqual([]);
}

// Realtime text frames are [join_ref, ref, topic, event, payload] (realtime-js serializer 2.0.0),
// read the same way as e2e/realtime.spec.ts `watchLiveChannel`.
const FrameSchema = z.tuple([z.unknown(), z.unknown(), z.string(), z.string(), z.unknown()]);
// Sent by Realtime once the channel's postgres_changes subscription is streaming.
const StreamingSchema = z.object({ extension: z.literal("postgres_changes"), status: z.literal("ok") });

export type LiveRefreshWatch = Readonly<{
  /** Call before the action. Resolves once the action's change is sure to be delivered; the returned function waits for the refresh it sets off. */
  next: () => Promise<() => Promise<void>>;
}>;

/**
 * For an action that writes a live table (`LIVE_TABLES` in src/components/app/live-refresh.tsx).
 * The action's own `refresh()` rides in its POST response. The change then reaches the browser
 * over Realtime, and `LiveRefresh` renders the route again `REFRESH_DEBOUNCE_MS` later
 * (src/lib/realtime/refresh-scheduler.ts). That swaps the metadata a second time, typically while
 * axe runs.
 *
 * Whether that second render happens depends on timing. Realtime delivers only changes made after
 * the channel's postgres_changes subscription streams, and that is later than the header's "Live"
 * state. An action taken in between is never heard, and no refresh follows. So `next()` first
 * waits for the subscription frame, which makes the refresh certain. Then it starts listening for
 * the next RSC GET of this path, prefetches excluded. The returned function resolves once that
 * response's body is fully in.
 *
 * Call `watchLiveRefresh` before the page opens, so the frame is not missed.
 */
export function watchLiveRefresh(page: Page, workspaceId: string): LiveRefreshWatch {
  const topicPrefix = `realtime:workspace-live:${workspaceId}:`;
  let streaming = false;
  page.on("websocket", (socket) => {
    if (!socket.url().includes("/realtime/v1/websocket")) return;
    socket.on("framereceived", ({ payload }) => {
      if (typeof payload !== "string") return;
      const frame = FrameSchema.safeParse(JSON.parse(payload));
      if (!frame.success || !frame.data[2].startsWith(topicPrefix)) return;
      if (frame.data[3] === "system" && StreamingSchema.safeParse(frame.data[4]).success) streaming = true;
    });
  });

  return {
    async next() {
      await expect.poll(() => streaming, { timeout: 15_000 }).toBe(true);
      // Room in the resource timing buffer (250 entries by default) for the entry awaited below.
      await page.evaluate(() => performance.clearResourceTimings());
      const path = new URL(page.url()).pathname;
      const refreshed = page.waitForResponse((response) => {
        const request = response.request();
        const headers = request.headers();
        return (
          request.method() === "GET" &&
          headers["rsc"] === "1" &&
          headers["next-router-prefetch"] === undefined &&
          headers["next-router-segment-prefetch"] === undefined &&
          new URL(response.url()).pathname === path
        );
      });
      // After the whole response is in, no render is pending, and expectNoAxeViolations waits out
      // the swap this one makes. The browser writes a fetch's resource timing entry once its body
      // has arrived. Playwright 1.64's `response.finished()` never settled for this streamed
      // response, although the page read the body to the end within 60 ms.
      return async () => {
        const url = (await refreshed).url();
        await page.waitForFunction((name) => performance.getEntriesByName(name).length > 0, url);
      };
    },
  };
}
