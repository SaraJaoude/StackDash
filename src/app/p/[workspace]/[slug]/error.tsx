"use client";

import Link from "next/link";
import type { ErrorInfo } from "next/error";

import { ErrorPanel } from "@/components/app/error-panel";

/**
 * A public project page whose read failed, for example a project past the included account bound
 * of public metrics (#220): no number is shown rather than a smaller one. The visitor is not a
 * member, so the copy names no workspace action. The digest is the reference id Next.js also writes
 * to the server log (see src/app/w/[workspace]/error.tsx); the raw message is never shown.
 */
export default function ProjectPageError({ error, retry }: Pick<ErrorInfo, "error" | "retry">) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : "";
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-6 py-16">
      <ErrorPanel
        title="This project page could not be loaded"
        description="Its public metrics could not be read, so none are shown. Try again in a moment, or go to the home page."
        {...(digest === "" ? {} : { referenceId: digest })}
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
              href="/"
              className="inline-flex min-h-10 items-center rounded-md border border-line-strong px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
            >
              Go to the home page
            </Link>
          </>
        }
      />
    </main>
  );
}
