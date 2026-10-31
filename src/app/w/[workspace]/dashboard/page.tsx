import type { Metadata } from "next";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { GaugeIcon } from "@/components/icons";
import { requireWorkspace, workspacePath } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ params }: PageProps<"/w/[workspace]/dashboard">) {
  const { workspace: slug } = await params;
  const { workspace, role } = await requireWorkspace(slug, "viewer");
  const canConnect = canPerform(role, "manage_connections");

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Spend, usage, and allowances across every provider this workspace connects."
      />
      <EmptyState
        icon={<GaugeIcon width={20} height={20} />}
        title="No providers connected yet"
        description="Connect your first provider to see what you have spent, how much allowance is left, and when it resets."
        action={{ href: workspacePath(workspace.slug, "connections"), label: "Connect a provider" }}
        deniedReason={canConnect ? undefined : actionDeniedReason("manage_connections")}
      />
    </>
  );
}
