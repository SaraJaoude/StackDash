// Shown while a workspace page checks access and loads. Shaped like PageHeader plus EmptyState
// so the content does not jump when it arrives.
export default function WorkspaceLoading() {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">Loading this page</span>
      <div aria-hidden="true">
        <div className="border-b border-line pb-6">
          <div className="h-8 w-48 rounded-md bg-panel-raised motion-safe:animate-pulse" />
          <div className="mt-3 h-4 w-full max-w-md rounded bg-panel-raised motion-safe:animate-pulse" />
        </div>
        <div className="mt-8 h-64 rounded-xl border border-dashed border-line bg-panel motion-safe:animate-pulse" />
      </div>
    </div>
  );
}
