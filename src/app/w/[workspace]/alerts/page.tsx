import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { PageSkeleton } from "@/components/app/page-skeleton";
import { secondaryButtonClass } from "@/components/alerts/form-controls";
import { MovedSettingsRedirect } from "@/components/alerts/moved-settings-redirect";
import { TriggeredAlerts } from "@/components/alerts/triggered-alerts";
import { PageHeader } from "@/components/app/page-header";
import { requireWorkspace } from "@/lib/workspaces/access";
import { alertSettingsPath } from "@/lib/workspaces/paths";

export const metadata: Metadata = { title: "Alerts" };

// The inbox of triggered alerts (#343); rules, budgets, and where alerts go are on alert settings.
// An opaque keyset cursor for the list; anything malformed falls back to the first page.
// `acknowledged=show` includes acknowledged alerts in the list; anything else hides them.
const searchSchema = z.object({
  alertsAfter: z.string().max(200).optional().catch(undefined),
  acknowledged: z.enum(["show"]).optional().catch(undefined),
});

// The list renders inside its own Suspense boundary so navigating between sections has an
// instant shell; access checks and data reads stream in behind it.
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
      <MovedSettingsRedirect workspaceSlug={workspace.slug} />
      <PageHeader
        title="Alerts"
        description="Alerts raised by your rules and budgets, newest first. Rules, budgets, unusual spend and usage, and where alerts go are in alert settings."
        actions={
          <Link href={alertSettingsPath(workspace.slug)} className={secondaryButtonClass}>
            Alert settings
          </Link>
        }
      />
      <Suspense
        fallback={
          <p role="status" className="mt-8 text-sm text-muted">
            Loading triggered alerts
          </p>
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
    </>
  );
}
