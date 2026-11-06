import type { ReactNode } from "react";

/**
 * The reference id of an error that reached an `error.tsx` boundary, or undefined. Errors from
 * Server Components reach the client with their message replaced and a `digest` that Next.js also
 * writes to the server log, so the digest is the reference id support uses to find the failure.
 * `error.message` is never shown: in development it holds the raw server message, and client-side
 * errors are not scrubbed at all.
 */
export function digestOf(error: unknown): string | undefined {
  if (error instanceof Error && "digest" in error && typeof error.digest === "string" && error.digest !== "") {
    return error.digest;
  }
  return undefined;
}

/**
 * Explains a failure in plain words: what happened, what to do next, and, for unexpected errors,
 * a reference id that matches the server logs. Never pass raw error messages, stack traces, SQL,
 * or provider error codes into it.
 */
export function ErrorPanel({
  title,
  description,
  referenceId,
  actions,
}: {
  title: string;
  description: string;
  referenceId?: string;
  actions?: ReactNode;
}) {
  return (
    <div role="alert" className="mx-auto max-w-xl rounded-xl border border-danger/40 bg-panel px-6 py-10 sm:px-10">
      <p className="font-mono text-[11px] font-medium text-danger">Error</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-3 text-sm leading-6 text-muted">{description}</p>
      {referenceId === undefined ? null : (
        <p className="mt-4 text-sm leading-6 text-muted">
          If this keeps happening, contact support and quote reference{" "}
          <code className="select-all rounded border border-line bg-panel-raised px-1.5 py-0.5 font-mono text-xs text-foreground">
            {referenceId}
          </code>
          . It lets us find what went wrong in our server logs.
        </p>
      )}
      {actions === undefined ? null : <div className="mt-6 flex flex-wrap gap-3">{actions}</div>}
    </div>
  );
}
