import type { Metadata } from "next";

import { EmptyState } from "@/components/app/empty-state";
import { PageHeader } from "@/components/app/page-header";
import { LockIcon, MailIcon } from "@/components/icons";
import { requireWorkspace } from "@/lib/workspaces/access";
import { actionDeniedReason, canPerform, roleLabel } from "@/lib/workspaces/permissions";

import { RenameWorkspaceForm } from "./rename-workspace-form";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage({ params }: PageProps<"/w/[workspace]/settings">) {
  const { workspace: slug } = await params;
  const { user, workspace, role } = await requireWorkspace(slug, "viewer");
  const canRename = canPerform(role, "rename_workspace");

  return (
    <>
      <PageHeader title="Settings" description="This workspace and your access to it." />

      <section aria-labelledby="workspace-name-title" className="mt-8 rounded-xl border border-line bg-panel">
        <h2 id="workspace-name-title" className="border-b border-line px-6 py-4 text-sm font-semibold">
          Name
        </h2>
        {canRename ? (
          <RenameWorkspaceForm workspaceSlug={workspace.slug} currentName={workspace.name} />
        ) : (
          <div className="px-6 py-5 text-sm">
            <p className="break-words">{workspace.name}</p>
            <p className="mt-3 flex items-center gap-2 text-muted">
              <LockIcon className="shrink-0" />
              <span>{actionDeniedReason("rename_workspace")}</span>
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="workspace-details-title" className="mt-6 rounded-xl border border-line bg-panel">
        <h2 id="workspace-details-title" className="border-b border-line px-6 py-4 text-sm font-semibold">
          Workspace details
        </h2>
        <dl className="divide-y divide-line text-sm">
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

      {/* No action: inviting teammates is not built yet, and there is nothing to link to. */}
      <EmptyState
        icon={<MailIcon width={20} height={20} />}
        title="No teammates invited"
        description="Inviting teammates comes after the MVP. For now, each workspace is used by the people already in it."
      />
    </>
  );
}
