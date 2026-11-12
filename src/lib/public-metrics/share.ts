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
export function cardAltText(metric: ShareableMetric, projectName: string | null): string {
  const trend = metric.available ? ` With its trend over the last ${CARD_TREND_DAYS} days.` : "";
  const card = projectName === null ? "DevMacro card." : `DevMacro card for ${projectName}.`;
  return `${card} ${metricSentence(metric)}${trend}`;
}

/** Alt text for the badge image, also the badge's own `<title>`. */
export function badgeAltText(metric: ShareableMetric): string {
  return metricSentence(metric);
}

/** Markdown for a README: the badge, linking to the project page or to how the metric is counted. */
export function badgeMarkdown(input: Readonly<{ badgeUrl: string; linkUrl: string; label: string }>): string {
  // Brackets would end the alt text early; the label comes from definitions.ts, but stay safe.
  const alt = input.label.replace(/[[\]]/g, "");
  return `[![${alt}](${input.badgeUrl})](${input.linkUrl})`;
}

/** The prefilled post for "Share to X": the value in words, naming the project when its page is public. */
export function shareText(metric: ShareableMetric, projectName: string | null): string {
  const subject = projectName === null ? metric.label : `${metric.label} for ${projectName}`;
  if (!metric.available) return `${subject} on DevMacro.`;
  return `${subject}: ${metric.text}. ${provenanceSentence(metric)}.`;
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

/**
 * LinkedIn's share page for `url`, the address its Share plugin opens
 * (https://learn.microsoft.com/en-us/linkedin/consumer/integrations/self-serve/plugins/share-plugin).
 * A plain link, so no LinkedIn script loads; the person writes and sends the post themselves.
 */
export function shareToLinkedInUrl(url: string): string {
  const share = new URL("https://www.linkedin.com/sharing/share-offsite/");
  share.searchParams.set("url", url);
  return share.href;
}

/**
 * The project's public page as share surfaces see it (#255). Present only while the page answers,
 * so no link ever leads to a page that is off; the project name is public only through that page.
 */
export type ShareProjectPage = Readonly<{ path: string; projectName: string }>;

export type MetricShareLinks = Readonly<{
  badgeMarkdown: string;
  cardUrl: string;
  /** What a post links to: the project page while it is public, else the card itself. */
  link: string;
  xIntentUrl: string;
  linkedInUrl: string;
}>;

/** Every absolute link the share dialog of a published metric offers, on the public `origin`. */
export function metricShareLinks(
  input: Readonly<{
    origin: string;
    projectId: string;
    metricId: PublicMetricId;
    formulaPath: string;
    metric: ShareableMetric;
    projectPage: ShareProjectPage | null;
  }>,
): MetricShareLinks {
  const { origin, projectId, metricId, metric, projectPage } = input;
  const badgeUrl = new URL(badgePath(projectId, metricId), origin).href;
  const cardUrl = new URL(cardPath(projectId, metricId), origin).href;
  const pageUrl = projectPage === null ? null : new URL(projectPage.path, origin).href;
  const link = pageUrl ?? cardUrl;
  return {
    badgeMarkdown: badgeMarkdown({ badgeUrl, linkUrl: pageUrl ?? new URL(input.formulaPath, origin).href, label: metric.label }),
    cardUrl,
    link,
    xIntentUrl: shareToXUrl(shareText(metric, projectPage?.projectName ?? null), link),
    linkedInUrl: shareToLinkedInUrl(link),
  };
}
