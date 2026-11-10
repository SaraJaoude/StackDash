import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ArrivalScope } from "@/components/app/arrivals";
import { PageSkeleton } from "@/components/app/page-skeleton";
import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { SampleDataForm } from "@/components/connections/connection-controls";
import { FeedbackBanner } from "@/components/connections/feedback-banner";
import { SimulatedNotice } from "@/components/connections/simulated-badge";
import { ArrowRightIcon, TimelineIcon } from "@/components/icons";
import { EventList } from "@/components/timeline/event-list";
import { ProviderBadges } from "@/components/timeline/provider-badges";
import { SeverityLinks, TimelineFilters } from "@/components/timeline/timeline-filters";
import { isProviderSimulationEnabled } from "@/lib/adapters/simulated";
import { everySimulated } from "@/lib/adapters/simulated/marker";
import { getWorkspaceScope } from "@/lib/data/dashboard";
import { listTimelineConnectionCounts, listTimelineEvents, listTimelineTypeIds } from "@/lib/data/timeline";
import { SAMPLE_DATA_ADDED_PARAM, sampleDataRefusal } from "@/lib/demo/workspace";
import { buildScopeOptions, describeScope } from "@/lib/filters/scope";
import { hasActiveFilters, parseTimelineSearchParams, timelineHref } from "@/lib/timeline/query";
import { requireWorkspace } from "@/lib/workspaces/access";
import { workspacePath } from "@/lib/workspaces/paths";
import { actionDeniedReason, canPerform } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Timeline" };

const DESCRIPTION = "Deploys, payments, alerts, and other activity from every provider, newest first.";

// Per-member hidden event types arrive with #119; the query already excludes whatever is listed.
const HIDDEN_TYPE_IDS: readonly string[] = [];

// Every section renders inside its own Suspense boundary so navigating between sections
// has an instant shell; access checks and data reads stream in behind it.
export default function TimelinePage(props: PageProps<"/w/[workspace]/timeline">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <TimelineContent {...props} />
    </Suspense>
  );
}

async function TimelineContent({ params, searchParams }: PageProps<"/w/[workspace]/timeline">) {
  const { workspace: slug } = await params;
  const { workspace, role } = await requireWorkspace(slug, "viewer");
  const rawQuery = await searchParams;
  const query = parseTimelineSearchParams(rawQuery);
  const basePath = workspacePath(workspace.slug, "timeline");

  const filters = { ...query, hiddenTypeIds: HIDDEN_TYPE_IDS };
  const [page, connectionCounts, typeIds, workspaceScope] = await Promise.all([
    listTimelineEvents(workspace.id, filters),
    listTimelineConnectionCounts(workspace.id, filters),
    listTimelineTypeIds(workspace.id),
    getWorkspaceScope(workspace.id),
  ]);
  // Read after the request data above, so prerendering never sees the clock.
  const now = new Date();

  // The type sample covers the newest events, so it is empty only when there are none at all.
  if (typeIds.length === 0) {
    const canConnect = canPerform(role, "manage_connections");
    // Offered to owners and admins of a workspace with nothing connected, while simulation is on.
    const offerSampleData =
      canConnect &&
      sampleDataRefusal({
        simulationEnabled: isProviderSimulationEnabled(),
        connectionCount: workspaceScope.connections.length,
      }) === null;
    return (
      <>
        <PageHeader title="Timeline" description={DESCRIPTION} />
        <EmptyState
          icon={<TimelineIcon width={20} height={20} />}
          title="No activity yet"
          description={
            offerSampleData
              ? "Events appear here after you connect a provider and its first sync finishes. To look around first, explore with sample data: made-up activity from simulated providers, labeled Simulated."
              : "Events appear here after you connect a provider and its first sync finishes."
          }
          action={{ href: workspacePath(workspace.slug, "connections"), label: "Connect a provider" }}
          deniedReason={canConnect ? undefined : actionDeniedReason("manage_connections")}
          secondaryAction={offerSampleData ? <SampleDataForm workspaceSlug={workspace.slug} /> : undefined}
        />
      </>
    );
  }

  const count = page.events.length;
  const filtered = hasActiveFilters(query);
  const olderPage = query.cursor !== null;
  const showNewestLink = olderPage && count > 0;
  const scopeOptions = buildScopeOptions(workspaceScope, query.scope);
  const scopeDescription = describeScope(query.scope, scopeOptions);
  const shown =
    count === 0 ? "Showing no events" : `Showing ${count} ${olderPage ? "older " : ""}${count === 1 ? "event" : "events"}`;
  const matching = query.search === null ? shown : `${shown} with “${query.search}” in the title`;
  const status = scopeDescription === null ? matching : `${matching} for ${scopeDescription}`;
  // Events with a connection are the connections in view; DevMacro's own events have none (#269).
  const allSimulated = everySimulated(page.events.filter((event) => event.connectionName !== null));

  return (
    <>
      <PageHeader
        title="Timeline"
        description={DESCRIPTION}
        titleAside={<ProviderBadges counts={connectionCounts} action={basePath} query={query} />}
      />
      {rawQuery[SAMPLE_DATA_ADDED_PARAM] === "added" ? (
        <FeedbackBanner tone="success" title="Sample data added">
          <p>
            Every simulated provider is connected to this workspace. Their data is made up, and everything it shows is
            labeled Simulated. Delete the simulated connections on the{" "}
            <Link
              href={workspacePath(workspace.slug, "connections")}
              className="font-medium text-foreground underline underline-offset-4"
            >
              Connections page
            </Link>{" "}
            when you are done.
          </p>
        </FeedbackBanner>
      ) : null}
      <SeverityLinks action={basePath} query={query} />
      <TimelineFilters
        action={basePath}
        query={query}
        typeIds={typeIds}
        scopeOptions={scopeOptions}
        status={status}
      />

      {count === 0 ? (
        filtered ? (
          <EmptyState
            icon={<TimelineIcon width={20} height={20} />}
            title="No events match these filters"
            description="Try a wider date range or different filters, or clear the filters to see everything."
            action={{ href: basePath, label: "Clear filters" }}
          />
        ) : (
          <EmptyState
            icon={<TimelineIcon width={20} height={20} />}
            title="No older events"
            description="You have reached the start of this timeline."
            action={{ href: basePath, label: "Show newest events" }}
          />
        )
      ) : (
        <>
          {allSimulated ? <SimulatedNotice /> : null}
          {/* The list's URL is its scope: new filters or another page reset what counts as arrived. */}
          <ArrivalScope scope={timelineHref(basePath, query, query.cursor)}>
            <EventList events={page.events} now={now} markSimulated={!allSimulated} />
          </ArrivalScope>
        </>
      )}

      {page.nextCursor === null && !showNewestLink ? null : (
        <nav aria-label="Timeline pages" className="mt-6 flex flex-wrap items-center gap-3">
          {showNewestLink ? (
            <Link
              href={timelineHref(basePath, query, null)}
              className="inline-flex min-h-10 items-center rounded-md border border-line-strong px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
            >
              Show newest events
            </Link>
          ) : null}
          {page.nextCursor === null ? null : (
            <Link
              href={timelineHref(basePath, query, page.nextCursor)}
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85"
            >
              Load older events
              <ArrowRightIcon />
            </Link>
          )}
        </nav>
      )}
    </>
  );
}
