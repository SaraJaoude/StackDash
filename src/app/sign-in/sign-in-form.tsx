"use client";

import { useFormStatus } from "react-dom";

import { GuardedButton } from "@/components/guarded-button";
import { GitHubIcon } from "@/components/icons";
import { buttonClass } from "@/components/ui/button";

function ContinueButton() {
  // Leaving for GitHub takes a moment; say so, and stop a second click from starting a second flow.
  const { pending } = useFormStatus();
  return (
    <>
      <GuardedButton
        type="submit"
        unavailable={pending}
        aria-describedby="sign-in-status"
        className={`${buttonClass("primary", "lg")} w-full gap-2.5 aria-disabled:cursor-wait`}
      >
        <GitHubIcon />
        Continue with GitHub
      </GuardedButton>
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
