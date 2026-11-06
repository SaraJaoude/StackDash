import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { z } from "zod";

import { ArrivalScope } from "@/components/app/arrivals";
import { PageSkeleton } from "@/components/app/page-skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { secondaryButtonClass } from "@/components/alerts/form-controls";
import { AlertsSummary } from "@/components/dashboard/alerts-summary";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { HeadlineStrip } from "@/components/dashboard/headline-strip";
import { GaugeIcon } from "@/components/icons";
import {
  declaredEventTypes,
  declaredProjectedSpend,
  declaredSignupDailyTotals,
  revenueProviderIds,
} from "@/lib/adapters/registry";
import { aggregateDashboard } from "@/lib/dashboard/aggregate";
import {
  buildHeadline,
  HEADLINE_WINDOW_KINDS,
  headlineEventTypes,
  headlineWindows,
  type HeadlineWindowKind,
} from "@/lib/dashboard/headline";
import { projectDashboard } from "@/lib/dashboard/projection";
import { buildTrends, type TrendGranularity } from "@/lib/dashboard/trends";
import { getRecentAnomalies, RECENT_ANOMALY_DAYS } from "@/lib/data/anomalies";
import { getDashboardData, getWorkspaceScope, snapshotWindowStart } from "@/lib/data/dashboard";
import { getHeadlineEvents, getHeadlineSnapshots } from "@/lib/data/headline";
import { getTrendData } from "@/lib/data/trends";
import { getUnacknowledgedSummary } from "@/lib/data/triggered-alerts";
import {
  appendScopeParams,
  buildScopeOptions,
  describeScope,
  ScopeSearchParamsSchema,
  type ScopeFilters,
} from "@/lib/filters/scope";
import { isYearComplete, latestCardYear, yearLabel } from "@/lib/public-metrics/yearly";
import { requireWorkspace, type WorkspaceAccess } from "@/lib/workspaces/access";
import { workspacePath, yearInReviewPath } from "@/lib/workspaces/paths";
import { actionDeniedReason, canPerform } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Dashboard" };

// The page's one URL schema: the shared scope filter, the trend period, and the headline window.
// Unknown or malformed values fall back to the defaults rather than erroring, because the URL is
// user-editable; other keys are ignored.
const searchParamsSchema = ScopeSearchParamsSchema.extend({
  trend: z.enum(["daily", "monthly"]).catch("daily"),
  window: z.enum(HEADLINE_WINDOW_KINDS).catch("week"),
});

type DashboardViewParams = Readonly<{ trend: TrendGranularity; window: HeadlineWindowKind }>;

/** The page's own URL state; the defaults (daily trend, this week) stay out of the URL. */
function viewParams({ trend, window }: DashboardViewParams): Record<string, string> {
  return { ...(trend === "daily" ? {} : { trend }), ...(window === "week" ? {} : { window }) };
}

/** Dashboard link keeping the filter and the other view choices. */
function dashboardHref(basePath: string, scope: ScopeFilters, view: DashboardViewParams): string {
  const params = new URLSearchParams();
  appendScopeParams(params, scope);
  for (const [name, value] of Object.entries(viewParams(view))) params.set(name, value);
  const search = params.toString();
  return search === "" ? basePath : `${basePath}?${search}`;
}

// Every section renders inside its own Suspense boundary so navigating between sections
// has an instant shell; access checks and data reads stream in behind it.
export default function DashboardPage(props: PageProps<"/w/[workspace]/dashboard">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <DashboardPageContent {...props} />
    </Suspense>
  );
}

async function DashboardPageContent({ params, searchParams }: PageProps<"/w/[workspace]/dashboard">) {
  const { workspace: slug } = await params;
  const access = await requireWorkspace(slug, "viewer");
  const parsed = searchParamsSchema.parse(await searchParams);
  const scope: ScopeFilters = { providers: parsed.provider, projects: parsed.project, accounts: parsed.account };
  // Read after the request data above, so the clock never runs during prerendering.
  const now = new Date();
  const reviewYear = latestCardYear(now);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Spend, usage, and allowances across every provider this workspace connects."
        actions={
          <Link href={yearInReviewPath(access.workspace.slug, reviewYear)} className={secondaryButtonClass}>
            {isYearComplete(reviewYear, now) ? `Your ${reviewYear} in review` : `Your ${yearLabel(reviewYear, now)}`}
          </Link>
        }
      />
      <Suspense fallback={<DashboardSkeleton />}>
        <DashboardContent access={access} scope={scope} view={{ trend: parsed.trend, window: parsed.window }} />
      </Suspense>
    </>
  );
}

