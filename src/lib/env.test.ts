import { describe, expect, it } from "vitest";

import { isLoopbackUrl } from "./env";

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
