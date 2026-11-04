import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  AdapterTimeoutError,
  AuthRevokedError,
  InvalidResponseError,
  PermissionMissingError,
  ProviderUnavailableError,
  RateLimitedError,
  fetchJson,
} from "./errors";
import type { FetchLike } from "./types";

const now = new Date("2026-10-31T12:00:00Z");
const endpoint = "https://api.example.com/v1/usage";
const UsageSchema = z.object({ emails: z.int() });

function contextFor(fetch: FetchLike, timeoutMs = 1000) {
  return { fetch, now: () => now, timeoutMs };
}

function respondWith(body: BodyInit | null, init: ResponseInit): FetchLike {
  return async () => new Response(body, init);
}

describe("fetchJson", () => {
  it("returns the parsed body and passes a timeout signal on the happy path", async () => {
    let receivedSignal: AbortSignal | null | undefined;
    const fetch: FetchLike = async (_input, init) => {
      receivedSignal = init?.signal;
      return Response.json({ emails: 42 });
    };

    await expect(fetchJson(contextFor(fetch), endpoint, {}, UsageSchema)).resolves.toEqual({ emails: 42 });
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    {
      name: "429 with Retry-After seconds",
      response: { status: 429, headers: { "Retry-After": "30" } },
      errorClass: RateLimitedError,
      expected: { code: "rate_limited", retryAfterMs: 30_000, status: 429 },
    },
    {
      name: "429 with Retry-After HTTP-date",
      response: { status: 429, headers: { "Retry-After": "Sat, 31 Oct 2026 12:01:30 GMT" } },
      errorClass: RateLimitedError,
      expected: { code: "rate_limited", retryAfterMs: 90_000 },
    },
    {
      name: "429 with Retry-After date in the past",
      response: { status: 429, headers: { "Retry-After": "Sat, 31 Oct 2026 11:00:00 GMT" } },
      errorClass: RateLimitedError,
      expected: { code: "rate_limited", retryAfterMs: 0 },
    },
    {
      name: "429 without Retry-After",
      response: { status: 429 },
      errorClass: RateLimitedError,
      expected: { code: "rate_limited", retryAfterMs: undefined },
    },
    {
      name: "429 with unparseable Retry-After",
      response: { status: 429, headers: { "Retry-After": "soon" } },
      errorClass: RateLimitedError,
      expected: { code: "rate_limited", retryAfterMs: undefined },
    },
    {
      name: "403 with x-ratelimit-remaining 0 (GitHub rate limit)",
      response: { status: 403, headers: { "x-ratelimit-remaining": "0" } },
      errorClass: RateLimitedError,
      expected: { code: "rate_limited" },
    },
    {
      name: "401",
      response: { status: 401 },
      errorClass: AuthRevokedError,
      expected: { code: "auth_revoked", status: 401 },
    },
    {
      name: "403 without rate limit headers",
      response: { status: 403 },
      errorClass: PermissionMissingError,
      expected: { code: "permission_missing", missingScopes: [] },
    },
    {
      name: "503",
      response: { status: 503 },
      errorClass: ProviderUnavailableError,
      expected: { code: "provider_unavailable", status: 503 },
    },
    {
      name: "500",
      response: { status: 500 },
      errorClass: ProviderUnavailableError,
      expected: { code: "provider_unavailable", status: 500 },
    },
    {
      name: "404",
      response: { status: 404 },
      errorClass: InvalidResponseError,
      expected: { code: "invalid_response", status: 404 },
    },
  ])("maps $name to a typed error", async ({ response, errorClass, expected }) => {
    const promise = fetchJson(contextFor(respondWith(null, response)), endpoint, {}, UsageSchema);
    await expect(promise).rejects.toBeInstanceOf(errorClass);
    await expect(promise).rejects.toMatchObject({ ...expected, endpoint });
  });

  it("rejects a schema mismatch as invalid_response and keeps the zod cause", async () => {
    const fetch: FetchLike = async () => Response.json({ emails: "many" });
    const promise = fetchJson(contextFor(fetch), endpoint, {}, UsageSchema);
    await expect(promise).rejects.toBeInstanceOf(InvalidResponseError);
    await expect(promise).rejects.toHaveProperty("cause", expect.any(z.ZodError));
  });

  it("rejects a body that is not JSON as invalid_response", async () => {
    const fetch = respondWith("<html>maintenance</html>", { status: 200 });
    await expect(fetchJson(contextFor(fetch), endpoint, {}, UsageSchema)).rejects.toBeInstanceOf(
      InvalidResponseError,
    );
  });

  it("times out when the provider never answers within timeoutMs", async () => {
    const hang: FetchLike = (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw new Error("fetchJson must pass a signal");
      const { promise, reject } = Promise.withResolvers<Response>();
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      return promise;
    };

    const promise = fetchJson(contextFor(hang, 10), endpoint, {}, UsageSchema);
    await expect(promise).rejects.toBeInstanceOf(AdapterTimeoutError);
    await expect(promise).rejects.toMatchObject({ code: "timeout" });
  });

  it("maps a network failure before any response to provider_unavailable with its cause", async () => {
    const cause = new TypeError("fetch failed");
    const fetch: FetchLike = async () => {
      throw cause;
    };
    const promise = fetchJson(contextFor(fetch), endpoint, {}, UsageSchema);
    await expect(promise).rejects.toBeInstanceOf(ProviderUnavailableError);
    await expect(promise).rejects.toHaveProperty("cause", cause);
  });

  it("keeps a token in the query string out of the error message", async () => {
    const fetch = respondWith(null, { status: 401 });
    const promise = fetchJson(contextFor(fetch), `${endpoint}?access_token=tok_secret_value`, {}, UsageSchema);
    await expect(promise).rejects.toBeInstanceOf(AuthRevokedError);
    await expect(promise).rejects.not.toHaveProperty("message", expect.stringContaining("tok_secret_value"));
    await expect(promise).rejects.toMatchObject({ endpoint });
  });
});
