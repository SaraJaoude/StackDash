"use client";

import { useEffect, useRef } from "react";

import type { ProjectActionResult } from "@/app/w/[workspace]/projects/actions";

type Failure = Extract<ProjectActionResult, { ok: false }>;

/** The failed result of a form action, or undefined when it has not failed. */
export function failureOf(state: ProjectActionResult | null): Failure | undefined {
  return state !== null && !state.ok ? state : undefined;
}

/**
 * The name input used by the create and rename forms. Controlled by the parent so a rejected
 * name stays in the box for correcting (React resets uncontrolled fields after a form action).
 * Limits are enforced by the server, not `maxLength`/`required`, so the error explains the rule.
 */
export function ProjectNameField({
  id,
  label,
  hint,
  value,
  onChange,
  error,
  autoFocus = false,
}: {
  id: string;
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  error: string | undefined;
  autoFocus?: boolean;
}) {
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  return (
    <div className="min-w-0 flex-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <p id={hintId} className="mt-1 text-sm text-muted">
        {hint}
      </p>
      <input
        id={id}
        name="name"
        type="text"
        autoComplete="off"
        // Only the empty state asks for this: the form is the one thing to do on that page.
        autoFocus={autoFocus}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={error === undefined ? hintId : `${hintId} ${errorId}`}
        className={`mt-2 block min-h-10 w-full rounded-md border bg-panel-raised px-3 py-2 text-sm text-foreground ${
          error === undefined ? "border-line-strong" : "border-danger"
        }`}
      />
      {error === undefined ? null : (
        <p id={errorId} className="mt-2 text-sm text-danger">
          <span className="font-medium">Error: </span>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Shown when a submit fails, and focused so keyboard and screen reader users land on what went
 * wrong. A field error links to its field; an unexpected error carries the reference id.
 */
export function FormErrorSummary({ failure, fieldId }: { failure: Failure | undefined; fieldId?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  // Every submit returns a new result object, so a repeated failure moves focus again.
  useEffect(() => {
    if (failure !== undefined) ref.current?.focus();
  }, [failure]);

  if (failure === undefined) return null;
  const hasFieldError = fieldId !== undefined && failure.fieldErrors?.name !== undefined;
  return (
    <div
      ref={ref}
      tabIndex={-1}
      className="mt-3 rounded-md border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      {hasFieldError ? (
        <a href={`#${fieldId}`} className="underline underline-offset-2">
          {failure.message}
        </a>
      ) : (
        <p>
          {failure.message}
          {failure.referenceId === undefined ? null : (
            <>
              {" "}
              Reference <code className="font-mono text-xs text-foreground">{failure.referenceId}</code>.
            </>
          )}
        </p>
      )}
    </div>
  );
}
