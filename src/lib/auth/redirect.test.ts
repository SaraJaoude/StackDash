import { describe, expect, it } from "vitest";

import { DEFAULT_NEXT_PATH, isAppPath, safeNextPath } from "./redirect";

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
    ["/w/abc", true],
    ["/", false],
    ["/apple", false],
    ["/sign-in", false],
    ["/auth/callback", false],
  ])("%j -> %j", (pathname, expected) => {
    expect(isAppPath(pathname)).toBe(expected);
  });
});
