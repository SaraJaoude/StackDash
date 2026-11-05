import Link from "next/link";

// An address inside a workspace with no page behind it. The same response for every workspace
// slug, member or not, so the page never confirms which workspace addresses are real.
export default function WorkspacePageNotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-line bg-panel px-6 py-10 sm:px-10">
      <p className="font-mono text-[11px] font-medium text-muted">Not found</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">We could not find that page</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        The address may be mistyped, or the page may have moved. Check the address, or open one of the
        workspaces you belong to.
      </p>
      <div className="mt-6">
        <Link
          href="/app"
          className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85"
        >
          Open your workspaces
        </Link>
      </div>
    </div>
  );
}
