import Link from "next/link";

import { buttonClass } from "@/components/ui/button";

// One response for a workspace that does not exist and one the user is not a member of, so the
// page never confirms which workspace addresses are real.
export default function WorkspaceNotFound() {
  return (
    <div className="mx-auto max-w-xl rounded-xl border border-line bg-panel px-6 py-10 sm:px-10">
      <p className="font-mono text-[11px] font-medium text-muted">Not found</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">We could not find that workspace</h1>
      <p className="mt-3 text-sm leading-6 text-muted">
        The link may be mistyped, or you may not be a member of this workspace. Check the address, or
        ask a workspace owner to invite you. You can open any workspace you already belong to.
      </p>
      <div className="mt-6">
        <Link
          href="/app"
          className={buttonClass("primary")}
        >
          Open your workspaces
        </Link>
      </div>
    </div>
  );
}
