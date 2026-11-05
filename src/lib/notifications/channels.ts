/**
 * Discord, Slack, and generic webhook channels (#153): URL rules, the message each platform gets,
 * and the HTTP post with retries. Pure apart from the injected `fetch` and `sleep`, so formatting,
 * retry, and failure classification are unit tested with a mocked transport.
 *
 * Sources (checked 2026-11-05):
 * - Discord execute webhook: https://docs.discord.com/developers/resources/webhook#execute-webhook
 *   (content up to 2000 characters, up to 10 embeds; `allowed_mentions` with an empty `parse` so a
 *   name can never ping @everyone). Embed limits: title 256, description 4096, 25 fields, field
 *   name 256 and value 1024, 6000 characters in total.
 * - Discord rate limits: https://docs.discord.com/developers/topics/rate-limits (429 with a
 *   `Retry-After` header and a JSON `retry_after` in seconds).
 * - Slack incoming webhooks: https://docs.slack.dev/messaging/sending-messages-using-incoming-webhooks
 *   (`text` fallback plus Block Kit `blocks`; errors such as `no_service` 404, `channel_is_archived`
 *   410, `action_prohibited` 403 mean the webhook cannot be used again). Slack allows about one
 *   message per second per webhook: https://docs.slack.dev/apis/web-api/rate-limits
 * - Generic webhooks are signed as Standard Webhooks describe:
 *   https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 *   (`webhook-id`, `webhook-timestamp`, and `webhook-signature: v1,<base64 HMAC-SHA256 of
 *   "id.timestamp.body">` with the base64 key after the `whsec_` prefix).
 */
import { createHmac, randomBytes } from "node:crypto";

import type { DestinationKind } from "./model";
import type { Notice, NoticeSeverity } from "./notice";
import { severityLabel } from "./notice";

// ── URLs ────────────────────────────────────────────────────────────────────────

const DISCORD_HOSTS: Record<string, true> = {
  "discord.com": true,
  "discordapp.com": true,
  "ptb.discord.com": true,
  "canary.discord.com": true,
};
const DISCORD_PATH = /^\/api(?:\/v\d+)?\/webhooks\/\d+\/[A-Za-z0-9_-]+\/?$/;
const SLACK_HOST = "hooks.slack.com";
const SLACK_PATH = /^\/services\/[A-Z0-9]+\/[A-Z0-9]+\/[A-Za-z0-9]+\/?$/;
const MAX_URL_LENGTH = 2000;

const LOOPBACK_HOSTS: Record<string, true> = { localhost: true, "127.0.0.1": true, "[::1]": true };

/**
 * Hosts a generic webhook may not reach on a production instance unless
 * DEVMACRO_ALLOW_PRIVATE_WEBHOOKS=1: loopback, private, link-local (cloud metadata), and unique
 * local addresses written as literals. A self-hosted instance that routes to its own network turns
 * the flag on. This does not resolve names, so it narrows server side request forgery rather than
 * closing it; hosted keeps the flag off.
 */
