import type { Metadata } from "next";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { LayersIcon } from "@/components/icons";
import { requireWorkspace, workspacePath } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({ params }: PageProps<"/w/[workspace]/projects">) {
  const { workspace: slug } = await params;
  const { workspace, role } = await requireWorkspace(slug, "viewer");
  const canConnect = canPerform(role, "manage_connections");

  return (
    <>
      <PageHeader
        title="Projects"
        description="Group accounts from different providers, such as a Vercel project and its Supabase database, into one product."
      />
      <EmptyState
        icon={<LayersIcon width={20} height={20} />}
        title="No projects yet"
        description="Projects group the accounts your connections find. Connect a provider first, then group its accounts here."
        action={{ href: workspacePath(workspace.slug, "connections"), label: "Connect a provider" }}
        deniedReason={canConnect ? undefined : actionDeniedReason("manage_connections")}
      />
    </>
  );
}
