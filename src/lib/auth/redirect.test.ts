import { describe, expect, it } from "vitest";

import { DEFAULT_NEXT_PATH, isAppPath, safeNextPath, signInErrorUrl } from "./redirect";

describe("safeNextPath", () => {
  it.each([
    ["/app", "/app"],
    ["/app/", "/app/"],
    ["/w/k3j9x2m4pq/dashboard", "/w/k3j9x2m4pq/dashboard"],
    ["/w/k3j9x2m4pq/timeline?cursor=abc&limit=50", "/w/k3j9x2m4pq/timeline?cursor=abc&limit=50"],
    ["/w/k3j9x2m4pq/alerts#rule-1", "/w/k3j9x2m4pq/alerts#rule-1"],
    ["/w/k3j9x2m4pq/connections/../settings", "/w/k3j9x2m4pq/settings"],
    ["/app?next=https://evil.example", "/app?next=https://evil.example"],
  ])("keeps the app path %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ["not a string", 42],
    ["undefined", undefined],
    ["null", null],
    ["an array", ["/app"]],
    ["empty", ""],
    ["the landing page", "/"],
    ["a non-app path", "/sign-in"],
    ["a lookalike prefix", "/application"],
    ["a bare workspace prefix", "/w"],
    ["a relative path without a slash", "w/abc"],
    ["protocol relative", "//evil.example/w/abc"],
    ["protocol relative with a backslash", "/\\evil.example"],
    ["a backslash later on", "/w/abc\\..\\..\\evil"],
    ["an absolute https URL", "https://evil.example/w/abc"],
    ["a javascript URL", "javascript:alert(1)"],
    ["a data URL", "data:text/html,<script>alert(1)</script>"],
    ["a tab that browsers strip", "/\t/evil.example"],
    ["a newline", "/w/abc\n/evil"],
    ["an encoded leading double slash", "/%2F%2Fevil.example"],
    ["an encoded backslash", "/%5Cevil.example"],
    ["an encoded tab", "/%09/evil.example"],
    ["dot segments escaping the app", "/w/../../evil"],
    ["encoded dot segments escaping the app", "/w/%2e%2e/evil"],
    ["a malformed escape", "/w/%E0%A4%A"],
    ["overlong", `/w/${"a".repeat(510)}`],
  ])("falls back to /app for %s", (_label, input) => {
    expect(safeNextPath(input)).toBe(DEFAULT_NEXT_PATH);
  });

  it("accepts a path at exactly the length limit", () => {
    const input = `/w/${"a".repeat(509)}`;
    expect(input).toHaveLength(512);
    expect(safeNextPath(input)).toBe(input);
  });
});

describe("isAppPath", () => {
  it.each([
    ["/app", true],
    ["/app/settings", true],
    ["/account", true],
    ["/account/deleted", false],
    ["/accounts", false],
    ["/", false],
    ["/apple", false],
    ["/sign-in", false],
    ["/auth/callback", false],
  ])("%j -> %j", (pathname, expected) => {
    expect(isAppPath(pathname)).toBe(expected);
  });
});

describe("signInErrorUrl", () => {
  it("points at /sign-in on the request's origin with the code, the reference, and next", () => {
    const url = signInErrorUrl("http://localhost:3000/auth/confirm?token_hash=abc", "link_failed", "/w/k3j9x2m4pq/dashboard", "REF-1234");
    expect(url.toString()).toBe("http://localhost:3000/sign-in?error=link_failed&ref=REF-1234&next=%2Fw%2Fk3j9x2m4pq%2Fdashboard");
  });

  it("leaves out ref when there is no reference, and carries nothing else from the request", () => {
    const url = signInErrorUrl("http://localhost:3000/auth/callback?code=secret&next=%2Fapp", "cancelled", DEFAULT_NEXT_PATH);
    expect(url.toString()).toBe("http://localhost:3000/sign-in?error=cancelled&next=%2Fapp");
  });
});
