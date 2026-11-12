import { describe, expect, it } from "vitest";

import {
  badgeMarkdown,
  badgePath,
  cardAltText,
  cardPath,
  metricIdFromFile,
  metricShareLinks,
  shareText,
  shareToLinkedInUrl,
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
  it("writes the badge Markdown as an image linking to the given page", () => {
    expect(
      badgeMarkdown({
        badgeUrl: "https://devmacro.example.com/badge/p/github-stars.svg",
        linkUrl: "https://devmacro.example.com/docs/architecture/public-metrics#github-stars",
        label: "GitHub stars",
      }),
    ).toBe(
      "[![GitHub stars](https://devmacro.example.com/badge/p/github-stars.svg)](https://devmacro.example.com/docs/architecture/public-metrics#github-stars)",
    );
  });

  it("keeps brackets out of the Markdown alt text (boundary: a label that would end it early)", () => {
    expect(badgeMarkdown({ badgeUrl: "b", linkUrl: "f", label: "Stars [beta]" })).toBe("[![Stars beta](b)](f)");
  });

  it("describes the card with its value, provenance, sync time, and trend", () => {
    expect(cardAltText(stars, null)).toBe(
      "DevMacro card. GitHub stars: at least 1,200 stars. Verified by DevMacro, last synced 2026-11-05 12:00 GMT. With its trend over the last 30 days.",
    );
  });

  it("names the project in the card's alt text when the card shows it", () => {
    expect(cardAltText(stars, "Acme web")).toBe(
      "DevMacro card for Acme web. GitHub stars: at least 1,200 stars. Verified by DevMacro, last synced 2026-11-05 12:00 GMT. With its trend over the last 30 days.",
    );
  });

  it("describes a card with no number without a trend or a sync time", () => {
    expect(cardAltText({ ...stars, text: "Not connected", available: false, lastSyncedAt: null }, null)).toBe(
      "DevMacro card. GitHub stars: Not connected.",
    );
  });

  it("never calls simulated data verified in a post", () => {
    expect(shareText({ ...stars, simulated: true }, null)).toBe("GitHub stars: at least 1,200 stars. Simulated data, not verified.");
    expect(shareText(stars, null)).toBe("GitHub stars: at least 1,200 stars. Verified by DevMacro.");
  });

  it("names the project in a post when given one, with or without a number", () => {
    expect(shareText(stars, "Acme web")).toBe("GitHub stars for Acme web: at least 1,200 stars. Verified by DevMacro.");
    expect(shareText({ ...stars, text: "Not connected", available: false, lastSyncedAt: null }, "Acme web")).toBe(
      "GitHub stars for Acme web on DevMacro.",
    );
  });

  it("builds X's post intent with the text and link encoded, and no link when there is none", () => {
    const url = new URL(shareToXUrl("1,200 stars & more", "https://devmacro.example.com/card/p/github-stars.png"));
    expect(url.origin + url.pathname).toBe("https://x.com/intent/tweet");
    expect(url.searchParams.get("text")).toBe("1,200 stars & more");
    expect(url.searchParams.get("url")).toBe("https://devmacro.example.com/card/p/github-stars.png");
    expect(new URL(shareToXUrl("text only")).searchParams.has("url")).toBe(false);
  });

  it("builds LinkedIn's share page with the link encoded", () => {
    const url = new URL(shareToLinkedInUrl("https://devmacro.example.com/@k3j4h5g6f7/acme-web?a=1&b=2"));
    expect(url.origin + url.pathname).toBe("https://www.linkedin.com/sharing/share-offsite/");
    expect(url.searchParams.get("url")).toBe("https://devmacro.example.com/@k3j4h5g6f7/acme-web?a=1&b=2");
  });
});

describe("metricShareLinks", () => {
  const ORIGIN = "https://devmacro.example.com";
  const PAGE_URL = `${ORIGIN}/@k3j4h5g6f7/acme-web`;
  const CARD_URL = `${ORIGIN}/card/${PROJECT_ID}/github-stars.png`;
  const links = (projectPage: { path: string; projectName: string } | null) =>
    metricShareLinks({
      origin: ORIGIN,
      projectId: PROJECT_ID,
      metricId: "github-stars",
      formulaPath: "/docs/architecture/public-metrics#github-stars",
      metric: stars,
      projectPage,
    });

  it("points the post, X, LinkedIn, and the badge at the project page while it is public", () => {
    const on = links({ path: "/@k3j4h5g6f7/acme-web", projectName: "Acme web" });
    expect(on.link).toBe(PAGE_URL);
    const x = new URL(on.xIntentUrl);
    expect(x.searchParams.get("url")).toBe(PAGE_URL);
    expect(x.searchParams.get("text")).toBe("GitHub stars for Acme web: at least 1,200 stars. Verified by DevMacro.");
    expect(new URL(on.linkedInUrl).searchParams.get("url")).toBe(PAGE_URL);
    expect(on.badgeMarkdown).toBe(`[![GitHub stars](${ORIGIN}/badge/${PROJECT_ID}/github-stars.svg)](${PAGE_URL})`);
    expect(on.cardUrl).toBe(CARD_URL);
  });

  it("never links an unpublished page: with the page off, posts carry the card and the badge the formula (boundary)", () => {
    const off = links(null);
    expect(off.link).toBe(CARD_URL);
    const x = new URL(off.xIntentUrl);
    expect(x.searchParams.get("url")).toBe(CARD_URL);
    expect(x.searchParams.get("text")).toBe("GitHub stars: at least 1,200 stars. Verified by DevMacro.");
    expect(new URL(off.linkedInUrl).searchParams.get("url")).toBe(CARD_URL);
    expect(off.badgeMarkdown).toBe(
      `[![GitHub stars](${ORIGIN}/badge/${PROJECT_ID}/github-stars.svg)](${ORIGIN}/docs/architecture/public-metrics#github-stars)`,
    );
  });
});
