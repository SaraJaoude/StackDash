import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { GaugeIcon } from "@/components/icons";
import { aggregateDashboard, type ProviderId } from "@/lib/dashboard/aggregate";
import { getDashboardData, snapshotWindowStart } from "@/lib/data/dashboard";
import { Constants } from "@/lib/supabase/database.types";
import { requireWorkspace, workspacePath, type WorkspaceAccess } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Dashboard" };

// The page's one filter schema. Unknown or malformed values fall back to "all" rather than
// erroring, because the URL is user-editable; other keys are ignored.
const filtersSchema = z.object({
  provider: z.enum(Constants.public.Enums.provider_id).optional().catch(undefined),
});

export default async function DashboardPage({ params, searchParams }: PageProps<"/w/[workspace]/dashboard">) {
  const { workspace: slug } = await params;
  const access = await requireWorkspace(slug, "viewer");
  const filters = filtersSchema.parse(await searchParams);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Spend, usage, and allowances across every provider this workspace connects."
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent access={access} provider={filters.provider ?? null} />
      </Suspense>
    </>
  );
}

async function DashboardContent({ access, provider }: { access: WorkspaceAccess; provider: ProviderId | null }) {
  const { workspace, role } = access;
  // Request data first: reading the clock before it would fail the prerender.
  await connection();
  const now = new Date();
  const data = await getDashboardData(workspace.id, snapshotWindowStart(now));
  const view = aggregateDashboard({ ...data, provider, now });

  if (!view.hasConnections) {
    const canConnect = canPerform(role, "manage_connections");
    return (
      <EmptyState
        icon={<GaugeIcon width={20} height={20} />}
        title="Connect your first provider"
        description="Connect a provider to see what you have spent, how much allowance is left, and when it resets."
        action={{ href: workspacePath(workspace.slug, "connections"), label: "Connect a provider" }}
        deniedReason={canConnect ? undefined : actionDeniedReason("manage_connections")}
      />
    );
  }

  return (
    <DashboardView
      view={view}
      now={now}
      selectedProvider={provider}
      dashboardPath={workspacePath(workspace.slug, "dashboard")}
    />
  );
}

function DashboardSkeleton() {
  return (
    <div role="status" aria-live="polite" className="mt-8">
      <span className="sr-only">Loading the dashboard</span>
      <div aria-hidden="true" className="grid gap-4 md:grid-cols-2">
        <div className="h-40 rounded-xl border border-line bg-panel motion-safe:animate-pulse" />
        <div className="h-40 rounded-xl border border-line bg-panel motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
