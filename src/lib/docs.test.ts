import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  createHeadingSlugger,
  getDoc,
  groupDocs,
  isDocSlug,
  listDocs,
  resolveDocLink,
  type DocLink,
} from "@/lib/docs";

describe("isDocSlug", () => {
  it.each([
    [["providers", "vercel"]],
    [["operations", "oauth-apps"]],
    [["architecture", "schema"]],
    [["top-level"]],
    [["v2", "page-1"]],
  ])("accepts %j", (slug) => {
    expect(isDocSlug(slug)).toBe(true);
  });

  it.each([
    ["empty slug", []],
    ["empty segment", ["providers", ""]],
    ["parent traversal", ["..", "src"]],
    ["traversal inside a segment", ["providers", "..%2F..%2Fpackage"]],
    ["decoded traversal inside a segment", ["providers", "../../package"]],
    ["absolute path", ["/etc", "passwd"]],
    ["backslash", ["providers\\vercel"]],
    ["uppercase", ["providers", "Vercel"]],
    ["file extension", ["providers", "vercel.md"]],
    ["dot file", [".env"]],
    ["whitespace", ["providers", "ver cel"]],
    ["unicode letter", ["providers", "vércel"]],
  ])("refuses %s", (_case, slug) => {
    expect(isDocSlug(slug)).toBe(false);
  });

  it("getDoc never reads outside docs/ for a traversal slug", () => {
    expect(getDoc(["..", "package"])).toBeNull();
    expect(getDoc(["..", "..", "etc", "passwd"])).toBeNull();
  });

  it("getDoc returns null for a well-formed slug with no file", () => {
    expect(getDoc(["providers", "not-a-provider"])).toBeNull();
  });
});

describe("resolveDocLink", () => {
  const docHrefs = new Set(["/docs/operations/deploy", "/docs/operations/jobs", "/docs/providers/github"]);
  const from = ["operations", "oauth-apps"];

  it.each<[string, string, DocLink]>([
    ["sibling doc", "jobs.md", { kind: "doc", href: "/docs/operations/jobs" }],
    ["sibling doc with a fragment", "deploy.md#environment-variables", { kind: "doc", href: "/docs/operations/deploy#environment-variables" }],
    ["doc in another folder with a fragment", "../providers/github.md#permissions", { kind: "doc", href: "/docs/providers/github#permissions" }],
    ["doc from the repository root", "/docs/operations/jobs.md", { kind: "doc", href: "/docs/operations/jobs" }],
    ["fragment on the same page", "#hosted-and-self-hosted", { kind: "fragment", href: "#hosted-and-self-hosted" }],
  ])("links a %s", (_case, href, expected) => {
    expect(resolveDocLink(from, href, docHrefs)).toEqual(expected);
  });

  it.each<[string, string, string]>([
    ["source file", "../../src/lib/docs.ts", "src/lib/docs.ts"],
    ["migration folder", "../../supabase/migrations/", "supabase/migrations"],
    ["dot file at the root", "/.env.example", ".env.example"],
    ["Markdown file outside docs/", "../../README.md#checks", "README.md"],
    ["doc that does not exist", "missing.md", "docs/operations/missing.md"],
    ["doc folder", "../providers/", "docs/providers"],
  ])("shows a repository %s as a path, not a link", (_case, href, repoPath) => {
    expect(resolveDocLink(from, href, docHrefs)).toEqual({ kind: "repo", path: repoPath });
  });

  it.each<[string, DocLink]>([
    ["https://vercel.com/docs", { kind: "external", href: "https://vercel.com/docs" }],
    ["HTTP://example.com", { kind: "external", href: "HTTP://example.com" }],
    ["//example.com/a", { kind: "external", href: "https://example.com/a" }],
    ["mailto:security@example.com", { kind: "email", href: "mailto:security@example.com" }],
    ["javascript:alert(1)", { kind: "unsupported" }],
    ["", { kind: "unsupported" }],
    ["   ", { kind: "unsupported" }],
  ])("classifies %j", (href, expected) => {
    expect(resolveDocLink(from, href, docHrefs)).toEqual(expected);
  });
});

describe("createHeadingSlugger", () => {
  it("matches the GitHub anchors the docs link to", () => {
    const slug = createHeadingSlugger();
    expect(slug("Register the pg_cron job")).toBe("register-the-pg_cron-job");
    expect(slug("GitHub OAuth app for sign-in")).toBe("github-oauth-app-for-sign-in");
    expect(slug("What stays Eddie's")).toBe("what-stays-eddies");
    expect(slug("4. Invite testers")).toBe("4-invite-testers");
  });

  it("suffixes repeated headings in order", () => {
    const slug = createHeadingSlugger();
    expect(["Permissions", "Permissions", "Permissions", "Permissions-1"].map(slug)).toEqual([
      "permissions",
      "permissions-1",
      "permissions-2",
      "permissions-1-1",
    ]);
  });

  it("starts each document fresh", () => {
    expect(createHeadingSlugger()("Summary")).toBe("summary");
    expect(createHeadingSlugger()("Summary")).toBe("summary");
  });
});

describe("listDocs", () => {
  const docsDir = path.join(process.cwd(), "docs");
  const markdownFiles = fs
    .readdirSync(docsDir, { recursive: true, encoding: "utf8" })
    .filter((file) => file.endsWith(".md"))
    .map((file) => `/docs/${file.slice(0, -3).split(path.sep).join("/")}`);

  it("publishes every Markdown file under docs/ exactly once", () => {
    const hrefs = listDocs().map((doc) => doc.href);
    expect(markdownFiles.length).toBeGreaterThan(0);
    expect(new Set(hrefs).size).toBe(hrefs.length);
    expect([...hrefs].sort()).toEqual([...markdownFiles].sort());
    expect(hrefs).toEqual(
      expect.arrayContaining(["/docs/providers/vercel", "/docs/operations/deploy", "/docs/architecture/schema"]),
    );
  });

  it("titles each page from its first heading and describes it in plain text", () => {
    const vercel = getDoc(["providers", "vercel"]);
    expect(vercel?.title).toBe("Vercel");
    // The lead line only carries the provider id and issue numbers, so the description skips it.
    expect(vercel?.description).toMatch(/^DevMacro connects to Vercel through a Vercel Integration/);

    for (const doc of listDocs()) {
      expect(doc.title, doc.href).not.toBe("");
      expect(doc.description, doc.href).not.toBe("");
      expect(doc.description, doc.href).not.toMatch(/[`*]|\]\(/);
      expect(doc.description, doc.href).not.toMatch(/^(Provider id|Issues|Docs checked)/);
    }
  });

  it("groups pages by folder with providers, operations, then architecture", () => {
    const groups = groupDocs(listDocs());
    expect(groups.slice(0, 3).map((group) => group.label)).toEqual(["Providers", "Operations", "Architecture"]);
    expect(groups.flatMap((group) => group.docs)).toHaveLength(listDocs().length);
  });
});
