import { describe, expect, it } from "vitest";

import {
  badgeMarkdown,
  badgePath,
  cardAltText,
  cardPath,
  metricIdFromFile,
  shareText,
  shareToXUrl,
  type ShareableMetric,
} from "./share";

const PROJECT_ID = "30000000-0000-4000-8000-000000000001";
const AT = new Date("2026-11-05T12:00:00Z");

const stars: ShareableMetric = {
  label: "GitHub stars",
  text: "at least 1,200 stars",
  available: true,
  provenance: "verified",
  simulated: false,
  lastSyncedAt: AT,
};

describe("badge and card paths", () => {
  it("key both by project id and metric id, with the image type as the extension", () => {
    expect(badgePath(PROJECT_ID, "github-stars")).toBe(`/badge/${PROJECT_ID}/github-stars.svg`);
    expect(cardPath(PROJECT_ID, "vercel-deployments-30d")).toBe(`/card/${PROJECT_ID}/vercel-deployments-30d.png`);
  });
});

describe("metricIdFromFile", () => {
  it.each([
    ["github-stars.svg", "svg", "github-stars"],
    ["stripe-payments-30d.png", "png", "stripe-payments-30d"],
    // Boundaries: the other surface's extension, no extension, a doubled one, an unknown id, a
    // money id, and an empty segment are all not a metric.
    ["github-stars.png", "svg", null],
    ["github-stars", "svg", null],
    ["github-stars.svg.svg", "svg", null],
    ["github-spend-actions.svg", "svg", null],
    ["GitHub-Stars.svg", "svg", null],
    [".svg", "svg", null],
    ["", "png", null],
  ] as const)("%s as %s is %s", (file, extension, expected) => {
    expect(metricIdFromFile(file, extension)).toBe(expected);
  });
});

describe("share text", () => {
  it("writes the badge Markdown as an image linking to the formula", () => {
    expect(
      badgeMarkdown({
        badgeUrl: "https://devmacro.example.com/badge/p/github-stars.svg",
        formulaUrl: "https://devmacro.example.com/docs/architecture/public-metrics#github-stars",
        label: "GitHub stars",
      }),
    ).toBe(
      "[![GitHub stars](https://devmacro.example.com/badge/p/github-stars.svg)](https://devmacro.example.com/docs/architecture/public-metrics#github-stars)",
    );
  });

  it("keeps brackets out of the Markdown alt text (boundary: a label that would end it early)", () => {
    expect(badgeMarkdown({ badgeUrl: "b", formulaUrl: "f", label: "Stars [beta]" })).toBe("[![Stars beta](b)](f)");
  });

  it("describes the card with its value, provenance, sync time, and trend", () => {
    expect(cardAltText(stars)).toBe(
      "DevMacro card. GitHub stars: at least 1,200 stars. Verified by DevMacro, last synced 2026-11-05 12:00 GMT. With its trend over the last 30 days.",
    );
  });

  it("describes a card with no number without a trend or a sync time", () => {
    expect(cardAltText({ ...stars, text: "Not connected", available: false, lastSyncedAt: null })).toBe(
      "DevMacro card. GitHub stars: Not connected.",
    );
  });

  it("never calls simulated data verified in a post", () => {
    expect(shareText({ ...stars, simulated: true })).toBe("GitHub stars: at least 1,200 stars. Simulated data, not verified.");
    expect(shareText(stars)).toBe("GitHub stars: at least 1,200 stars. Verified by DevMacro.");
  });

  it("builds X's post intent with the text and link encoded, and no link when there is none", () => {
    const url = new URL(shareToXUrl("1,200 stars & more", "https://devmacro.example.com/card/p/github-stars.png"));
    expect(url.origin + url.pathname).toBe("https://x.com/intent/tweet");
    expect(url.searchParams.get("text")).toBe("1,200 stars & more");
    expect(url.searchParams.get("url")).toBe("https://devmacro.example.com/card/p/github-stars.png");
    expect(new URL(shareToXUrl("text only")).searchParams.has("url")).toBe(false);
  });
});
