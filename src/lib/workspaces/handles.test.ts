import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { HANDLE_MAX, HANDLE_MIN, handleSchema, isHandleFormat, normalizeHandle, RESERVED_HANDLES } from "./handles";

function refusal(input: string): string | undefined {
  const result = handleSchema.safeParse(input);
  return result.success ? undefined : result.error.issues[0]?.message;
}

describe("handleSchema", () => {
  it.each([
    ["the shortest handle (3 characters)", "a".repeat(HANDLE_MIN), "aaa"],
    ["the longest handle (32 characters)", "a".repeat(HANDLE_MAX), "a".repeat(32)],
    ["single hyphens between words", "acme-labs-2", "acme-labs-2"],
    ["digits only", "123", "123"],
    ["uppercase input, lowercased", "Acme-Labs", "acme-labs"],
    ["surrounding whitespace, trimmed", "  acme-labs\t\n", "acme-labs"],
    ["a 32 character handle inside whitespace", ` ${"a".repeat(HANDLE_MAX)} `, "a".repeat(32)],
  ])("accepts %s", (_case, input, handle) => {
    expect(handleSchema.parse(input)).toBe(handle);
  });

  it.each([
    ["empty input (boundary)", "", "Enter a handle, such as acme-labs."],
    ["whitespace only (boundary)", "   ", "Enter a handle, such as acme-labs."],
    ["2 characters (boundary)", "ab", "Use at least 3 characters."],
    ["33 characters (boundary)", "a".repeat(HANDLE_MAX + 1), "Use 32 characters or fewer."],
    ["a leading hyphen", "-acme", "Use lowercase letters and numbers, with single hyphens between words."],
    ["a trailing hyphen", "acme-", "Use lowercase letters and numbers, with single hyphens between words."],
    ["a double hyphen", "acme--labs", "Use lowercase letters and numbers, with single hyphens between words."],
    ["an inner space", "acme labs", "Use lowercase letters and numbers, with single hyphens between words."],
    ["an underscore", "acme_labs", "Use lowercase letters and numbers, with single hyphens between words."],
    ["a dot", "acme.labs", "Use lowercase letters and numbers, with single hyphens between words."],
    ["an accented letter (unicode)", "café", "Use lowercase letters and numbers, with single hyphens between words."],
    ["a Cyrillic look-alike (unicode)", "\u0430cme", "Use lowercase letters and numbers, with single hyphens between words."],
    ["the Kelvin sign, which toLowerCase turns into k (unicode)", "\u212Aelvin", "Use lowercase letters and numbers, with single hyphens between words."],
    ["an emoji (unicode)", "acme🚀", "Use lowercase letters and numbers, with single hyphens between words."],
    ["a reserved route segment", "docs", "This handle is reserved. Choose another one."],
    ["a reserved name", "devmacro", "This handle is reserved. Choose another one."],
    ["a reserved name in capitals", "WWW", "This handle is reserved. Choose another one."],
    ["a reserved hyphenated route segment", "sign-in", "This handle is reserved. Choose another one."],
  ])("refuses %s", (_case, input, message) => {
    expect(refusal(input)).toBe(message);
  });
});

describe("normalizeHandle", () => {
  it("lowercases ASCII letters and leaves every other character as typed", () => {
    expect(normalizeHandle(" ACME-\u212A ")).toBe("acme-\u212A");
  });
});

describe("isHandleFormat", () => {
  it.each(["aaa", "a".repeat(HANDLE_MAX), "acme-labs"])("accepts %s", (value) => {
    expect(isHandleFormat(value)).toBe(true);
  });

  it.each([
    ["2 characters (boundary)", "ab"],
    ["33 characters (boundary)", "a".repeat(HANDLE_MAX + 1)],
    ["capitals, since addresses are never lowercased", "Acme"],
    ["a double hyphen", "acme--labs"],
  ])("refuses %s", (_case, value) => {
    expect(isHandleFormat(value)).toBe(false);
  });
});

describe("RESERVED_HANDLES", () => {
  // Route groups "(x)", dynamic segments "[x]", slots "@x", and private folders "_x" add no segment.
  const segments = fs
    .readdirSync(path.join(process.cwd(), "src/app"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !/^[([@_]/.test(entry.name))
    .map((entry) => entry.name);

  it("finds the app's top-level route segments, so the check below is not vacuous", () => {
    expect(segments).toEqual(expect.arrayContaining(["api", "docs", "p", "w"]));
  });

  it.each(segments)("reserves the route segment %s", (segment) => {
    expect(RESERVED_HANDLES.has(segment)).toBe(true);
  });

  it("holds only lowercase entries, so the lowercased input is what is compared", () => {
    expect([...RESERVED_HANDLES].filter((word) => word !== word.toLowerCase())).toEqual([]);
  });
});
