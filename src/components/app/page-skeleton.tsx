/**
 * Placeholder for a workspace page while it checks access and loads, shaped like PageHeader plus
 * a content panel so nothing jumps when the page arrives. Every page under /w/[workspace] renders
 * its content inside `<Suspense fallback={<PageSkeleton label="Loading ..." />}>`, which gives each
 * navigation an instant shell under Cache Components. `label` names what is loading ("Loading the
 * timeline"), because a screen reader hears only that line.
 */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
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
