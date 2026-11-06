import { formatDateTime } from "@/lib/format";

import { isPublicMetricId, type PublicMetricId } from "./definitions";
import type { PublishedEngineMetric } from "./published";

/*
 * Share surfaces of a published metric (#149): the URLs of its badge and card, the text a share
 * carries, and the alt text of each image. Client-safe like `definitions.ts` and `display.ts` (no
 * data access, no adapter or Node module; `display.test.ts` walks the imports), so the share
 * dialog, the routes, and the public project page (#150) build the same URLs and words.
 *
 * Badges and cards are keyed by project id, like the public JSON route of #148: projects have no
 * slug, and the workspace slug is the private app URL, so neither belongs in a README (decision on
 * issue #149).
 */

/** Open Graph and X large image size, which the card always has. */
export const CARD_SIZE = { width: 1200, height: 630 } as const;

/** Days of history the card's trend line covers. */
export const CARD_TREND_DAYS = 30;

export function badgePath(projectId: string, metricId: PublicMetricId): string {
  return `/badge/${projectId}/${metricId}.svg`;
}

export function cardPath(projectId: string, metricId: PublicMetricId): string {
  return `/card/${projectId}/${metricId}.png`;
}

/**
 * The metric id in a route's last segment, `<metric id>.<extension>`, or null for anything else,
 * so `/badge/<project>/github-stars.png` and `/badge/<project>/github-stars` are not badges.
 */
export function metricIdFromFile(file: string, extension: "svg" | "png"): PublicMetricId | null {
  const suffix = `.${extension}`;
  if (!file.endsWith(suffix)) return null;
  const id = file.slice(0, -suffix.length);
  return isPublicMetricId(id) ? id : null;
}

/** What a share surface needs to know about one published value, already formatted. */
export type ShareableMetric = Readonly<{
  label: string;
  /** "1,204 stars", "at least 1,200 stars", or why there is no number ("Not enough history yet"). */
  text: string;
  available: boolean;
  provenance: "verified" | "estimated";
  simulated: boolean;
  /** Present when `available`. */
  lastSyncedAt: Date | null;
}>;

export function shareableMetric(metric: PublishedEngineMetric): ShareableMetric {
  const { value } = metric;
  return {
    label: metric.label,
    text: value.text,
    available: value.status === "available",
    provenance: metric.provenance,
    simulated: value.status === "available" && value.simulated,
    lastSyncedAt: value.status === "available" ? value.lastSyncedAt : null,
  };
}

/**
 * Who stands behind the number, in words. A simulated value (#131) is never called verified,
 * whatever the metric's provenance.
 */
export function provenanceSentence(metric: Pick<ShareableMetric, "provenance" | "simulated">): string {
  if (metric.simulated) return "Simulated data, not verified";
  return metric.provenance === "verified" ? "Verified by DevMacro" : "Estimated by DevMacro";
}

/** "GitHub stars: 1,204 stars. Verified by DevMacro, last synced 2026-11-05 12:00 GMT." */
export function metricSentence(metric: ShareableMetric): string {
  if (!metric.available || metric.lastSyncedAt === null) return `${metric.label}: ${metric.text}.`;
  return `${metric.label}: ${metric.text}. ${provenanceSentence(metric)}, last synced ${formatDateTime(metric.lastSyncedAt)}.`;
}

/** Alt text for the card image, for the share dialog and the public project page's preview. */
export function cardAltText(metric: ShareableMetric): string {
  const trend = metric.available ? ` With its trend over the last ${CARD_TREND_DAYS} days.` : "";
  return `DevMacro card. ${metricSentence(metric)}${trend}`;
}

/** Alt text for the badge image, also the badge's own `<title>`. */
export function badgeAltText(metric: ShareableMetric): string {
  return metricSentence(metric);
}

/** Markdown for a README: the badge, linking to how the metric is counted. */
export function badgeMarkdown(input: Readonly<{ badgeUrl: string; formulaUrl: string; label: string }>): string {
  // Brackets would end the alt text early; the label comes from definitions.ts, but stay safe.
  const alt = input.label.replace(/[[\]]/g, "");
  return `[![${alt}](${input.badgeUrl})](${input.formulaUrl})`;
}

/** The prefilled post for "Share to X": the value in words, then the link. */
export function shareText(metric: ShareableMetric): string {
  if (!metric.available) return `${metric.label} on DevMacro.`;
  return `${metric.label}: ${metric.text}. ${provenanceSentence(metric)}.`;
}

/**
 * X's post web intent (https://docs.x.com/x-for-websites/post-button/guides/web-intent): opens a
 * prefilled post the person still edits and sends themselves. Nothing is posted automatically.
 */
export function shareToXUrl(text: string, url?: string): string {
  const intent = new URL("https://x.com/intent/tweet");
  intent.searchParams.set("text", text);
  if (url !== undefined) intent.searchParams.set("url", url);
  return intent.href;
}
