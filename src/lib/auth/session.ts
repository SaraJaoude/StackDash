import "server-only";

import { isAuthSessionMissingError } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { cache } from "react";

import { safeNextPath } from "@/lib/auth/redirect";
import { log } from "@/lib/log/logger";
import { createClient } from "@/lib/supabase/server";

export type SessionUser = { id: string; email: string | null };

/**
 * The signed-in user for this request, or null.
 *
 * Uses `getClaims()`, which verifies the access token signature (and refreshes it when close to
 * expiry), never `getSession()`, which trusts whatever the cookie says. Cached per request so a
 * page, its layout, and its data loaders share one verification.
 */
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  // The session is per request and the auth client reads the clock (token expiry) while it sets
  // up, which Cache Components rejects during prerendering. Waiting for the request first keeps
  // every caller out of the static shell.
  await connection();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error !== null) {
    // No session is the normal signed-out case. Anything else (an expired or forged token, the
    // auth server unreachable) also means we cannot vouch for the user, so treat it as signed out
    // but leave a trace.
    if (!isAuthSessionMissingError(error)) {
      log.warn("auth.claims_rejected", { code: error.code ?? null, status: error.status ?? null });
    }
    return null;
  }
  if (data === null) return null;

  const { sub, email } = data.claims;
  return { id: sub, email: typeof email === "string" && email !== "" ? email : null };
});

/**
 * The signed-in user, or a redirect to sign-in that brings them back to `nextPath` afterwards.
 * Pages call this themselves: the proxy's redirect is a convenience, not authorization.
 */
export async function requireUser(nextPath: string): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (user === null) {
    redirect(`/sign-in?${new URLSearchParams({ next: safeNextPath(nextPath) }).toString()}`);
  }
  return user;
}
