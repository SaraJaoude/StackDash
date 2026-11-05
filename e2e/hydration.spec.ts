import type { Page } from "@playwright/test";

import { expect, ownerTest } from "./fixtures/auth";
import { createTestWorkspace, deleteTestWorkspace } from "./fixtures/db";

/*
 * A workspace page streams in twice (#211). Every page under /w/[workspace] renders its content in
 * a Suspense boundary that the server streams after the shell: the content arrives in a hidden
 * `<div id="S:n">` and React's inline `$RC` script queues it, and `$RV` later moves it into the
 * boundary. React reveals in batches (one frame, then at most every 300 ms), and the header's
 * boundaries can hydrate before the page's is revealed. If a client update reaches the page's
 * boundary in that window, React client-renders the page instead of hydrating it, and the server
 * copy stays in the document until `$RV` runs: Playwright's strict mode then finds every label and
 * text twice, and the user sees the page rendered twice.
 *
 * In CI the window is a few hundred milliseconds wide and the failure was random. These tests make
 * it deterministic: they hold the page's reveal until the live connection in the header is up
 * (the client update that hit the page before), then release it and check the page hydrated.
 */

type HeldReveals = Readonly<{
  /** Streamed boundaries inside #main that were held. */
  held: number;
  /** Streamed boundaries React replaced with a client render before their content was revealed. */
  clientRendered: number;
}>;

declare global {
  interface Window {
    releaseHeldReveals?: () => HeldReveals;
  }
}

/**
 * Wraps React's reveal function so the boundaries inside #main wait for `releaseHeldReveals()`.
 * The inline script assigns `$RV` as a global, which the setter captures; `$RC` reads it back
 * through the getter. Boundaries outside #main (the header) reveal as React schedules them.
 */
async function holdPageReveals(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Reveal = (batch: Element[]) => void;
    let reveal: Reveal | undefined;
    const held: Element[] = [];
    // React deletes a boundary's server markup, the `<template id="B:n">` included, when it gives
    // up hydrating the boundary and renders it on the client.
    let clientRendered = 0;
    const hold: Reveal = (batch) => {
      // React empties the batch after revealing it and schedules the next one when it refills.
      const pairs = batch.splice(0);
      const now: Element[] = [];
      for (let index = 0; index + 1 < pairs.length; index += 2) {
        const boundary = pairs[index];
        const segment = pairs[index + 1];
        if (boundary === undefined || segment === undefined) continue;
        if (!boundary.isConnected) clientRendered += 1;
        (boundary.closest("#main") === null ? now : held).push(boundary, segment);
      }
      if (now.length > 0) reveal?.(now);
    };
    Object.defineProperty(window, "$RV", {
      configurable: true,
      get: () => hold,
      set: (value: Reveal) => {
        reveal = value;
      },
    });
    window.releaseHeldReveals = () => {
      const pairs = held.splice(0);
      for (let index = 0; index < pairs.length; index += 2) {
        if (pairs[index]?.isConnected === false) clientRendered += 1;
      }
      // Counted first: React's reveal empties the array it is given.
      const reveals = { held: pairs.length / 2, clientRendered };
      if (pairs.length > 0) reveal?.(pairs);
      return reveals;
    };
  });
}

/** React reports a failed hydration as a recoverable error: a page error or a console error. */
function collectHydrationErrors(page: Page): () => readonly string[] {
  const errors: string[] = [];
  const keep = (text: string) => {
    if (/hydrat|Minified React error #(418|419|422|423|425)\b/i.test(text)) errors.push(text);
  };
  page.on("pageerror", (error) => keep(`${error.name}: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() === "error") keep(message.text());
  });
  return () => errors;
}

const PAGES = [
  { path: "settings", heading: "Settings" },
  { path: "alerts", heading: "Alerts" },
  { path: "connections", heading: "Connections" },
  { path: "dashboard", heading: "Dashboard" },
  { path: "timeline", heading: "Timeline" },
] as const;

ownerTest.describe("streamed workspace pages hydrate once (#211)", () => {
  for (const { path, heading } of PAGES) {
    ownerTest(`${path}: the live connection opening before the page is revealed does not render it twice`, async ({
      page,
    }) => {
      const workspace = await createTestWorkspace(`Hydration ${path}`);
      try {
        const hydrationErrors = collectHydrationErrors(page);
        await holdPageReveals(page);
        await page.goto(`/w/${workspace.slug}/${path}`);

        // The header hydrated and LiveRefresh's channel joined, which updates the arrival state
        // around the page; the page's content is still waiting in its hidden streamed segment.
        await expect(page.getByRole("button", { name: "Live updates", exact: true })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1, includeHidden: true })).toHaveCount(1);

        const reveals = await page.evaluate(() => {
          if (window.releaseHeldReveals === undefined) throw new Error("The reveal hold was not installed.");
          return window.releaseHeldReveals();
        });
        expect(reveals.held, "the page's content streamed in a boundary that was held").toBeGreaterThan(0);
        expect(reveals.clientRendered, "boundaries React client-rendered instead of hydrating").toBe(0);

        await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        await expect(page.getByRole("heading", { level: 1, includeHidden: true })).toHaveCount(1);
        expect(hydrationErrors()).toEqual([]);
      } finally {
        await deleteTestWorkspace(workspace);
      }
    });
  }
});
