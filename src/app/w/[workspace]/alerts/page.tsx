import type { Metadata } from "next";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { BellIcon } from "@/components/icons";
import { requireWorkspace, workspacePath } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Alerts" };

export default async function AlertsPage({ params }: PageProps<"/w/[workspace]/alerts">) {
  const { workspace: slug } = await params;
  const { workspace, role } = await requireWorkspace(slug, "viewer");
  const canConnect = canPerform(role, "manage_connections");

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Thresholds for spend, budgets, and allowances, and the alerts they raise."
      />
      <EmptyState
        icon={<BellIcon width={20} height={20} />}
        title="No alerts yet"
        description="Alerts watch usage data, so connect a provider first. Then set a threshold here and DevMacro flags it before a limit or budget becomes a problem."
        action={{ href: workspacePath(workspace.slug, "connections"), label: "Connect a provider" }}
        deniedReason={canConnect ? undefined : actionDeniedReason("manage_connections")}
      />
    </>
  );
}
