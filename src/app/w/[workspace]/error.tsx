"use client";

import Link from "next/link";
import type { ErrorInfo } from "next/error";

import { digestOf, ErrorPanel } from "@/components/app/error-panel";

/** The digest is the reference id (digestOf in error-panel.tsx); the raw message is never shown. */
export default function WorkspaceError({ error, retry }: Pick<ErrorInfo, "error" | "retry">) {
  const referenceId = digestOf(error);
  return (
    <ErrorPanel
      title="Something went wrong loading this page"
      description="This page could not be loaded. Your data is safe. Try again, and if the problem continues, open your workspaces and come back to this page."
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
            Open your workspaces
          </Link>
        </>
      }
    />
  );
}
