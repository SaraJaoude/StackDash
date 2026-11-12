import { describe, expect, it } from "vitest";

import { DEMO_SIGN_IN_OTP_TYPE, DEMO_USER_MARKER, demoSignInPath, isDemoAccount } from "./sign-in";

describe("isDemoAccount", () => {
  it("is true for the marker the demo seed sets, beside what Supabase Auth adds", () => {
    expect(isDemoAccount({ [DEMO_USER_MARKER]: true, provider: "email", providers: ["email"] })).toBe(true);
  });

  it.each([
    ["no app_metadata", undefined],
    ["null", null],
    ["an empty object", {}],
    ["a GitHub account", { provider: "github", providers: ["github"] }],
    ["the marker as a string", { [DEMO_USER_MARKER]: "true" }],
    ["the marker set to false", { [DEMO_USER_MARKER]: false }],
    ["the marker as a number", { [DEMO_USER_MARKER]: 1 }],
    ["a string, not an object", DEMO_USER_MARKER],
  ])("is false for %s", (_title, appMetadata) => {
    expect(isDemoAccount(appMetadata)).toBe(false);
  });
});

describe("demoSignInPath", () => {
  it("is /auth/confirm with the token hash, the email type, and next", () => {
    const url = new URL(demoSignInPath("abc123", "/w/k3j9x2m4pq/dashboard"), "http://localhost:3000");
    expect(url.pathname).toBe("/auth/confirm");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      token_hash: "abc123",
      type: DEMO_SIGN_IN_OTP_TYPE,
      next: "/w/k3j9x2m4pq/dashboard",
    });
  });

  it("encodes characters that would otherwise split the query (boundary)", () => {
    const url = new URL(demoSignInPath("a&b=c d", "/w/x/timeline?q=a&b"), "http://localhost:3000");
    expect(url.searchParams.get("token_hash")).toBe("a&b=c d");
    expect(url.searchParams.get("next")).toBe("/w/x/timeline?q=a&b");
  });
});
