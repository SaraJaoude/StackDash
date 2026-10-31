import { notFound, redirect } from "next/navigation";

import { isWorkspaceSlug, workspacePath } from "@/lib/workspaces/access";

// The workspace root has no content of its own; the dashboard is its home. Access is checked
// there, so this only refuses slugs that could never be valid.
export default async function WorkspaceIndexPage({ params }: PageProps<"/w/[workspace]">) {
  const { workspace } = await params;
  if (!isWorkspaceSlug(workspace)) notFound();
  redirect(workspacePath(workspace, "dashboard"));
}