function isPrivateHost(hostname: string): boolean {
  if (LOOPBACK_HOSTS[hostname] === true || hostname.endsWith(".localhost") || hostname.endsWith(".internal")) return true;
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4 !== null) {
    const [a, b] = [Number(ipv4[1]), Number(ipv4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (hostname.startsWith("[")) {
    const ipv6 = hostname.slice(1, -1).toLowerCase();
    return ipv6 === "::" || ipv6 === "::1" || ipv6.startsWith("fc") || ipv6.startsWith("fd") || ipv6.startsWith("fe80") || ipv6.startsWith("::ffff:");
  }
  return false;
}

export type UrlPolicy = Readonly<{ allowPrivate: boolean }>;

/** Plain http, and private hosts, are for local runs and self-hosted networks only. */
export function urlPolicyFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): UrlPolicy {
  return { allowPrivate: env.NODE_ENV !== "production" || env.DEVMACRO_ALLOW_PRIVATE_WEBHOOKS === "1" };
}

export type ParsedChannelUrl = { ok: true; url: string; host: string } | { ok: false; message: string };

/** Checks a pasted URL for the chosen kind. Messages never repeat the URL, which is a secret. */
export function parseChannelUrl(kind: DestinationKind, raw: string, policy: UrlPolicy): ParsedChannelUrl {
  const trimmed = raw.trim();
  if (trimmed === "") return { ok: false, message: "Paste the webhook URL." };
  if (trimmed.length > MAX_URL_LENGTH) return { ok: false, message: "This URL is too long to be a webhook URL." };
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return { ok: false, message: "This is not a valid URL. Copy the whole webhook URL and paste it again." };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "Remove the user name and password from the URL." };
  }
  switch (kind) {
    case "discord":
      if (url.protocol !== "https:" || DISCORD_HOSTS[url.hostname] !== true || !DISCORD_PATH.test(url.pathname)) {
        return {
          ok: false,
          message: "This is not a Discord webhook URL. In Discord, open the channel settings, Integrations, Webhooks, and copy the webhook URL.",
        };
      }
      break;
    case "slack":
      if (url.protocol !== "https:" || url.hostname !== SLACK_HOST || !SLACK_PATH.test(url.pathname)) {
        return {
          ok: false,
          message: "This is not a Slack incoming webhook URL. It starts with https://hooks.slack.com/services/.",
        };
      }
      break;
    case "webhook": {
      const local = policy.allowPrivate && url.protocol === "http:";
      if (url.protocol !== "https:" && !local) return { ok: false, message: "Use an https URL." };
      if (!policy.allowPrivate && isPrivateHost(url.hostname)) {
        return { ok: false, message: "This URL points to a private network address, which this instance does not allow." };
      }
      break;
    }
  }
  url.hash = "";
  return { ok: true, url: url.href, host: url.hostname };
}

