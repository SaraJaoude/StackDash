"use client";

import { useFormStatus } from "react-dom";

import { GitHubIcon } from "@/components/icons";

function ContinueButton() {
  // Leaving for GitHub takes a moment; say so, and stop a second click from starting a second flow.
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="submit"
        disabled={pending}
        aria-describedby="sign-in-status"
        className="inline-flex min-h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-accent px-5 py-3 text-sm font-medium text-background transition-opacity hover:opacity-85 disabled:cursor-wait disabled:opacity-60"
      >
        <GitHubIcon />
        Continue with GitHub
      </button>
      <p id="sign-in-status" role="status" aria-live="polite" className="mt-3 min-h-5 text-center text-xs text-muted">
        {pending ? "Opening GitHub sign-in" : ""}
      </p>
    </>
  );
}

/** The one sign-in action. `action` is a Server Function with the return path already bound. */
export function SignInForm({ action }: { action: () => Promise<void> }) {
  return (
    <form action={action}>
      <ContinueButton />
    </form>
  );
}