async function DashboardContent({
  access,
  scope,
  view,
}: {
  access: WorkspaceAccess;
  scope: ScopeFilters;
  view: DashboardViewParams;
}) {
  const { workspace, role } = access;
  // Request data first: reading the clock before it would fail the prerender.
  await connection();
  const now = new Date();
  const windows = headlineWindows(view.window, now);
  const eventTypes = headlineEventTypes(declaredEventTypes, declaredSignupDailyTotals);
  // Alerts load with the rest so their row never streams in later and shifts the provider cards.
  const anomaliesSince = new Date(now.getTime() - RECENT_ANOMALY_DAYS * 86_400_000).toISOString();
  const [workspaceScope, data, trendData, alertsSummary, headlineSnapshots, headlineEvents, recentAnomalies] =
    await Promise.all([
      getWorkspaceScope(workspace.id),
      getDashboardData(workspace.id, snapshotWindowStart(now), scope),
      getTrendData(workspace.id, now, scope),
      getUnacknowledgedSummary(workspace.id),
      getHeadlineSnapshots(workspace.id, scope, windows, eventTypes),
      getHeadlineEvents(workspace.id, scope, windows, eventTypes),
      getRecentAnomalies(workspace.id, anomaliesSince),
    ]);
  const alerts = <AlertsSummary workspace={workspace} summary={alertsSummary} anomalies={recentAnomalies} />;

  if (workspaceScope.connections.length === 0) {
    const canConnect = canPerform(role, "manage_connections");
    return (
      <>
        <EmptyState
          icon={<GaugeIcon width={20} height={20} />}
          title="Connect your first provider"
          description="Connect a provider to see what you have spent, how much allowance is left, and when it resets."
          action={{ href: workspacePath(workspace.slug, "connections"), label: "Connect a provider" }}
          deniedReason={canConnect ? undefined : actionDeniedReason("manage_connections")}
        />
        {alerts}
      </>
    );
  }

  const dashboardPath = workspacePath(workspace.slug, "dashboard");
  const scopeOptions = buildScopeOptions(workspaceScope, scope);
  const input = { ...data, now };
  // The page's URL is its scope: a new filter, trend period, or headline window resets what counts as changed.
  return (
    <ArrivalScope scope={dashboardHref(dashboardPath, scope, view)}>
      <DashboardView
        view={aggregateDashboard(input)}
        projections={projectDashboard(input)}
        now={now}
        dashboardPath={dashboardPath}
        scope={scope}
        scopeOptions={scopeOptions}
        scopeDescription={describeScope(scope, scopeOptions)}
        filterParams={viewParams(view)}
        headline={
          <HeadlineStrip
            strip={buildHeadline({
              snapshots: headlineSnapshots,
              connections: trendData.connections,
              events: headlineEvents,
              eventTypes,
              projectedSpend: declaredProjectedSpend,
              revenueProviders: revenueProviderIds,
              kind: view.window,
              now,
            })}
            hrefs={{
              week: dashboardHref(dashboardPath, scope, { ...view, window: "week" }),
              month: dashboardHref(dashboardPath, scope, { ...view, window: "month" }),
            }}
          />
        }
        alerts={alerts}
        trends={{
          granularity: view.trend,
          series: buildTrends(trendData.snapshots, trendData.connections, view.trend, now),
          hrefs: {
            daily: dashboardHref(dashboardPath, scope, { ...view, trend: "daily" }),
            monthly: dashboardHref(dashboardPath, scope, { ...view, trend: "monthly" }),
          },
        }}
      />
    </ArrivalScope>
  );
}

/** Shaped like the first screen (the closed filter bar and the headline strip's first row), so nothing jumps. */
function DashboardSkeleton() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading the dashboard</span>
      <div aria-hidden="true">
        <div className="mt-4 h-12.5 rounded-xl border border-line bg-panel motion-safe:animate-pulse" />
        <div className="mt-6 h-6 w-56 rounded bg-panel-raised motion-safe:animate-pulse" />
        <div className="mt-3 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="h-36 rounded-xl border border-line bg-panel motion-safe:animate-pulse" />
          <div className="h-36 rounded-xl border border-line bg-panel motion-safe:animate-pulse" />
          <div className="h-36 rounded-xl border border-line bg-panel motion-safe:animate-pulse" />
        </div>
      </div>
    </div>
  );
}