// ── Platform payloads ───────────────────────────────────────────────────────────

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}\u2026`;
}

const DISCORD_COLOR: Record<NoticeSeverity, number> = { critical: 0xb42318, warning: 0xdc6803, info: 0x475467 };
const DISCORD_MAX_EMBEDS = 10;
// Below Discord's 6000 total so the clipped titles and fields always fit.
const DISCORD_DESCRIPTION_MAX = 1000;

export function discordPayload(notice: Notice): Record<string, unknown> {
  const items = notice.sections.flatMap((section) => section.items);
  const shown = items.slice(0, DISCORD_MAX_EMBEDS - 1);
  const rest = items.length - shown.length;
  const links = notice.links.map((link) => `[${link.label}](${link.url})`).join(" | ");
  const embeds = shown.map((item) => ({
    title: clip(item.title, 256),
    description: clip(item.body, DISCORD_DESCRIPTION_MAX),
    color: DISCORD_COLOR[item.severity],
    fields: item.fields.slice(0, 8).map((field) => ({ name: clip(field.name, 256), value: clip(field.value, 256), inline: true })),
  }));
  embeds.push({
    title: clip(notice.subject, 256),
    description: clip([notice.intro, rest > 0 ? `${rest} more in DevMacro.` : "", links].filter((part) => part !== "").join("\n\n"), DISCORD_DESCRIPTION_MAX),
    color: DISCORD_COLOR.info,
    fields: [],
  });
  return {
    content: clip(notice.subject, 2000),
    embeds,
    allowed_mentions: { parse: [] },
  };
}

/** Slack mrkdwn needs &, <, and > escaped: https://docs.slack.dev/messaging/formatting-message-text */
function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SLACK_MAX_ITEMS = 20;

export function slackPayload(notice: Notice): Record<string, unknown> {
  const blocks: Record<string, unknown>[] = [
    { type: "header", text: { type: "plain_text", text: clip(notice.subject, 150) } },
    { type: "section", text: { type: "mrkdwn", text: clip(slackEscape(notice.intro), 3000) } },
  ];
  let shown = 0;
  let hidden = 0;
  for (const section of notice.sections) {
    blocks.push({ type: "divider" });
    blocks.push({ type: "section", text: { type: "mrkdwn", text: `*${clip(slackEscape(section.heading), 200)}*` } });
    for (const item of section.items) {
      if (shown >= SLACK_MAX_ITEMS) {
        hidden += 1;
        continue;
      }
      shown += 1;
      const label = item.severity === "info" ? "" : ` (${severityLabel(item.severity)})`;
      blocks.push({
        type: "section",
        text: { type: "mrkdwn", text: clip(`*${slackEscape(item.title)}*${label}\n${slackEscape(item.body)}`, 3000) },
        ...(item.fields.length === 0
          ? {}
          : {
              fields: item.fields
                .slice(0, 10)
                .map((field) => ({ type: "mrkdwn", text: clip(`*${slackEscape(field.name)}*\n${slackEscape(field.value)}`, 2000) })),
            }),
      });
    }
  }
  const links = notice.links.map((link) => `<${link.url}|${slackEscape(link.label)}>`);
  if (hidden > 0) links.unshift(`${hidden} more in DevMacro.`);
  blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: clip(links.join(" | "), 3000) }] });
  // The fallback `text` is mrkdwn too (it is what notifications show), so it is escaped as well.
  return { text: clip(slackEscape(notice.subject), 3000), blocks };
}

const WEBHOOK_TYPES = { alerts: "devmacro.alerts", digest: "devmacro.digest", test: "devmacro.test" } as const;

/** The generic webhook body: the same sections, plus the alerts as data for whoever receives it. */
export function webhookPayload(notice: Notice, sentAt: Date): Record<string, unknown> {
  return {
    type: WEBHOOK_TYPES[notice.type],
    sent_at: sentAt.toISOString(),
    workspace: notice.workspaceName,
    subject: notice.subject,
    intro: notice.intro,
    sections: notice.sections,
    links: notice.links,
    alerts: notice.alerts.map((alert) => ({
      id: alert.id,
      rule_id: alert.ruleId,
      title: alert.title,
      message: alert.message,
      severity: alert.severity,
      threshold: alert.thresholdLabel,
      is_estimated: alert.isEstimated,
      provider: alert.providerName,
      project: alert.projectName,
      resets_at: alert.resetsAt,
      triggered_at: alert.triggeredAt,
    })),
  };
}

// ── Signing ─────────────────────────────────────────────────────────────────────

const SECRET_PREFIX = "whsec_";

/** A new Standard Webhooks signing secret: `whsec_` and 32 random bytes in base64. */
export function newSigningSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64")}`;
}

/** The `webhook-signature` header value for one delivery. */
export function signWebhook(secret: string, messageId: string, timestampSeconds: number, body: string): string {
  const key = Buffer.from(secret.startsWith(SECRET_PREFIX) ? secret.slice(SECRET_PREFIX.length) : secret, "base64");
  const signature = createHmac("sha256", key).update(`${messageId}.${timestampSeconds}.${body}`, "utf8").digest("base64");
  return `v1,${signature}`;
}

// ── Posting ─────────────────────────────────────────────────────────────────────

export type ChannelSecret = Readonly<{ url: string; signingSecret?: string }>;

export type PostOutcome =
  | Readonly<{ ok: true; attempts: number }>
  | Readonly<{ ok: false; attempts: number; retryable: boolean; code: string }>;

export type PostDeps = Readonly<{
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  random: () => number;
  now: () => Date;
  newId: () => string;
}>;

export const POST_TIMEOUT_MS = 10_000;
export const POST_MAX_ATTEMPTS = 3;
// A wait longer than this is left to the next job attempt rather than held inside a tick.
export const POST_MAX_WAIT_MS = 10_000;
const POST_BASE_DELAY_MS = 1_000;

