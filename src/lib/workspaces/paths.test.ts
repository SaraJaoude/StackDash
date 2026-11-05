import { describe, expect, it } from "vitest";

import { isWorkspaceSlug, WORKSPACE_SECTIONS, workspaceHome, workspacePath } from "./paths";

describe("workspacePath", () => {
  it("builds the path to every section", () => {
    expect(WORKSPACE_SECTIONS.map((section) => workspacePath("abc123", section))).toEqual([
      "/w/abc123/timeline",
      "/w/abc123/dashboard",
      "/w/abc123/connections",
      "/w/abc123/alerts",
      "/w/abc123/projects",
      "/w/abc123/settings",
    ]);
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
