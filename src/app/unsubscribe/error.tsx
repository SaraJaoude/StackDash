"use client";

import type { ErrorInfo } from "next/error";

import { UnsubscribeCard } from "./unsubscribe-form";

/**
 * A failed read on the unsubscribe page. Nothing has changed. The digest is the reference id
 * Next.js also writes to the server log (see src/app/w/[workspace]/error.tsx); the raw message is
 * never shown.
 */
export default function UnsubscribeError({ error, retry }: Pick<ErrorInfo, "error" | "retry">) {
  const digest = error instanceof Error && "digest" in error && typeof error.digest === "string" ? error.digest : "";
  return (
    <UnsubscribeCard>
      <div role="alert" className="text-sm leading-6">
        <p>DevMacro could not check your alert emails, so nothing has changed. Try again in a moment.</p>
        {digest === "" ? null : (
          <p className="mt-2 text-muted">
            If it keeps happening, share reference <span className="font-mono text-foreground">{digest}</span>.
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => retry()}
        className="mt-6 inline-flex min-h-11 items-center rounded-lg bg-accent px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85"
      >
        Try again
      </button>
    </UnsubscribeCard>
  );
}
