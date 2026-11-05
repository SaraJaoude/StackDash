import "server-only";

import { createTransport } from "nodemailer";

import { emailEnv, type EmailEnv } from "@/lib/env";

/*
 * Provider-neutral email (#152). Callers build an `EmailMessage` and call `sendEmail`; the
 * transport comes from the environment (`emailEnv`): SMTP through nodemailer for local and
 * self-hosted installs, or Resend's HTTP API for the hosted instance. Nothing outside this file
 * knows which one is in use.
 *
 * Decision on #152 (nodemailer over a hand-written SMTP client):
 * https://github.com/eddiejaoude/DevMacro/issues/152#issuecomment-6646089035
 */

export type EmailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, such as List-Unsubscribe. Values must already be header safe (no CR or LF). */
  headers?: Readonly<Record<string, string>>;
  /**
   * Same key, same message: Resend drops a repeat within 24 hours. SMTP has no equivalent, so the
   * dispatcher records each delivery as well.
   */
  idempotencyKey?: string;
}>;

export type SentEmail = Readonly<{ messageId: string }>;

export interface EmailTransport {
  readonly name: EmailEnv["transport"];
  send(message: EmailMessage): Promise<SentEmail>;
}

/** A send that failed. `retryable` is false when sending the same message again cannot help. */
export class EmailSendError extends Error {
  override readonly name = "EmailSendError";
  readonly retryable: boolean;

  constructor(message: string, options: { retryable: boolean; cause?: unknown }) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.retryable = options.retryable;
  }
}

// Every outbound call has a timeout. The tick budget is 50 seconds and a dispatch may send a few
// messages, so one message gets at most this long.
export const EMAIL_TIMEOUT_MS = 15_000;

const RESEND_EMAILS_URL = "https://api.resend.com/emails";

const HEADER_UNSAFE = /[\r\n]/;

function assertHeaderSafe(message: EmailMessage): void {
  const values = [message.to, message.subject, ...Object.entries(message.headers ?? {}).flat()];
  if (values.some((value) => HEADER_UNSAFE.test(value))) {
    throw new EmailSendError("Email header contains a line break", { retryable: false });
  }
}

/**
 * SMTP through nodemailer. `smtps://` is TLS from the first byte; `smtp://` upgrades with STARTTLS
 * when the server offers it (nodemailer's default), and stays plain only for a server that does not,
 * such as the local mail catcher. https://nodemailer.com/smtp/
 */
export function smtpTransport(from: string, url: string): EmailTransport {
  const transporter = createTransport({
    url,
    connectionTimeout: EMAIL_TIMEOUT_MS,
    greetingTimeout: EMAIL_TIMEOUT_MS,
    socketTimeout: EMAIL_TIMEOUT_MS,
  });
  return {
    name: "smtp",
    async send(message) {
      assertHeaderSafe(message);
      try {
        const info = await transporter.sendMail({
          from,
          to: message.to,
          subject: message.subject,
          text: message.text,
          html: message.html,
          headers: { ...message.headers },
        });
        return { messageId: info.messageId };
      } catch (error) {
        // nodemailer reports a permanent rejection (5xx reply) with responseCode; everything else
        // (connection refused, timeout, 4xx) may pass on a later attempt.
        const code = typeof error === "object" && error !== null && "responseCode" in error ? error.responseCode : undefined;
        const permanent = typeof code === "number" && code >= 500 && code < 600;
        throw new EmailSendError("SMTP send failed", { retryable: !permanent, cause: error });
      }
    },
  };
}

/**
 * Resend's send email endpoint: https://resend.com/docs/api-reference/emails/send-email (checked
 * 2026-11-05). `Idempotency-Key` makes a retried request within 24 hours a no-op. 429 and 5xx are
 * retryable; other 4xx mean the request itself is wrong (bad key, unverified sender domain).
 */
export function resendTransport(from: string, apiKey: string, fetchImpl: typeof fetch = fetch): EmailTransport {
  return {
    name: "resend",
    async send(message) {
      assertHeaderSafe(message);
      let response: Response;
      try {
        response = await fetchImpl(RESEND_EMAILS_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(message.idempotencyKey === undefined ? {} : { "Idempotency-Key": message.idempotencyKey }),
          },
          body: JSON.stringify({
            from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            headers: message.headers ?? {},
          }),
          signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
        });
      } catch (error) {
        throw new EmailSendError("Resend request failed", { retryable: true, cause: error });
      }
      if (!response.ok) {
        // The body names the problem without echoing the key; only the status is kept.
        throw new EmailSendError(`Resend answered ${response.status}`, {
          retryable: response.status === 429 || response.status >= 500,
        });
      }
      // Resend accepted the message (2xx). Its id is only for the log line, so a body that is not
      // the documented `{ "id": ... }` leaves the id unknown rather than failing a sent message.
      let messageId = "unknown";
      try {
        const body: unknown = await response.json();
        if (typeof body === "object" && body !== null && "id" in body && typeof body.id === "string") messageId = body.id;
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
      }
      return { messageId };
    },
  };
}

/** The configured transport, or null when email is not set up on this instance. */
export function emailTransportFromEnv(): EmailTransport | null {
  const env = emailEnv();
  if (env === null) return null;
  return env.transport === "smtp" ? smtpTransport(env.from, env.smtpUrl) : resendTransport(env.from, env.resendApiKey);
}

/** Thrown by `sendEmail` when neither DEVMACRO_SMTP_URL nor DEVMACRO_RESEND_API_KEY is set. */
export class EmailNotConfiguredError extends Error {
  override readonly name = "EmailNotConfiguredError";
}

/** Sends one message with the configured transport (or the one passed, in tests). */
export async function sendEmail(
  message: EmailMessage,
  transport: EmailTransport | null = emailTransportFromEnv(),
): Promise<SentEmail> {
  if (transport === null) throw new EmailNotConfiguredError("Email is not set up on this instance.");
  return transport.send(message);
}
