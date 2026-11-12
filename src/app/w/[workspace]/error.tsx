"use client";

import Link from "next/link";
import type { ErrorInfo } from "next/error";

import { digestOf, ErrorPanel } from "@/components/app/error-panel";
import { buttonClass } from "@/components/ui/button";

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
            className={buttonClass("primary")}
          >
            Try again
          </button>
          <Link
            href="/app"
            className={buttonClass("secondary")}
          >
            Open your workspaces
          </Link>
        </>
      }
    />
  );
}
