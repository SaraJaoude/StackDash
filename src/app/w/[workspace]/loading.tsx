import { PageSkeleton } from "@/components/app/page-skeleton";

// Shown while the workspace segment itself loads; each page also wraps its content in the same
// skeleton so navigations between sections stay instant.
export default function WorkspaceLoading() {
  return <PageSkeleton label="Loading the workspace" />;
}
