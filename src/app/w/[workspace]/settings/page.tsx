import type { Metadata } from "next";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { MailIcon } from "@/components/icons";
import { site } from "@/lib/site";
import { requireWorkspace } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform, roleLabel } from "@/lib/workspaces/permissions";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/w/[workspace]/settings">) {
  const { workspace: slug } = await params;
  const { user, workspace, role } = await requireWorkspace(slug, "viewer");
  const canManageMembers = canPerform(role, "manage_members");

  return (
    <>
      <PageHeader title="Settings" description="This workspace and your access to it." />

      <section aria-labelledby="workspace-details-title" className="mt-8 rounded-xl border border-line bg-panel">
        <h2 id="workspace-details-title" className="border-b border-line px-6 py-4 text-sm font-semibold">
          Workspace details
        </h2>
        <dl className="divide-y divide-line text-sm">
          <div className="grid gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
            <dt className="text-muted">Name</dt>
            <dd className="break-words sm:col-span-2">{workspace.name}</dd>
          </div>
          <div className="grid gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
            <dt className="text-muted">Workspace ID</dt>
            <dd className="font-mono sm:col-span-2">{workspace.slug}</dd>
          </div>
          <div className="grid gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
            <dt className="text-muted">Your role</dt>
            <dd className="sm:col-span-2">{roleLabel(role)}</dd>
          </div>
          <div className="grid gap-1 px-6 py-4 sm:grid-cols-3 sm:gap-4">
            <dt className="text-muted">Signed in as</dt>
            <dd className="break-words sm:col-span-2">{user.email ?? "No email address on record"}</dd>
          </div>
        </dl>
      </section>

      <EmptyState
        icon={<MailIcon width={20} height={20} />}
        title="No teammates invited"
        description="Inviting teammates is not available in this test yet. If your team needs it, request it on GitHub so it is prioritized."
        action={{ href: `${site.githubUrl}/issues`, label: "Request team invites" }}
        deniedReason={canManageMembers ? undefined : actionDeniedReason("manage_members")}
      />
    </>
  );
}
