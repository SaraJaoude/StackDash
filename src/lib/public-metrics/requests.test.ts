import { describe, expect, it } from "vitest";

import { clientIp, hashClientIp, PUBLIC_REQUESTS_PER_MINUTE, rateLimitDecision, secondsUntilNextMinute } from "./requests";

const KEY = Buffer.alloc(32, 7);

describe("clientIp", () => {
  it.each([
    ["x-real-ip first", { "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" }, "203.0.113.7"],
    ["the first x-forwarded-for entry, trimmed", { "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" }, "198.51.100.1"],
    ["IPv6 as given", { "x-real-ip": "2001:db8::1" }, "2001:db8::1"],
    // Boundaries: empty and blank values are not an address.
    ["x-forwarded-for when x-real-ip is blank", { "x-real-ip": "  ", "x-forwarded-for": "198.51.100.1" }, "198.51.100.1"],
    ["null when neither is present", {}, null],
    ["null when x-forwarded-for is empty", { "x-forwarded-for": "" }, null],
  ])("reads %s", (_title, headers, expected) => {
    expect(clientIp(new Headers(headers))).toBe(expected);
  });
});

describe("hashClientIp", () => {
  it("is the lowercase 64 character hex digest the counter table accepts, never the address", () => {
    const hash = hashClientIp("203.0.113.7", KEY);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain("203");
  });

  it("is stable for one address and key, and differs across addresses and keys", () => {
    expect(hashClientIp("203.0.113.7", KEY)).toBe(hashClientIp("203.0.113.7", KEY));
    expect(hashClientIp("203.0.113.8", KEY)).not.toBe(hashClientIp("203.0.113.7", KEY));
    expect(hashClientIp("203.0.113.7", Buffer.alloc(32, 8))).not.toBe(hashClientIp("203.0.113.7", KEY));
  });

  it("counts one IPv6 address once whatever its letter case (boundary: case)", () => {
    expect(hashClientIp("2001:DB8::1", KEY)).toBe(hashClientIp("2001:db8::1", KEY));
  });
});

describe("rateLimitDecision", () => {
  const at = new Date("2026-11-05T12:00:45.000Z");

  it("allows up to and including the limit", () => {
    expect(rateLimitDecision(1, at)).toEqual({ allowed: true });
    expect(rateLimitDecision(PUBLIC_REQUESTS_PER_MINUTE, at)).toEqual({ allowed: true });
  });

  it("refuses the request after the limit until the next minute (boundary: limit plus one)", () => {
    expect(rateLimitDecision(PUBLIC_REQUESTS_PER_MINUTE + 1, at)).toEqual({ allowed: false, retryAfterSeconds: 15 });
  });
});

describe("secondsUntilNextMinute", () => {
  it.each([
    ["2026-11-05T12:00:00.000Z", 60],
    ["2026-11-05T12:00:30.500Z", 30],
    ["2026-11-05T12:00:59.999Z", 1],
  ])("at %s is %d", (at, expected) => {
    expect(secondsUntilNextMinute(new Date(at))).toBe(expected);
  });
});
