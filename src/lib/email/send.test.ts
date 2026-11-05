import { afterEach, describe, expect, it, vi } from "vitest";

import { emailEnv } from "@/lib/env";

import { EmailSendError, resendTransport, type EmailMessage } from "./send";

const message: EmailMessage = {
  to: "owner@example.com",
  subject: "Alert in Acme",
  text: "Text",
  html: "<p>Text</p>",
  headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  idempotencyKey: "email:u1:alert:a1",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function stubEmailEnv(values: Partial<Record<"DEVMACRO_EMAIL_FROM" | "DEVMACRO_SMTP_URL" | "DEVMACRO_RESEND_API_KEY", string>>): void {
  for (const name of ["DEVMACRO_EMAIL_FROM", "DEVMACRO_SMTP_URL", "DEVMACRO_RESEND_API_KEY"] as const) {
    vi.stubEnv(name, values[name] ?? "");
  }
}

describe("emailEnv: choosing the transport", () => {
  it("is off when neither transport is set", () => {
    stubEmailEnv({ DEVMACRO_EMAIL_FROM: "DevMacro <alerts@example.com>" });
    expect(emailEnv()).toBeNull();
  });

  it("uses SMTP for a local or self-hosted install", () => {
    stubEmailEnv({ DEVMACRO_EMAIL_FROM: "DevMacro <alerts@example.com>", DEVMACRO_SMTP_URL: "smtp://127.0.0.1:56425" });
    expect(emailEnv()).toEqual({ transport: "smtp", from: "DevMacro <alerts@example.com>", smtpUrl: "smtp://127.0.0.1:56425" });
  });

  it("uses Resend for the hosted instance", () => {
    stubEmailEnv({ DEVMACRO_EMAIL_FROM: "DevMacro <alerts@example.com>", DEVMACRO_RESEND_API_KEY: "test-key" });
    expect(emailEnv()).toEqual({ transport: "resend", from: "DevMacro <alerts@example.com>", resendApiKey: "test-key" });
  });

  it("refuses both transports at once, naming the variables only", () => {
    stubEmailEnv({ DEVMACRO_EMAIL_FROM: "a@example.com", DEVMACRO_SMTP_URL: "smtp://h:25", DEVMACRO_RESEND_API_KEY: "test-key" });
    expect(() => emailEnv()).toThrow(/set either DEVMACRO_SMTP_URL or DEVMACRO_RESEND_API_KEY, not both/);
  });

  it("refuses a transport without a sender", () => {
    stubEmailEnv({ DEVMACRO_SMTP_URL: "smtp://127.0.0.1:56425" });
    expect(() => emailEnv()).toThrow(/DEVMACRO_EMAIL_FROM is not set/);
  });

  it("refuses an SMTP URL with another scheme, without echoing its password", () => {
    stubEmailEnv({ DEVMACRO_EMAIL_FROM: "a@example.com", DEVMACRO_SMTP_URL: "https://user:hunter2@mail.example.com" });
    expect(() => emailEnv()).toThrow(/DEVMACRO_SMTP_URL is invalid/);
    expect(() => emailEnv()).not.toThrow(/hunter2/);
  });
});

describe("resendTransport", () => {
  function transport(reply: Response | Error) {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const fetchMock: typeof fetch = async (input, init) => {
      calls.push({ url: String(input), init });
      if (reply instanceof Error) throw reply;
      return reply;
    };
    return { calls, send: resendTransport("DevMacro <alerts@example.com>", "test-key", fetchMock) };
  }

  it("posts the documented body with the idempotency key and returns Resend's id", async () => {
    const { calls, send } = transport(new Response(JSON.stringify({ id: "email-1" }), { status: 200, headers: { "content-type": "application/json" } }));
    expect(await send.send(message)).toEqual({ messageId: "email-1" });
    const [call] = calls;
    expect(call?.url).toBe("https://api.resend.com/emails");
    const headers = new Headers(call?.init?.headers);
    expect(headers.get("Idempotency-Key")).toBe("email:u1:alert:a1");
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      from: "DevMacro <alerts@example.com>",
      to: ["owner@example.com"],
      subject: "Alert in Acme",
      text: "Text",
      html: "<p>Text</p>",
      headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
    });
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [401, false],
    [403, false],
    [422, false],
  ])("classifies %i as retryable %s", async (status, retryable) => {
    const { send } = transport(new Response("{}", { status }));
    const error = await send.send(message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EmailSendError);
    expect(error instanceof EmailSendError && error.retryable).toBe(retryable);
  });

  it("retries a request that never reached Resend", async () => {
    const { send } = transport(new TypeError("fetch failed"));
    const error = await send.send(message).catch((caught: unknown) => caught);
    expect(error instanceof EmailSendError && error.retryable).toBe(true);
  });

  it("refuses a header with a line break before sending anything", async () => {
    const { calls, send } = transport(new Response("{}", { status: 200 }));
    const error = await send.send({ ...message, subject: "Hello\r\nBcc: x@example.com" }).catch((caught: unknown) => caught);
    expect(error instanceof EmailSendError && !error.retryable).toBe(true);
    expect(calls).toEqual([]);
  });
});
