import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { PageSkeleton } from "@/components/app/page-skeleton";
import { PageHeader } from "@/components/app/page-header";
import { SimulatedBadge } from "@/components/connections/simulated-badge";
import { LockIcon } from "@/components/icons";
import {
  PublicationAnnouncer,
  PublishMetricForm,
  SelfReportedForm,
  UnpublishButton,
  UnpublishEverythingButton,
} from "@/components/public-metrics/publication-controls";
import { countLivePublications, loadProjectPublications, type ProjectMetricStatus } from "@/lib/data/published-metrics";
import { formatDateTime } from "@/lib/format";
import {
  allowedRoundings,
  FORMULAS_DOC_PATH,
  PROVENANCE_LABELS,
  PUBLISHED_METRIC_DELAYS,
  ROUNDING_LABELS,
} from "@/lib/public-metrics/definitions";
import { publicationSummary } from "@/lib/public-metrics/display";
import type { PublishedValue } from "@/lib/public-metrics/published";
import { requireWorkspace, workspacePath } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Public metrics" };

const METRICS_HEADING_ID = "public-metrics-title";
const SELF_REPORTED_HEADING_ID = "self-reported-title";

const DELAY_CHOICES = PUBLISHED_METRIC_DELAYS.map((days) => ({
  value: String(days),
  label: days === 0 ? "Current value" : `${days} days late`,
}));

// Every section renders inside its own Suspense boundary so navigating between sections
// has an instant shell; access checks and data reads stream in behind it.
export default function PublicMetricsPage(props: PageProps<"/w/[workspace]/projects/[projectId]/public-metrics">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <PublicMetricsContent {...props} />
    </Suspense>
  );
}

function ValueText({ value }: { value: PublishedValue }) {
  if (value.status === "unavailable") return <span className="text-muted">{value.text}</span>;
  return (
    <>
      <span className="font-medium text-foreground">{value.text}</span>
      <span className="text-muted">
        {", synced "}
        <time dateTime={value.lastSyncedAt.toISOString()}>{formatDateTime(value.lastSyncedAt)}</time>
      </span>
    </>
  );
}

