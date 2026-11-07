import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { startFakeResendApi, type FakeResendApi } from "./fake-resend-api";
import { EmailSendError, resendTransport, type EmailMessage } from "./send";

// The real `resend` package against the local fake of Resend's API: no network, no real key.
const API_KEY = "fake-test-key";
const FROM = "DevMacro <alerts@example.com>";

const message: EmailMessage = {
  to: "owner@example.com",
  subject: "Alert in Acme",
  text: "Text",
  html: "<p>Text</p>",
  headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  idempotencyKey: "email:u1:alert:a1",
};

let api: FakeResendApi;

beforeEach(async () => {
  api = await startFakeResendApi({ apiKey: API_KEY, port: 0 });
});

afterEach(async () => {
  await api.close();
});

function transport(overrides: { apiKey?: string; timeoutMs?: number } = {}) {
  return resendTransport({ from: FROM, apiKey: overrides.apiKey ?? API_KEY, apiUrl: api.url }, overrides.timeoutMs);
}

async function failure(promise: Promise<unknown>): Promise<EmailSendError> {
  const caught = await promise.then(
    () => null,
    (error: unknown) => error,
  );
  if (!(caught instanceof EmailSendError)) throw new Error(`expected an EmailSendError, got ${String(caught)}`);
  return caught;
}

describe("resendTransport", () => {
  it("sends the message with its idempotency key and returns Resend's id", async () => {
    const sent = await transport().send(message);

    const [email] = api.emails();
    expect(api.emails()).toHaveLength(1);
    expect(sent).toEqual({ messageId: email?.id });
    expect(email).toMatchObject({
      from: FROM,
      to: ["owner@example.com"],
      subject: "Alert in Acme",
      text: "Text",
      html: "<p>Text</p>",
      headers: { "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      idempotencyKey: "email:u1:alert:a1",
    });
  });

  it("sends a retried message once: the same idempotency key answers the first id", async () => {
    const first = await transport().send(message);
    const second = await transport().send(message);
    expect(second).toEqual(first);
    expect(api.emails()).toHaveLength(1);
  });

  it("sends a message without extra headers or an idempotency key", async () => {
    await transport().send({ to: "owner@example.com", subject: "Digest", text: "Text", html: "<p>Text</p>" });
    expect(api.emails()[0]).toMatchObject({ headers: {}, idempotencyKey: null });
  });

  it.each([
    [429, true],
    [500, true],
    [503, true],
    [400, false],
    [401, false],
    [403, false],
    [422, false],
  ])("classifies an answer of %i as retryable %s", async (status, retryable) => {
    api.failNext({ status });
    const error = await failure(transport().send(message));
    expect(error.retryable).toBe(retryable);
    expect(error.message).toMatch(new RegExp(`^Resend answered ${status} `));
    expect(api.emails()).toEqual([]);
  });

  it("refuses a wrong key permanently, without putting the key in the error", async () => {
    const error = await failure(transport({ apiKey: "wrong-key" }).send(message));
    expect(error.retryable).toBe(false);
    expect(error.message).toBe("Resend answered 403 invalid_api_key");
    expect(error.message).not.toContain("wrong-key");
  });

  it("retries a request that timed out, and says so for the log line", async () => {
    api.failNext({ hang: true });
    const error = await failure(transport({ timeoutMs: 200 }).send(message));
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("Resend request timed out after 200 ms");
  });

  it("retries a request that never reached Resend", async () => {
    const gone = await startFakeResendApi({ apiKey: API_KEY, port: 0 });
    await gone.close();
    const error = await failure(resendTransport({ from: FROM, apiKey: API_KEY, apiUrl: gone.url }).send(message));
    expect(error.retryable).toBe(true);
    expect(error.message).toBe("Resend request failed without an HTTP status");
  });

  it.each([
    ["the subject", { subject: "Hello\r\nBcc: x@example.com" }],
    ["the recipient", { to: "owner@example.com\nBcc: x@example.com" }],
    ["a header value", { headers: { "List-Unsubscribe": "<https://devmacro.test>\r\nBcc: x@example.com" } }],
  ])("refuses a line break in %s before sending anything", async (_title, change) => {
    const error = await failure(transport().send({ ...message, ...change }));
    expect(error.retryable).toBe(false);
    expect(api.emails()).toEqual([]);
  });
});
