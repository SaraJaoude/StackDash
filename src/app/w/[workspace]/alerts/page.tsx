import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { PageSkeleton } from "@/components/app/page-skeleton";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { AnomalySettings } from "@/components/alerts/anomaly-settings";
import { TriggeredAlerts } from "@/components/alerts/triggered-alerts";
import { PageHeader } from "@/components/app/page-header";
import { LiveRegion } from "@/components/ui/live-region";
import { requireWorkspace } from "@/lib/workspaces/access";

export const metadata: Metadata = { title: "Alerts" };

// Opaque keyset cursors for the three lists; anything malformed falls back to the first page.
// `acknowledged=show` includes acknowledged alerts in the triggered list; anything else hides them.
const searchSchema = z.object({
  rulesAfter: z.string().max(200).optional().catch(undefined),
  budgetsAfter: z.string().max(200).optional().catch(undefined),
  alertsAfter: z.string().max(200).optional().catch(undefined),
  acknowledged: z.enum(["show"]).optional().catch(undefined),
});

// Every section renders inside its own Suspense boundary so navigating between sections
// has an instant shell; access checks and data reads stream in behind it.
export default function AlertsPage(props: PageProps<"/w/[workspace]/alerts">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlertsContent {...props} />
    </Suspense>
  );
}

async function AlertsContent({ params, searchParams }: PageProps<"/w/[workspace]/alerts">) {
  const { workspace: slug } = await params;
  const { user, workspace, role } = await requireWorkspace(slug, "viewer");
  const search = searchSchema.parse(await searchParams);

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Thresholds for spend, budgets, and allowances, the alerts they raise, and unusual days."
      />
      <Suspense
        fallback={
          <LiveRegion tone="status" as="p" className="mt-8 text-sm text-muted">
            Loading triggered alerts
          </LiveRegion>
        }
      >
        <TriggeredAlerts
          workspace={workspace}
          role={role}
          userId={user.id}
          showAcknowledged={search.acknowledged === "show"}
          after={search.alertsAfter ?? null}
        />
      </Suspense>
      <Suspense
        fallback={
          <LiveRegion tone="status" as="p" className="mt-8 text-sm text-muted">
            Loading alert rules, budgets, and where alerts go
          </LiveRegion>
        }
      >
        <AlertSettings
          workspace={workspace}
          role={role}
          userId={user.id}
          rulesAfter={search.rulesAfter ?? null}
          budgetsAfter={search.budgetsAfter ?? null}
        />
      </Suspense>
      <Suspense
        fallback={
          <LiveRegion tone="status" as="p" className="mt-8 text-sm text-muted">
            Loading anomaly detection settings
          </LiveRegion>
        }
      >
        <AnomalySettings workspace={workspace} role={role} />
      </Suspense>
    </>
  );
}
