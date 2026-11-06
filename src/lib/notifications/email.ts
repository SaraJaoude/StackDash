/**
 * A `Notice` as an email (#152): a plain text part and a simple HTML part with the same content,
 * plus the RFC 8058 one-click unsubscribe headers.
 *
 * RFC 8058 (https://www.rfc-editor.org/rfc/rfc8058, section 3.1): `List-Unsubscribe` holds one
 * HTTPS URI that identifies the recipient and the list by itself, `List-Unsubscribe-Post` is exactly
 * `List-Unsubscribe=One-Click`, and the POST to that URI must work without cookies and must not
 * redirect. The URI here is `/api/notifications/unsubscribe?token=...` (its route handler); the link
 * in the body goes to the `/unsubscribe` page, which asks for one click first so a mail scanner
 * that follows links cannot unsubscribe anyone.
 */
import type { EmailMessage } from "@/lib/email/send";

import type { Notice } from "./notice";
import { severityLabel } from "./notice";

export type EmailFooter = Readonly<{
  /** Why this person gets this message, in one sentence. */
  reason: string;
  preferencesUrl: string;
  /** The page with the unsubscribe button. */
  unsubscribePageUrl: string;
  /** The RFC 8058 one-click endpoint. */
  oneClickUrl: string;
}>;

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

const SEVERITY_COLOR = { critical: "#b42318", warning: "#b54708", info: "#344054" } as const;

function textPart(notice: Notice, footer: EmailFooter): string {
  const lines: string[] = [notice.intro, ""];
  for (const section of notice.sections) {
    lines.push(section.heading, "");
    for (const item of section.items) {
      lines.push(item.severity === "info" ? item.title : `${item.title} (${severityLabel(item.severity)})`, item.body);
      for (const field of item.fields) lines.push(`${field.name}: ${field.value}`);
      lines.push("");
    }
  }
  for (const link of notice.links) lines.push(`${link.label}: ${link.url}`);
  lines.push("", footer.reason, `Change your alert emails: ${footer.preferencesUrl}`, `Unsubscribe: ${footer.unsubscribePageUrl}`);
  return lines.join("\n");
}

function htmlPart(notice: Notice, footer: EmailFooter): string {
  const sections = notice.sections
    .map((section) => {
      const items = section.items
        .map((item) => {
          const fields = item.fields
            .map((field) => `<li><strong>${escapeHtml(field.name)}:</strong> ${escapeHtml(field.value)}</li>`)
            .join("");
          const badge =
            item.severity === "info"
              ? ""
              : ` <span style="color:${SEVERITY_COLOR[item.severity]};font-weight:600">(${severityLabel(item.severity)})</span>`;
          return (
            `<div style="margin:0 0 16px">` +
            `<p style="margin:0;font-weight:600">${escapeHtml(item.title)}${badge}</p>` +
            `<p style="margin:4px 0 0">${escapeHtml(item.body)}</p>` +
            (fields === "" ? "" : `<ul style="margin:8px 0 0;padding-left:20px">${fields}</ul>`) +
            `</div>`
          );
        })
        .join("");
      return `<h2 style="font-size:16px;margin:24px 0 12px">${escapeHtml(section.heading)}</h2>${items}`;
    })
    .join("");
  const links = notice.links
    .map((link) => `<a href="${escapeHtml(link.url)}" style="color:#1d4ed8">${escapeHtml(link.label)}</a>`)
    .join(" &middot; ");
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(notice.subject)}</title></head>` +
    `<body style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.5;color:#101828;margin:0;padding:24px">` +
    `<div style="max-width:600px">` +
    `<h1 style="font-size:20px;margin:0 0 8px">${escapeHtml(notice.subject)}</h1>` +
    `<p style="margin:0">${escapeHtml(notice.intro)}</p>` +
    sections +
    `<p style="margin:24px 0 0">${links}</p>` +
    `<hr style="border:none;border-top:1px solid #d0d5dd;margin:24px 0">` +
    `<p style="margin:0;color:#475467;font-size:12px">${escapeHtml(footer.reason)} ` +
    `<a href="${escapeHtml(footer.preferencesUrl)}" style="color:#475467">Change your alert emails</a> or ` +
    `<a href="${escapeHtml(footer.unsubscribePageUrl)}" style="color:#475467">unsubscribe</a>.</p>` +
    `</div></body></html>`
  );
}

/** The message for one recipient, minus the address and the idempotency key the caller adds. */
export function renderNoticeEmail(notice: Notice, footer: EmailFooter): Omit<EmailMessage, "to" | "idempotencyKey"> {
  return {
    // Names come from people (workspace, project, connection); a line break would split the header.
    subject: notice.subject.replace(/\s+/g, " "),
    text: textPart(notice, footer),
    html: htmlPart(notice, footer),
    headers: {
      "List-Unsubscribe": `<${footer.oneClickUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
  };
}
