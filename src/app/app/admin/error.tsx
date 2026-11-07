"use client";

import Link from "next/link";
import type { ErrorInfo } from "next/error";

import { digestOf, ErrorPanel } from "@/components/app/error-panel";

/** The digest is the reference id (digestOf in error-panel.tsx); the raw message is never shown. */
export default function AdminError({ error, retry }: Pick<ErrorInfo, "error" | "retry">) {
  const referenceId = digestOf(error);
  return (
    <main id="main" className="flex flex-1 flex-col justify-center px-4 py-16">
      <ErrorPanel
        title="The instance overview could not be loaded"
        description="Reading the figures or the configuration failed, and nothing was changed. Try again; if it keeps failing, the server log has the details under the reference below."
        {...(referenceId === undefined ? {} : { referenceId })}
        actions={
          <>
            <button
              type="button"
              onClick={() => retry()}
              className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85"
            >
              Try again
            </button>
            <Link
              href="/app"
              className="inline-flex min-h-10 items-center rounded-md border border-line-strong px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
            >
              Open your workspace
            </Link>
          </>
        }
      />
    </main>
  );
}
