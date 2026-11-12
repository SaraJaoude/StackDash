import "server-only";

import { notFound } from "next/navigation";

import { operatorEnv, type OperatorEnv } from "@/lib/env";
import { privacyLink, termsLink, type NavLink } from "@/lib/site";

/*
 * The privacy policy and terms of use (#339) name whoever runs this instance, from server
 * configuration. An instance that names no operator publishes neither page and links to neither,
 * so a self-hosted copy never presents another operator's policy as its own.
 */

/** When the privacy policy or the terms of use last changed. Change it with every edit to either text. */
export const LEGAL_UPDATED = "2026-11-12";

/** The configured operator, or a 404 for an instance that names none. */
export function requireOperator(): OperatorEnv {
  const operator = operatorEnv();
  if (operator === null) notFound();
  return operator;
}

/** The links to both pages, or none when the instance names no operator. */
export function legalLinks(): readonly NavLink[] {
  return operatorEnv() === null ? [] : [privacyLink, termsLink];
}