async function PublicMetricsContent({ params }: PageProps<"/w/[workspace]/projects/[projectId]/public-metrics">) {
  const { workspace: slug, projectId } = await params;
  const { workspace, role } = await requireWorkspace(slug, "viewer");
  // A malformed id would fail the uuid cast in the query; it is the same "no such project" answer.
  if (!z.guid().safeParse(projectId).success) notFound();
  // Read after the request data above, so the clock never runs during prerendering.
  const now = new Date();
  const [publications, liveCount] = await Promise.all([
    loadProjectPublications(workspace.id, projectId, now),
    countLivePublications(workspace.id),
  ]);
  if (publications === null) notFound();

  const { project, metrics, selfReported } = publications;
  const canPublish = canPerform(role, "publish_metrics");
  const deniedReason = actionDeniedReason("publish_metrics");
  const publicDataPath = `/api/public/projects/${project.id}/metrics`;
  const anyPublished = metrics.some((metric) => metric.publication !== null) || selfReported.length > 0;

  return (
    <>
      <p className="mb-4 text-sm">
        <Link
          href={workspacePath(workspace.slug, "projects")}
          className="text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          All projects
        </Link>
      </p>
      <PageHeader
        title={`Public metrics for ${project.name}`}
        description="Choose which numbers anyone can see. Nothing is public until you publish it. Spend, budgets, and alerts can never be published, and no account or repository names are shown."
      />

      <PublicationAnnouncer>
        {canPublish ? null : (
          <p className="mt-6 flex items-center gap-2 text-sm text-muted">
            <LockIcon className="shrink-0" />
            <span>{deniedReason}</span>
          </p>
        )}

        <section aria-labelledby="public-link-title" className="mt-6 rounded-xl border border-line bg-panel px-6 py-5 text-sm">
          <h2 id="public-link-title" className="font-semibold">
            Where it is public
          </h2>
          {anyPublished ? (
            <p className="mt-2 leading-6 text-muted">
              Anyone can read this project&apos;s published values at{" "}
              <a href={publicDataPath} className="break-all font-medium text-foreground underline underline-offset-4">
                {publicDataPath}
              </a>
              . Badges, cards, and the project page will read the same values.
            </p>
          ) : (
            <p className="mt-2 leading-6 text-muted">Nothing from this project is public.</p>
          )}
          <p className="mt-2 leading-6 text-muted">
            Every formula is on the{" "}
            <Link href={FORMULAS_DOC_PATH} className="font-medium text-foreground underline underline-offset-4">
              public metrics formulas page
            </Link>
            .
          </p>
          {canPublish && liveCount > 0 ? (
            <div className="mt-4 border-t border-line pt-4">
              <p className="mb-3 leading-6 text-muted">
                Unpublish every metric and self-reported value of every project in this workspace at once.
              </p>
              <UnpublishEverythingButton workspaceSlug={workspace.slug} focusId={METRICS_HEADING_ID} />
            </div>
          ) : null}
        </section>

        <section aria-labelledby={METRICS_HEADING_ID} className="mt-6 rounded-xl border border-line bg-panel">
          <h2 id={METRICS_HEADING_ID} tabIndex={-1} className="border-b border-line px-6 py-4 text-sm font-semibold">
            Metrics from your connected providers
          </h2>
          <ul className="divide-y divide-line">
            {metrics.map((metric) => (
              <MetricRow
                key={metric.metricId}
                metric={metric}
                workspaceSlug={workspace.slug}
                projectId={project.id}
                canPublish={canPublish}
              />
            ))}
          </ul>
        </section>

        <section aria-labelledby={SELF_REPORTED_HEADING_ID} className="mt-6 rounded-xl border border-line bg-panel">
          <div className="border-b border-line px-6 py-4">
            <h2 id={SELF_REPORTED_HEADING_ID} tabIndex={-1} className="text-sm font-semibold">
              Self-reported values
            </h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Numbers you type yourself. They appear on the project page labelled Self-reported, and never on a
              badge or a leaderboard.
            </p>
          </div>
          {selfReported.length === 0 ? (
            <p className="px-6 py-4 text-sm text-muted">No self-reported values are published.</p>
          ) : (
            <ul className="divide-y divide-line">
              {selfReported.map((entry) => (
                <li key={entry.publicationId} className="flex flex-col gap-3 px-6 py-4 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="break-words font-medium">
                      {entry.label}: {entry.text}
                    </p>
                    <p className="mt-1 text-muted">
                      {PROVENANCE_LABELS.self_reported}, published{" "}
                      <time dateTime={entry.publishedAt.toISOString()}>{formatDateTime(entry.publishedAt)}</time>
                    </p>
                  </div>
                  {canPublish ? (
                    <UnpublishButton
                      workspaceSlug={workspace.slug}
                      publicationId={entry.publicationId}
                      label={entry.label}
                      focusId={SELF_REPORTED_HEADING_ID}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canPublish ? (
            <div className="border-t border-line px-6 py-5">
              <h3 className="mb-3 text-sm font-semibold">Publish a self-reported value</h3>
              <SelfReportedForm workspaceSlug={workspace.slug} projectId={project.id} focusId={SELF_REPORTED_HEADING_ID} />
            </div>
          ) : null}
        </section>
      </PublicationAnnouncer>
    </>
  );
}

function MetricRow({
  metric,
  workspaceSlug,
  projectId,
  canPublish,
}: {
  metric: ProjectMetricStatus;
  workspaceSlug: string;
  projectId: string;
  canPublish: boolean;
}) {
  const { publication } = metric;
  const simulated =
    (metric.current.status === "available" && metric.current.simulated) ||
    (publication?.value.status === "available" && publication.value.simulated);
  return (
    <li className="flex flex-col gap-3 px-6 py-4 text-sm lg:flex-row lg:items-start lg:justify-between">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{metric.label}</span>
          <span className="rounded-full border border-line-strong px-2 py-0.5 text-xs text-muted">
            {PROVENANCE_LABELS[metric.provenance]}
          </span>
          {simulated ? <SimulatedBadge /> : null}
        </p>
        <p className="mt-1">
          <span className="text-muted">Now: </span>
          <ValueText value={metric.current} />
        </p>
        <p className="mt-1">
          {publication === null ? (
            <span className="text-muted">Not published</span>
          ) : (
            <>
              <span className="font-medium text-success">Published</span>
              <span className="text-muted">
                {` (${publicationSummary(publication.rounding, publication.delayDays)}) since `}
                <time dateTime={publication.publishedAt.toISOString()}>{formatDateTime(publication.publishedAt)}</time>
                {". Public value: "}
              </span>
              <ValueText value={publication.value} />
            </>
          )}
        </p>
        <p className="mt-1">
          <Link href={metric.formulaPath} className="text-muted underline underline-offset-4 hover:text-foreground">
            How it is counted<span className="sr-only">: {metric.label}</span>
          </Link>
        </p>
      </div>
      {canPublish ? (
        <div className="shrink-0">
          {publication === null ? (
            <PublishMetricForm
              workspaceSlug={workspaceSlug}
              projectId={projectId}
              metricId={metric.metricId}
              metricLabel={metric.label}
              roundings={allowedRoundings(metric.unit).map((rounding) => ({ value: rounding, label: ROUNDING_LABELS[rounding] }))}
              delays={DELAY_CHOICES}
              focusId={METRICS_HEADING_ID}
            />
          ) : (
            <UnpublishButton
              workspaceSlug={workspaceSlug}
              publicationId={publication.publicationId}
              label={metric.label}
              focusId={METRICS_HEADING_ID}
            />
          )}
        </div>
      ) : null}
    </li>
  );
}
