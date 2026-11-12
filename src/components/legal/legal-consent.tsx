import Link from "next/link";

import { operatorEnv } from "@/lib/env";
import { privacyLink, termsLink } from "@/lib/site";

const LINK_CLASS = "text-foreground underline underline-offset-2 transition-colors hover:text-accent";

/**
 * The line beside the sign-in button (#339). Only where this instance names an operator: an instance
 * that names none publishes no terms or policy to agree to.
 */
export function LegalConsent() {
  if (operatorEnv() === null) return null;
  return (
    <p className="mt-1 text-center text-xs leading-5 text-muted">
      By continuing, you agree to the{" "}
      <Link href={termsLink.href} className={LINK_CLASS}>
        terms of use
      </Link>{" "}
      and confirm you have read the{" "}
      <Link href={privacyLink.href} className={LINK_CLASS}>
        privacy policy
      </Link>
      .
    </p>
  );
}
