"use client";

import Link from "next/link";
import type { ErrorInfo } from "next/error";

import { digestOf, ErrorPanel } from "@/components/app/error-panel";
import { buttonClass } from "@/components/ui/button";

/**
 * A public project page whose read failed, for example a project past the included account bound
 * of public metrics (#220): no number is shown rather than a smaller one. The visitor is not a
 * member, so the copy names no workspace action. The digest is the reference id (digestOf in
 * src/components/app/error-panel.tsx); the raw message is never shown.
 */
export default function ProjectPageError({ error, retry }: Pick<ErrorInfo, "error" | "retry">) {
  const referenceId = digestOf(error);
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-6 py-16">
      <ErrorPanel
        title="This project page could not be loaded"
        description="Its public metrics could not be read, so none are shown. Try again in a moment, or go to the home page."
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
              href="/"
              className={buttonClass("secondary")}
            >
              Go to the home page
            </Link>
          </>
        }
      />
    </main>
  );
}
