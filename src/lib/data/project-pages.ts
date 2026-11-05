import "server-only";

import { cache } from "react";

import { isPageSlug } from "@/lib/public-metrics/project-page";
import { loadPublishedProjectMetrics, type PublishedProjectMetrics } from "@/lib/public-metrics/published";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isWorkspaceSlug } from "@/lib/workspaces/paths";

/*
 * Public project pages (#150). The public reads run with the service role through
 * public_project_page() and public_project_page_sitemap(), the one definition of "this page is
 * public" (20261105120400_project_pages.sql); the values come from the metric engine's public API.
 * The settings read runs as the signed-in member, so row level security limits it to the workspace.
 */

export type PublicProjectPage = Readonly<{
  workspaceSlug: string;
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
export const loadPublicProjectPage = cache(async (workspaceSlug: string, pageSlug: string): Promise<PublicProjectPage | null> => {
  if (!isWorkspaceSlug(workspaceSlug) || !isPageSlug(pageSlug)) return null;
  const { data, error } = await createAdminClient()
    .rpc("public_project_page", { p_workspace_slug: workspaceSlug, p_page_slug: pageSlug })
    .maybeSingle();
  if (error) throw new Error("Failed to load the project page", { cause: error });
  if (data === null) return null;
  // Null when the last publication was revoked between the two reads: the same 404.
  const published = await loadPublishedProjectMetrics(data.project_id, new Date());
  if (published === null) return null;
  return { workspaceSlug, pageSlug, projectName: data.project_name, indexable: data.indexable, published };
});

/** The sitemap holds at most this many project pages; Supabase returns at most 1,000 rows per read. */
export const SITEMAP_PAGES_LIMIT = 1000;

export type SitemapPage = Readonly<{ workspaceSlug: string; pageSlug: string; updatedAt: Date }>;

/** Public, indexable pages, newest change first. */
export async function listSitemapPages(): Promise<SitemapPage[]> {
  const { data, error } = await createAdminClient().rpc("public_project_page_sitemap", { p_limit: SITEMAP_PAGES_LIMIT });
  if (error) throw new Error("Failed to load the sitemap's project pages", { cause: error });
  return data.map((row) => ({ workspaceSlug: row.workspace_slug, pageSlug: row.page_slug, updatedAt: new Date(row.updated_at) }));
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
