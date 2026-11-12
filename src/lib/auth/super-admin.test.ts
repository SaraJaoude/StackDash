import { afterEach, describe, expect, it, vi } from "vitest";

import { isSuperAdminEmail, refusesAdminBeforeRender, showsAdminLink } from "./super-admin";

const logError = vi.hoisted(() => vi.fn(() => "ref-123"));
vi.mock("@/lib/log/logger", () => ({ log: { warn: () => {} }, logError }));

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

describe("showsAdminLink", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    logError.mockClear();
  });

  it.each([
    ["the listed address", "ops@example.com,second@example.com", "second@example.com", true],
    ["the listed address in another case", "ops@example.com", "OPS@example.com", true],
    ["another address", "ops@example.com", "someone@example.com", false],
    ["a user with no email", "ops@example.com", null, false],
    ["anyone, when the list is empty", "", "ops@example.com", false],
    ["anyone, when the list is blank", " , ", "ops@example.com", false],
  ])("%s", (_title, list, email, expected) => {
    vi.stubEnv("DEVMACRO_SUPER_ADMIN_EMAILS", list);
    expect(showsAdminLink(email)).toBe(expected);
    expect(logError).not.toHaveBeenCalled();
  });

  it("hides the link and logs the reason when the list is invalid, rather than failing the page", () => {
    vi.stubEnv("DEVMACRO_SUPER_ADMIN_EMAILS", "ops@example.com,not-an-address");
    expect(showsAdminLink("ops@example.com")).toBe(false);
    expect(logError).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith("admin.link_check_failed", expect.any(Error));
  });
});

describe("refusesAdminBeforeRender", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    logError.mockClear();
  });

  it.each([
    ["lets the listed address through", "ops@example.com,second@example.com", "second@example.com", false],
    ["lets the listed address through in another case", "ops@example.com", "OPS@example.com", false],
    ["refuses another address", "ops@example.com", "someone@example.com", true],
    ["refuses a user with no email", "ops@example.com", null, true],
    ["refuses anyone when the list is empty", "", "ops@example.com", true],
  ])("%s", (_title, list, email, expected) => {
    vi.stubEnv("DEVMACRO_SUPER_ADMIN_EMAILS", list);
    expect(refusesAdminBeforeRender(email)).toBe(expected);
    expect(logError).not.toHaveBeenCalled();
  });

  it("leaves an invalid list to the page, so its error page still shows, and logs the reason", () => {
    vi.stubEnv("DEVMACRO_SUPER_ADMIN_EMAILS", "ops@example.com,not-an-address");
    expect(refusesAdminBeforeRender("someone@example.com")).toBe(false);
    expect(logError).toHaveBeenCalledOnce();
    expect(logError).toHaveBeenCalledWith("admin.proxy_check_failed", expect.any(Error));
  });
});