/** Seconds from `Retry-After` (or Discord's JSON `retry_after`), in milliseconds; null when absent. */
async function retryAfterMs(response: Response): Promise<number | null> {
  const header = response.headers.get("retry-after");
  if (header !== null && /^\d+(\.\d+)?$/.test(header.trim())) return Math.ceil(Number(header) * 1000);
  if ((response.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const body: unknown = await response.json();
      if (typeof body === "object" && body !== null && "retry_after" in body && typeof body.retry_after === "number") {
        return Math.ceil(body.retry_after * 1000);
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
  }
  return null;
}

/** The request for one channel: Discord and Slack take their JSON, a webhook is signed. */
export function channelRequest(
  kind: DestinationKind,
  secret: ChannelSecret,
  notice: Notice,
  deps: Pick<PostDeps, "now" | "newId">,
): { url: string; body: string; headers: Record<string, string> } {
  const now = deps.now();
  const payload = kind === "discord" ? discordPayload(notice) : kind === "slack" ? slackPayload(notice) : webhookPayload(notice, now);
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json", "User-Agent": "DevMacro" };
  if (kind === "webhook" && secret.signingSecret !== undefined) {
    const id = `msg_${deps.newId()}`;
    const timestamp = Math.floor(now.getTime() / 1000);
    headers["webhook-id"] = id;
    headers["webhook-timestamp"] = String(timestamp);
    headers["webhook-signature"] = signWebhook(secret.signingSecret, id, timestamp, body);
  }
  return { url: secret.url, body, headers };
}

/**
 * Posts with up to POST_MAX_ATTEMPTS tries. 429 waits for Retry-After (when short enough) and 5xx,
 * timeouts, and network errors back off with jitter; both are retryable later when the tries run
 * out. Any other 4xx, and any redirect (never followed, so a webhook cannot bounce the request to
 * another host), is not: the URL itself is wrong now.
 */
export async function postToChannel(
  request: { url: string; body: string; headers: Record<string, string> },
  deps: Pick<PostDeps, "fetch" | "sleep" | "random">,
): Promise<PostOutcome> {
  let last: { retryable: boolean; code: string } = { retryable: true, code: "network_error" };
  for (let attempt = 1; attempt <= POST_MAX_ATTEMPTS; attempt += 1) {
    let response: Response;
    try {
      response = await deps.fetch(request.url, {
        method: "POST",
        headers: request.headers,
        body: request.body,
        redirect: "manual",
        signal: AbortSignal.timeout(POST_TIMEOUT_MS),
      });
    } catch (error) {
      const timedOut = error instanceof DOMException && error.name === "TimeoutError";
      last = { retryable: true, code: timedOut ? "timeout" : "network_error" };
      if (attempt < POST_MAX_ATTEMPTS) await deps.sleep(POST_BASE_DELAY_MS * 2 ** (attempt - 1) * (0.5 + deps.random() / 2));
      continue;
    }
    if (response.status >= 200 && response.status < 300) return { ok: true, attempts: attempt };
    if (response.status === 429) {
      const wait = (await retryAfterMs(response)) ?? POST_BASE_DELAY_MS * 2 ** (attempt - 1);
      last = { retryable: true, code: "rate_limited" };
      if (wait > POST_MAX_WAIT_MS) return { ok: false, attempts: attempt, ...last };
      if (attempt < POST_MAX_ATTEMPTS) await deps.sleep(wait);
      continue;
    }
    if (response.status >= 500) {
      last = { retryable: true, code: `http_${response.status}` };
      if (attempt < POST_MAX_ATTEMPTS) await deps.sleep(POST_BASE_DELAY_MS * 2 ** (attempt - 1) * (0.5 + deps.random() / 2));
      continue;
    }
    return { ok: false, attempts: attempt, retryable: false, code: `http_${response.status}` };
  }
  return { ok: false, attempts: POST_MAX_ATTEMPTS, ...last };
}

/** Plain words for a failure code, for the timeline and the channel's status line. */
export function describeFailure(code: string): string {
  if (code === "rate_limited") return "The service kept asking DevMacro to slow down";
  if (code === "timeout") return "The service did not answer in time";
  if (code === "network_error") return "DevMacro could not reach the service";
  if (code === "http_404" || code === "http_410") return "The webhook no longer exists, or its channel was archived";
  if (code === "http_401" || code === "http_403") return "The service refused the webhook";
  if (/^http_3\d\d$/.test(code)) return "The webhook URL redirects somewhere else, which DevMacro does not follow";
  if (/^http_5\d\d$/.test(code)) return "The service had an error";
  return "The service rejected the message";
}
