import "server-only";

import { cache } from "react";
import { z } from "zod";

import {
  isPageSlug,
  isWorkspaceAddress,
  projectPagePath,
  workspaceAddress,
  type PublicAddressOwner,
} from "@/lib/public-metrics/project-page";
import { loadPublishedProjectMetrics, type PublishedProjectMetrics } from "@/lib/public-metrics/published";
import type { ShareProjectPage } from "@/lib/public-metrics/share";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

/*
 * Public project pages (#150). The public reads run with the service role through
 * public_project_page() and public_project_page_sitemap(), the one definition of "this page is
 * public" (20261105120500_project_pages.sql, 20261111090000_workspace_handles.sql); the values come
 * from the metric engine's public API. The settings read runs as the signed-in member, so row level
 * security limits it to the workspace.
 */

// Generated types call every column a function returns non-null; the handle is null until claimed.
const PublicPageRowSchema = z.object({
  project_id: z.string(),
  project_name: z.string(),
  indexable: z.boolean(),
  workspace_slug: z.string(),
  workspace_handle: z.string().nullable(),
});

export type PublicPageMatch = Readonly<{
  projectId: string;
  projectName: string;
  indexable: boolean;
  workspace: PublicAddressOwner;
}>;

/**
 * The page an address answers with right now, or null for an unknown or released handle, another
 * workspace's handle, a page that is off, and a page with nothing published alike. The address's
 * first segment is a handle or a workspace slug; `workspace` says both, so a caller can tell a slug
 * address of a workspace that has a handle. Unvalidated input: check it with parseProjectPagePath
 * or isWorkspaceAddress and isPageSlug first.
 */
export async function findPublicProjectPage(address: string, pageSlug: string): Promise<PublicPageMatch | null> {
  const { data, error } = await createAdminClient()
    .rpc("public_project_page", { p_workspace_slug: address, p_page_slug: pageSlug })
    .maybeSingle();
  if (error) throw new Error("Failed to load the project page", { cause: error });
  if (data === null) return null;
  const row = PublicPageRowSchema.parse(data);
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    indexable: row.indexable,
    workspace: { slug: row.workspace_slug, handle: row.workspace_handle },
  };
}

export type PublicProjectPage = Readonly<{
  workspace: PublicAddressOwner;
  pageSlug: string;
  projectName: string;
  indexable: boolean;
  published: PublishedProjectMetrics;
}>;

/**
 * The page an address answers with, computed now, or null for an unknown address, a page that is
 * off, and a page with nothing published alike. Cached per request, so the page and its metadata
 * read it once. Call after `connection()`: it reads the clock.
 */
export const loadPublicProjectPage = cache(async (address: string, pageSlug: string): Promise<PublicProjectPage | null> => {
  if (!isWorkspaceAddress(address) || !isPageSlug(pageSlug)) return null;
  const page = await findPublicProjectPage(address, pageSlug);
  if (page === null) return null;
  // Null when the last publication was revoked between the two reads: the same 404.
  const published = await loadPublishedProjectMetrics(page.projectId, new Date());
  if (published === null) return null;
  return { workspace: page.workspace, pageSlug, projectName: page.projectName, indexable: page.indexable, published };
});

/**
 * The project's page while it is public, for its cards (#255): the page's address and the project
 * name, or null when the project has no page or its page answers 404. Finds the address the page is
 * on, then asks public_project_page() about that address, so "public" keeps its one definition.
 */
export async function loadPublicPageOfProject(projectId: string): Promise<ShareProjectPage | null> {
  const { data: address, error: addressError } = await createAdminClient()
    .from("project_pages")
    .select("slug, workspaces!inner(slug, handle)")
    .eq("project_id", projectId)
    .eq("enabled", true)
    .maybeSingle();
  if (addressError) throw new Error("Failed to load the project page address", { cause: addressError });
  if (address === null) return null;
  const page = await findPublicProjectPage(workspaceAddress(address.workspaces), address.slug);
  if (page === null || page.projectId !== projectId) return null;
  return { path: projectPagePath(page.workspace, address.slug), projectName: page.projectName };
}

/** The sitemap holds at most this many project pages; Supabase returns at most 1,000 rows per read. */
export const SITEMAP_PAGES_LIMIT = 1000;

export type SitemapPage = Readonly<{ workspace: PublicAddressOwner; pageSlug: string; updatedAt: Date }>;

const SitemapRowSchema = z.object({
  workspace_slug: z.string(),
  workspace_handle: z.string().nullable(),
  page_slug: z.string(),
  updated_at: z.string(),
});

/** Public, indexable pages, newest change first. */
export async function listSitemapPages(): Promise<SitemapPage[]> {
  const { data, error } = await createAdminClient().rpc("public_project_page_sitemap", { p_limit: SITEMAP_PAGES_LIMIT });
  if (error) throw new Error("Failed to load the sitemap's project pages", { cause: error });
  return z
    .array(SitemapRowSchema)
    .parse(data)
    .map((row) => ({
      workspace: { slug: row.workspace_slug, handle: row.workspace_handle },
      pageSlug: row.page_slug,
      updatedAt: new Date(row.updated_at),
    }));
}

export type ProjectPageSettings = Readonly<{ slug: string; enabled: boolean; indexable: boolean }>;

/** The project's page settings, or null when its page was never turned on. */
export const loadProjectPageSettings = cache(async (workspaceId: string, projectId: string): Promise<ProjectPageSettings | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_pages")
    .select("slug, enabled, indexable")
    .eq("workspace_id", workspaceId)
    .eq("project_id", projectId)
    .maybeSingle();
  if (error) throw new Error("Failed to load the project page settings", { cause: error });
  return data;
});
