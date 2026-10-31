import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { ArrowRightIcon, PlugIcon } from "@/components/icons";
import type { Database } from "@/lib/supabase/database.types";
import { requireWorkspace, workspacePath } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Connections" };

type ProviderId = Database["public"]["Enums"]["provider_id"];

// The providers a person can pick. `fake` exists only for tests, so it is never offered here.
const PROVIDERS = [
  { id: "vercel", name: "Vercel" },
  { id: "github", name: "GitHub" },
  { id: "resend", name: "Resend" },
  { id: "stripe", name: "Stripe" },
  { id: "supabase", name: "Supabase" },
] as const satisfies readonly { id: Exclude<ProviderId, "fake">; name: string }[];

export default async function ConnectionsPage({ params }: PageProps<"/w/[workspace]/connections">) {
  const { workspace: slug } = await params;
  const { workspace, role } = await requireWorkspace(slug, "viewer");
  const canConnect = canPerform(role, "manage_connections");
  const connectionsPath = workspacePath(workspace.slug, "connections");

  return (
    <>
      <PageHeader
        title="Connections"
        description="The providers this workspace reads usage, spend, and activity from."
      />
      <EmptyState
        icon={<PlugIcon width={20} height={20} />}
        title="No connections yet"
        description={
          canConnect
            ? "Choose a provider to connect first. You can add the others at any time."
            : "Once an owner or admin connects a provider, it is listed here."
        }
        deniedReason={canConnect ? undefined : actionDeniedReason("manage_connections")}
      >
        {canConnect ? (
          <ul aria-label="Providers you can connect" className="mx-auto mt-6 grid max-w-xl gap-2 text-left sm:grid-cols-2">
            {PROVIDERS.map((provider) => (
              <li key={provider.id}>
                <Link
                  href={`${connectionsPath}/${provider.id}`}
                  className="flex min-h-11 items-center justify-between gap-3 rounded-lg border border-line bg-panel-raised px-4 py-2.5 text-sm transition-colors hover:border-line-strong"
                >
                  <span>Connect {provider.name}</span>
                  <ArrowRightIcon className="shrink-0 text-muted" />
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </EmptyState>
    </>
  );
}
