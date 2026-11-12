import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { z } from "zod";

import { PageSkeleton } from "@/components/app/page-skeleton";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { AnomalySettings } from "@/components/alerts/anomaly-settings";
import { PageHeader } from "@/components/app/page-header";
import { requireWorkspace } from "@/lib/workspaces/access";
import { workspacePath } from "@/lib/workspaces/paths";

export const metadata: Metadata = { title: "Alert settings" };

// Alert settings (#343), one step from the alerts inbox. Opaque keyset cursors for the rules and
// budgets lists; anything malformed falls back to the first page.
const searchSchema = z.object({
  rulesAfter: z.string().max(200).optional().catch(undefined),
  budgetsAfter: z.string().max(200).optional().catch(undefined),
});

// Every section renders inside its own Suspense boundary so navigating between sections
// has an instant shell; access checks and data reads stream in behind it.
export default function AlertSettingsPage(props: PageProps<"/w/[workspace]/alerts/settings">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <AlertSettingsContent {...props} />
    </Suspense>
  );
}

async function AlertSettingsContent({ params, searchParams }: PageProps<"/w/[workspace]/alerts/settings">) {
  const { workspace: slug } = await params;
  const { user, workspace, role } = await requireWorkspace(slug, "viewer");
  const search = searchSchema.parse(await searchParams);

  return (
    <>
      <p className="mb-4 text-sm">
        <Link
          href={workspacePath(workspace.slug, "alerts")}
          className="text-muted underline-offset-4 hover:text-foreground hover:underline"
        >
          All alerts
        </Link>
      </p>
      <PageHeader
        title="Alert settings"
        description="Thresholds for spend, budgets, and allowances, unusual days, and where alerts go."
      />
      <Suspense
        fallback={
          <p role="status" className="mt-8 text-sm text-muted">
            Loading alert rules, budgets, and where alerts go
          </p>
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
          <p role="status" className="mt-8 text-sm text-muted">
            Loading anomaly detection settings
          </p>
        }
      >
        <AnomalySettings workspace={workspace} role={role} />
      </Suspense>
    </>
  );
}
