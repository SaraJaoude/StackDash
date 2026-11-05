import { z } from "zod";

/*
 * Public project pages (#150): the address and the slug rules, shared by the settings form (limits
 * and hints), the Server Actions (validation), the proxy's rewrite, the page, and the sitemap.
 * Client-safe: no data access. The database checks the same format in project_pages_slug_format
 * (20261105120500_project_pages.sql).
 */

export const PAGE_SLUG_MAX = 40;
const PAGE_SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const pageSlugSchema = z
  .string()
  .trim()
  .min(1, "Enter an address for the page, such as acme-web.")
  .max(PAGE_SLUG_MAX, `Use ${PAGE_SLUG_MAX} characters or fewer.`)
  .regex(PAGE_SLUG_PATTERN, "Use lowercase letters and numbers, with single hyphens between words.");

export function isPageSlug(value: string): boolean {
  return value.length <= PAGE_SLUG_MAX && PAGE_SLUG_PATTERN.test(value);
}

/**
 * A slug suggested from the project name: "Acme Web (beta)" becomes "acme-web-beta". Letters with
 * accents lose them; anything else outside a to z and 0 to 9 separates words. Empty when nothing is
 * left, so the owner types one.
 */
export function suggestPageSlug(projectName: string): string {
  return projectName
    .normalize("NFKD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, PAGE_SLUG_MAX)
    .replace(/^-+|-+$/g, "");
}

/** The public address of a page: `/@<workspace slug>/<page slug>`. */
export function projectPagePath(workspaceSlug: string, pageSlug: string): string {
  return `/@${workspaceSlug}/${pageSlug}`;
}
