import type { Metadata } from "next";
import { Suspense } from "react";

import { PageSkeleton } from "@/components/app/page-skeleton";
import { PageHeader } from "@/components/app/page-header";
import { ProjectsManager } from "@/components/projects/projects-manager";
import { listProjects, PROJECTS_LIMIT } from "@/lib/data/projects";
import { requireWorkspace } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Projects" };

// Every section renders inside its own Suspense boundary so navigating between sections
// has an instant shell; access checks and data reads stream in behind it.
export default function ProjectsPage(props: PageProps<"/w/[workspace]/projects">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ProjectsContent {...props} />
    </Suspense>
  );
}

async function ProjectsContent({ params }: PageProps<"/w/[workspace]/projects">) {
  const { workspace: slug } = await params;
  const { workspace, role } = await requireWorkspace(slug, "viewer");
  const { projects, hasMore } = await listProjects(workspace.id);

  return (
    <>
      <PageHeader
        title="Projects"
        description="Group accounts from different providers, such as a Vercel project and its Supabase database, into one product."
      />
      <ProjectsManager
        workspaceSlug={workspace.slug}
        projects={projects}
        hasMore={hasMore}
        limit={PROJECTS_LIMIT}
        deniedReason={canPerform(role, "manage_projects") ? undefined : actionDeniedReason("manage_projects")}
      />
    </>
  );
}
