"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { deleteAccount, type DeleteAccountResult } from "@/app/account/actions";
import { GuardedButton } from "@/components/guarded-button";
import { confirmationMatches, type AccountIdentity } from "@/lib/account/delete-account";

const DANGER =
  "inline-flex min-h-10 shrink-0 items-center justify-center rounded-md bg-danger px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50";

/**
 * The last step of account deletion: typing the account email or GitHub username enables the
 * button. The server checks the same thing again and rebuilds the plan, so this is only a guard
 * against a slip, not authorization.
 */
export function DeleteAccountForm({ identity }: { identity: AccountIdentity }) {
  const [state, formAction, pending] = useActionState<DeleteAccountResult | null, FormData>(deleteAccount, null);
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const fieldError = state?.fieldErrors?.confirmation;
  const matches = confirmationMatches(typed, identity);

  // A refused confirmation sends focus back to the field so it can be corrected at once.
  useEffect(() => {
    if (fieldError !== undefined) inputRef.current?.focus();
  }, [state, fieldError]);

  const accepted = [identity.email, identity.userName].filter((value): value is string => value !== null);

  return (
    <form action={formAction} className="flex flex-col gap-3">
      <label htmlFor={inputId} className="text-sm font-medium">
        Type your email address or GitHub username to confirm
      </label>
      <p id={hintId} className="text-sm text-muted">
        {accepted.length === 0 ? (
          "No email address or username is on record, so this account cannot be confirmed here."
        ) : (
          <>
            Type{" "}
            {accepted.map((value, index) => (
              <span key={value}>
                {index > 0 ? " or " : null}
                <code className="font-mono text-foreground">{value}</code>
              </span>
            ))}
            .
          </>
        )}
      </p>
      <input
        ref={inputRef}
        id={inputId}
        name="confirmation"
        type="text"
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        value={typed}
        onChange={(event) => setTyped(event.target.value)}
        aria-invalid={fieldError === undefined ? undefined : true}
        aria-describedby={fieldError === undefined ? hintId : `${hintId} ${errorId}`}
        className="min-h-10 w-full max-w-md rounded-md border border-line-strong bg-panel-raised px-3 py-2 text-sm"
      />
      {fieldError === undefined ? null : (
        <p id={errorId} className="text-sm text-danger">
          <span className="font-medium">Error: </span>
          {fieldError}
        </p>
      )}
      <div>
        {/* Native disabled until the confirmation matches, while focus is still in the field;
            only unavailable while deleting, so a keyboard press keeps focus on the button (#161). */}
        <GuardedButton type="submit" disabled={!matches} unavailable={pending} className={DANGER}>
          {pending ? "Deleting your account" : "Delete my account"}
        </GuardedButton>
      </div>
      {/* Always mounted, so screen readers announce progress and the result. */}
      <div role="status" aria-live="polite" className="text-sm">
        {pending ? (
          <p className="text-muted">Deleting your account. This can take a few seconds while providers respond.</p>
        ) : state === null || fieldError !== undefined ? null : (
          <p className="text-danger">
            {state.message}
            {state.referenceId === undefined ? null : (
              <>
                {" "}
                Reference <code className="font-mono text-xs text-foreground">{state.referenceId}</code>.
              </>
            )}
          </p>
        )}
      </div>
    </form>
  );
}
