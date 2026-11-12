import { describe, expect, it } from "vitest";

import { isSuperAdminEmail } from "./super-admin";

const ADMINS: ReadonlySet<string> = new Set(["ops@example.com"]);

describe("isSuperAdminEmail", () => {
  it.each([
    ["the listed address", "ops@example.com", ADMINS, true],
    ["the listed address in another case, as GitHub may report it", "Ops@Example.COM", ADMINS, true],
    ["another address", "someone@example.com", ADMINS, false],
    ["an address that only contains the listed one", "ops@example.com.evil.test", ADMINS, false],
    ["a user with no email", null, ADMINS, false],
    ["anyone, when the list is empty", "ops@example.com", new Set<string>(), false],
  ])("%s", (_title, email, admins, expected) => {
    expect(isSuperAdminEmail(email, admins)).toBe(expected);
  });
});
