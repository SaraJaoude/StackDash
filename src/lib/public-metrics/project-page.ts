import { z } from "zod";

import { isHandleFormat } from "@/lib/workspaces/handles";
import { isWorkspaceSlug } from "@/lib/workspaces/paths";

/*
 * Public project pages (#150): the address and the slug rules, shared by the settings form (limits
 * and hints), the Server Actions (validation), the proxy's rewrite, the page, and the sitemap.
 * Client-safe: no data access. The database checks the same format in project_pages_slug_format
 * (20261105120500_project_pages.sql).
 *
 * The first segment of an address is the workspace's handle while it has one, and its slug (the
 * workspace ID) otherwise (#258). The proxy sends a slug address to the handle address.
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

/** Whose page it is: the workspace's slug, and its handle when it has claimed one. */
export type PublicAddressOwner = Readonly<{ slug: string; handle: string | null }>;

/** The first segment of the workspace's public addresses: its handle when set, otherwise its slug. */
export function workspaceAddress(owner: PublicAddressOwner): string {
  return owner.handle ?? owner.slug;
}

/** The public address of a page: `/@<handle or workspace slug>/<page slug>`. */
export function projectPagePath(owner: PublicAddressOwner, pageSlug: string): string {
  return `/@${workspaceAddress(owner)}/${pageSlug}`;
}

/** Whether a segment could name a workspace in an address: a workspace slug or a handle. */
export function isWorkspaceAddress(value: string): boolean {
  return isWorkspaceSlug(value) || isHandleFormat(value);
}

const PROJECT_PAGE_PATH = /^\/@([^/]+)\/([^/]+)$/;

/**
 * The workspace segment and page slug of a public address, or null when the path is not one. The
 * proxy asks this before it queries, so a path the page would refuse (an over-long slug included)
 * costs no database round trip, and both apply the same isWorkspaceAddress and isPageSlug rules.
 */
export function parseProjectPagePath(pathname: string): { workspaceAddress: string; pageSlug: string } | null {
  const [, address, pageSlug] = PROJECT_PAGE_PATH.exec(pathname) ?? [];
  if (address === undefined || pageSlug === undefined) return null;
  if (!isWorkspaceAddress(address) || !isPageSlug(pageSlug)) return null;
  return { workspaceAddress: address, pageSlug };
}
