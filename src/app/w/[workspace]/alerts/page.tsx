import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { PageSkeleton } from "@/components/app/page-skeleton";
import { AlertSettings } from "@/components/alerts/alert-settings";
import { PageHeader } from "@/components/app/page-header";
import { requireWorkspace } from "@/lib/workspaces/access";

export const metadata: Metadata = { title: "Alerts" };

// Opaque keyset cursors for the two lists; anything malformed falls back to the first page.
const searchSchema = z.object({
  rulesAfter: z.string().max(200).optional().catch(undefined),
  budgetsAfter: z.string().max(200).optional().catch(undefined),
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
  const { workspace, role } = await requireWorkspace(slug, "viewer");
  const search = searchSchema.parse(await searchParams);

  return (
    <>
      <PageHeader
        title="Alerts"
        description="Thresholds for spend, budgets, and allowances, and the alerts they raise."
      />
      <Suspense
        fallback={
          <p role="status" className="mt-8 text-sm text-muted">
            Loading alert rules and budgets
          </p>
        }
      >
        <AlertSettings
          workspace={workspace}
          role={role}
          rulesAfter={search.rulesAfter ?? null}
          budgetsAfter={search.budgetsAfter ?? null}
        />
      </Suspense>
    </>
  );
}
