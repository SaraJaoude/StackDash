import type { Metadata } from "next";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { TimelineIcon } from "@/components/icons";
import { requireWorkspace, workspacePath } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Timeline" };

export default async function TimelinePage({ params }: PageProps<"/w/[workspace]/timeline">) {
  const { workspace: slug } = await params;
  const { workspace, role } = await requireWorkspace(slug, "viewer");
  const canConnect = canPerform(role, "manage_connections");

  return (
    <>
      <PageHeader
        title="Timeline"
        description="Deploys, payments, alerts, and other activity from every provider, newest first."
      />
      <EmptyState
        icon={<TimelineIcon width={20} height={20} />}
        title="No activity yet"
        description="Events appear here after you connect a provider and its first sync finishes."
        action={{ href: workspacePath(workspace.slug, "connections"), label: "Connect a provider" }}
        deniedReason={canConnect ? undefined : actionDeniedReason("manage_connections")}
      />
    </>
  );
}
