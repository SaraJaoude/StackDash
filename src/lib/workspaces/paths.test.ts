import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { isWorkspaceSlug, WORKSPACE_SECTIONS, workspaceHome, workspacePath } from "./paths";

describe("workspacePath", () => {
  it("builds /w/<slug>/<section>", () => {
    expect(workspacePath("abc123", "alerts")).toBe("/w/abc123/alerts");
  });

  // The palette and the nav link to every section, so each one needs a page in the app router.
  it.each(WORKSPACE_SECTIONS)("has a route for %s", (section) => {
    const page = path.join(process.cwd(), "src/app/w/[workspace]", section, "page.tsx");
    expect(fs.existsSync(page)).toBe(true);
  });

  it("opens a workspace on its timeline", () => {
    expect(workspaceHome("abc123")).toBe("/w/abc123/timeline");
  });
});

describe("isWorkspaceSlug", () => {
  it.each(["a", "abc123", "a".repeat(64)])("accepts %s", (slug) => {
    expect(isWorkspaceSlug(slug)).toBe(true);
  });

  it.each([
    ["empty", ""],
    ["65 characters", "a".repeat(65)],
    ["capitals", "ABC123"],
    ["a path", "abc/../x"],
  ])("refuses %s", (_title, slug) => {
    expect(isWorkspaceSlug(slug)).toBe(false);
  });
});
