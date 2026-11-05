import { describe, expect, it } from "vitest";

import { isPageSlug, PAGE_SLUG_MAX, pageSlugSchema, projectPagePath, suggestPageSlug } from "./project-page";

describe("pageSlugSchema", () => {
  it.each(["acme-web", "a", "web2", "my-big-project-2026", "a".repeat(PAGE_SLUG_MAX)])("accepts %s", (slug) => {
    expect(pageSlugSchema.parse(slug)).toBe(slug);
    expect(isPageSlug(slug)).toBe(true);
  });

  it("trims surrounding spaces before checking", () => {
    expect(pageSlugSchema.parse("  acme-web ")).toBe("acme-web");
  });

  it.each([
    ["empty", "", "Enter an address for the page, such as acme-web."],
    ["one character too long", "a".repeat(PAGE_SLUG_MAX + 1), "Use 40 characters or fewer."],
    ["capitals", "Acme", "Use lowercase letters and numbers, with single hyphens between words."],
    ["a double hyphen", "acme--web", "Use lowercase letters and numbers, with single hyphens between words."],
    ["a leading hyphen", "-acme", "Use lowercase letters and numbers, with single hyphens between words."],
    ["a trailing hyphen", "acme-", "Use lowercase letters and numbers, with single hyphens between words."],
    ["a slash", "acme/web", "Use lowercase letters and numbers, with single hyphens between words."],
    ["unicode", "café", "Use lowercase letters and numbers, with single hyphens between words."],
  ])("refuses %s (boundary)", (_case, slug, message) => {
    const result = pageSlugSchema.safeParse(slug);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
    expect(isPageSlug(slug)).toBe(false);
  });
});

describe("suggestPageSlug", () => {
  it.each([
    ["Acme web", "acme-web"],
    ["Acme Web (beta)", "acme-web-beta"],
    ["Café Ünïcode", "cafe-unicode"],
    ["  DevMacro  ", "devmacro"],
  ])("suggests a valid slug for %s", (name, slug) => {
    expect(suggestPageSlug(name)).toBe(slug);
    expect(isPageSlug(slug)).toBe(true);
  });

  it("returns nothing when no letter or number is left (boundary)", () => {
    expect(suggestPageSlug("!!! ???")).toBe("");
    expect(suggestPageSlug("日本語")).toBe("");
  });

  it("cuts a long name to the limit without a trailing hyphen (boundary)", () => {
    const slug = suggestPageSlug(`${"word ".repeat(20)}end`);
    expect(slug.length).toBeLessThanOrEqual(PAGE_SLUG_MAX);
    expect(isPageSlug(slug)).toBe(true);
  });
});

describe("projectPagePath", () => {
  it("builds the public address", () => {
    expect(projectPagePath("k3j4h5g6f7", "acme-web")).toBe("/@k3j4h5g6f7/acme-web");
  });
});
