"use client";

import { useActionState, useEffect, useId, useRef, type SubmitEvent } from "react";

import { signUp, type SignupState } from "@/app/signup-action";

const initialState: SignupState = { status: "idle" };

/**
 * The launch list signup (#440). It posts as a plain form before hydration or without
 * JavaScript. After a failed submit, focus moves to the field, whose message is tied to it; after
 * a saved one, the form is replaced by the confirmation, which takes focus.
 */
export function SignupForm({ purpose }: { purpose: string }) {
  const [state, formAction, pending] = useActionState(signUp, initialState);
  const inputId = useId();
  const messageId = useId();
  const emailRef = useRef<HTMLInputElement>(null);
  const startedRef = useRef<HTMLInputElement>(null);
  const savedRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (startedRef.current !== null && startedRef.current.value === "") startedRef.current.value = String(Date.now());
  }, []);

  useEffect(() => {
    if (state.status === "invalid" || state.status === "failed") emailRef.current?.focus();
    if (state.status === "saved") savedRef.current?.focus();
  }, [state]);

  if (state.status === "saved") {
    return (
      <p ref={savedRef} tabIndex={-1} role="status" className="mt-4 text-left text-sm font-medium text-success">
        You are on the list for the launch email and occasional progress updates.
      </p>
    );
  }

  const message =
    state.status === "invalid"
      ? "Enter an email address like name@example.com."
      : state.status === "failed"
        ? `We could not save your email address. Try again in a few minutes. Reference ${state.reference}.`
        : null;

  // Keeps focus on the button while saving (aria-disabled, not disabled) without sending twice.
  const blockWhilePending = (event: SubmitEvent<HTMLFormElement>) => {
    if (pending) event.preventDefault();
  };

  return (
    <form action={formAction} onSubmit={blockWhilePending} noValidate className="mt-4 text-left">
      <label htmlFor={inputId} className="block text-sm font-medium">
        {purpose}
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          ref={emailRef}
          id={inputId}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          maxLength={320}
          defaultValue={state.status === "idle" ? "" : state.email}
          aria-invalid={message !== null || undefined}
          aria-describedby={message !== null ? messageId : undefined}
          placeholder="name@example.com"
          className="min-h-10 flex-1 rounded-lg border border-line-strong bg-background px-3 text-sm text-foreground placeholder:text-muted aria-invalid:border-danger"
        />
        <button
          type="submit"
          aria-disabled={pending || undefined}
          className="min-h-10 rounded-lg bg-accent px-4 text-sm font-medium text-background transition-opacity hover:opacity-85 aria-disabled:opacity-70"
        >
          {pending ? "Saving…" : "Join the list"}
        </button>
      </div>

      {/* Honeypot: hidden from people and assistive tech; a bot that fills it is ignored. */}
      <div aria-hidden="true" className="absolute -left-[9999px] size-px overflow-hidden">
        <label htmlFor={`${inputId}-website`}>Leave this field empty</label>
        <input id={`${inputId}-website`} name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
      </div>
      <input ref={startedRef} type="hidden" name="started" defaultValue="" />

      <p id={messageId} aria-live="assertive" className="mt-2 text-sm text-danger empty:hidden">
        {message}
      </p>
    </form>
  );
}
