import { afterEach, describe, expect, it, vi } from "vitest";

import { emailEnv, isLoopbackUrl } from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

const EMAIL_VARIABLES = ["DEVMACRO_EMAIL_FROM", "DEVMACRO_RESEND_API_KEY", "DEVMACRO_RESEND_API_URL"] as const;

function stubEmailEnv(values: Partial<Record<(typeof EMAIL_VARIABLES)[number], string>>): void {
  for (const name of EMAIL_VARIABLES) vi.stubEnv(name, values[name] ?? "");
}

const FROM = "DevMacro <alerts@example.com>";

describe("emailEnv", () => {
  it("is off when neither the Resend key nor URL is set, even with a sender", () => {
    stubEmailEnv({ DEVMACRO_EMAIL_FROM: FROM });
    expect(emailEnv()).toBeNull();
  });

  it("sends to Resend itself when no URL is set", () => {
    stubEmailEnv({ DEVMACRO_EMAIL_FROM: FROM, DEVMACRO_RESEND_API_KEY: "test-key" });
    expect(emailEnv()).toEqual({ from: FROM, apiKey: "test-key", apiUrl: "https://api.resend.com" });
  });

  it.each([
    ["the local fake on 127.0.0.1", "http://127.0.0.1:55430", "http://127.0.0.1:55430"],
    ["localhost with a trailing slash", "http://localhost:55430/", "http://localhost:55430"],
    ["IPv6 loopback", "http://[::1]:55430", "http://[::1]:55430"],
    ["another https host", "https://mail-proxy.example.com", "https://mail-proxy.example.com"],
  ])("accepts %s as the URL, as an origin", (_title, url, origin) => {
    stubEmailEnv({ DEVMACRO_EMAIL_FROM: FROM, DEVMACRO_RESEND_API_KEY: "test-key", DEVMACRO_RESEND_API_URL: url });
    expect(emailEnv()?.apiUrl).toBe(origin);
  });

  it.each([
    ["plain http to another computer", "http://mail-proxy.example.com"],
    ["plain http to a private address", "http://10.0.0.5:55430"],
    ["plain http to a name that starts with 127.0.0.1", "http://127.0.0.1.nip.io"],
    ["another scheme", "ftp://127.0.0.1:55430"],
    ["a path", "https://api.resend.com/emails"],
    ["a query", "https://api.resend.com/?region=eu"],
    ["user info", "https://user:hunter2@api.resend.com"],
    ["text that is not a URL", "api.resend.com"],
  ])("refuses %s as the URL, without echoing it", (_title, url) => {
    stubEmailEnv({ DEVMACRO_EMAIL_FROM: FROM, DEVMACRO_RESEND_API_KEY: "test-key", DEVMACRO_RESEND_API_URL: url });
    expect(() => emailEnv()).toThrow(/DEVMACRO_RESEND_API_URL is invalid/);
    expect(() => emailEnv()).not.toThrow(url);
  });

  it("refuses a key without a sender", () => {
    stubEmailEnv({ DEVMACRO_RESEND_API_KEY: "test-key" });
    expect(() => emailEnv()).toThrow(/DEVMACRO_EMAIL_FROM is not set/);
  });

  it("refuses a URL without a key rather than turning email off", () => {
    stubEmailEnv({ DEVMACRO_EMAIL_FROM: FROM, DEVMACRO_RESEND_API_URL: "http://127.0.0.1:55430" });
    expect(() => emailEnv()).toThrow(/DEVMACRO_RESEND_API_KEY is not set/);
  });
});

describe("isLoopbackUrl", () => {
  it.each([
    ["the agent stack", "http://127.0.0.1:56421"],
    ["the default local stack", "http://127.0.0.1:54321"],
    ["localhost", "http://localhost:54321"],
    ["localhost in capitals", "http://LOCALHOST:54321"],
    ["another 127 address", "http://127.0.0.2:54321"],
    ["a short 127 address", "http://127.1:54321"],
    ["IPv6 loopback", "http://[::1]:54321"],
    ["https", "https://127.0.0.1:54321"],
  ])("accepts %s", (_title, url) => {
    expect(isLoopbackUrl(url)).toBe(true);
  });

  it.each([
    ["a hosted project", "https://abcdefghijklmnop.supabase.co"],
    ["a name that starts with localhost", "http://localhost.example.com"],
    ["a name that starts with 127.0.0.1", "http://127.0.0.1.nip.io"],
    ["user info naming localhost", "http://localhost@db.example.com"],
    ["user info naming 127.0.0.1", "http://127.0.0.1:54321@db.example.com"],
    ["128.0.0.1", "http://128.0.0.1"],
    ["IPv6 that is not loopback", "http://[::2]:54321"],
    ["a non-http scheme", "postgresql://127.0.0.1:54322/postgres"],
    ["text that is not a URL", "127.0.0.1:54321"],
    ["an empty string", ""],
  ])("refuses %s", (_title, url) => {
    expect(isLoopbackUrl(url)).toBe(false);
  });
});
