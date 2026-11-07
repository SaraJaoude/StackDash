import "server-only";

import { Resend } from "resend";

import { emailEnv, type EmailEnv } from "@/lib/env";

/*
 * Alert email (#152). Callers get the transport with `emailTransportFromEnv()` (null when email is
 * not set up) and send through `EmailTransport.send`. It sends through Resend's official `resend`
 * package, the only transport since #244:
 * https://github.com/eddiejaoude/DevMacro/issues/244
 *
 * What the package does, read from `resend@6.37.0` `dist/index.mjs` (2026-11-07):
 * - It never throws. `emails.send` returns `{ data, error }`; `error.statusCode` is the HTTP status,
 *   or null when no answer arrived (network failure, abort, timeout).
 * - The `baseUrl` option wins over `RESEND_BASE_URL` in the environment, so the validated
 *   DEVMACRO_RESEND_API_URL is always passed and that variable can never redirect mail.
 * - It writes `console.error("[Resend API Error]: ...")` only when RESEND_DEBUG=true. DevMacro
 *   never sets it: the failure is logged once, structured and redacted, by the caller
 *   (`notifications.email_failed` in src/lib/notifications/dispatch.ts) from the EmailSendError.
 */

export type EmailMessage = Readonly<{
  to: string;
  subject: string;
  text: string;
  html: string;
  /** Extra headers, such as List-Unsubscribe. Values must already be header safe (no CR or LF). */
  headers?: Readonly<Record<string, string>>;
  /** Same key, same message: Resend drops a repeat within 24 hours. */
  idempotencyKey?: string;
}>;

export type SentEmail = Readonly<{ messageId: string }>;

export interface EmailTransport {
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

const HEADER_UNSAFE = /[\r\n]/;

function assertHeaderSafe(message: EmailMessage): void {
  const values = [message.to, message.subject, ...Object.entries(message.headers ?? {}).flat()];
  if (values.some((value) => HEADER_UNSAFE.test(value))) {
    throw new EmailSendError("Email header contains a line break", { retryable: false });
  }
}

/**
 * Resend's send email endpoint: https://resend.com/docs/api-reference/emails/send-email (checked
 * 2026-11-07). 429, 5xx, and no answer at all are retryable, and the idempotency key makes the
 * retry a no-op if the first request did arrive; any other 4xx means the request itself is wrong
 * (bad key, unverified sender domain), so sending it again cannot help.
 */
export function resendTransport(env: EmailEnv, timeoutMs: number = EMAIL_TIMEOUT_MS): EmailTransport {
  const client = new Resend(env.apiKey, { baseUrl: env.apiUrl });
  return {
    async send(message) {
      assertHeaderSafe(message);
      const signal = AbortSignal.timeout(timeoutMs);
      const result = await client.emails.send(
        {
          from: env.from,
          to: [message.to],
          subject: message.subject,
          text: message.text,
          html: message.html,
          ...(message.headers === undefined ? {} : { headers: { ...message.headers } }),
        },
        { signal, ...(message.idempotencyKey === undefined ? {} : { idempotencyKey: message.idempotencyKey }) },
      );
      if (result.error === null) return { messageId: result.data.id };

      // Only the status and Resend's error code are kept: the message text is Resend's, and the
      // log line needs neither the address nor the key.
      const { statusCode, name } = result.error;
      if (typeof statusCode !== "number") {
        const reason = signal.aborted ? `timed out after ${timeoutMs} ms` : "failed without an HTTP status";
        throw new EmailSendError(`Resend request ${reason}`, { retryable: true });
      }
      throw new EmailSendError(`Resend answered ${statusCode} ${name}`, {
        retryable: statusCode === 429 || statusCode >= 500,
      });
    },
  };
}

/** The configured transport, or null when email is not set up on this instance. */
export function emailTransportFromEnv(): EmailTransport | null {
  const env = emailEnv();
  return env === null ? null : resendTransport(env);
}
