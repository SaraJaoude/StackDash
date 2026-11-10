import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { isProviderSimulationEnabled } from "@/lib/adapters/simulated";
import { safeNextPath, signInErrorUrl, type SignInErrorCode } from "@/lib/auth/redirect";
import { demoCommandRefusal } from "@/lib/demo/history";
import { DEMO_SIGN_IN_OTP_TYPE, isDemoAccount } from "@/lib/demo/sign-in";
import { log, logError } from "@/lib/log/logger";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

function signInWithError(request: NextRequest, error: SignInErrorCode, next: string, referenceId?: string) {
  return NextResponse.redirect(signInErrorUrl(request.url, error, next, referenceId), 303);
}

/** Ends the session the link just started. A failure is logged; the caller refuses the link either way. */
async function endSession(supabase: SupabaseClient<Database>): Promise<void> {
  const { error } = await supabase.auth.signOut({ scope: "local" });
  if (error !== null) logError("auth.demo_link_sign_out_failed", error);
}

/**
 * Consumes the one-time sign-in link `npm run demo` prints for the demo account (#260): verifies
 * its token hash with Supabase Auth, which sets the session cookies, then continues to `next`.
 *
 * Only where the demo commands may run (`demoCommandRefusal`: provider simulation on, which a
 * Vercel production deployment never is, and Supabase on this computer). Everywhere else, and for
 * a link that is missing, used, expired, or not the demo account's, the answer is the same
 * redirect, so nothing tells a refused link from a bad one. The token is never logged.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const next = safeNextPath(params.get("next"));
  const tokenHash = params.get("token_hash");

  const refusal = demoCommandRefusal({
    simulationEnabled: isProviderSimulationEnabled(),
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  });
  if (refusal !== null) {
    log.info("auth.demo_link_refused");
    return signInWithError(request, "link_invalid", next);
  }
  if (tokenHash === null || tokenHash === "" || params.get("type") !== DEMO_SIGN_IN_OTP_TYPE) {
    return signInWithError(request, "link_invalid", next);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: DEMO_SIGN_IN_OTP_TYPE });
  if (error !== null) {
    // Supabase Auth answers a used, expired, or unknown token with a 4xx (otp_expired). Anything
    // else (the auth server down or failing) is not the link's fault.
    if (error.status !== undefined && error.status >= 400 && error.status < 500) {
      log.info("auth.demo_link_rejected", { code: error.code ?? null, status: error.status });
      return signInWithError(request, "link_invalid", next);
    }
    const referenceId = logError("auth.demo_link_verify_failed", error);
    return signInWithError(request, "link_failed", next, referenceId);
  }

  // The verified session, never the session verifyOtp returned: getClaims checks the new access
  // token. The link only ever signs in the account the demo seed made (its app_metadata marker,
  // which only the service role can set); any other account's session is ended straight away.
  const { data, error: claimsError } = await supabase.auth.getClaims();
  if (claimsError !== null || data === null) {
    const referenceId = logError("auth.demo_link_claims_failed", claimsError ?? new Error("No session after verifying the link"));
    await endSession(supabase);
    return signInWithError(request, "link_failed", next, referenceId);
  }
  if (!isDemoAccount(data.claims.app_metadata)) {
    log.warn("auth.demo_link_not_demo_account");
    await endSession(supabase);
    return signInWithError(request, "link_invalid", next);
  }

  // `next` is allow-listed to app paths, so this never leaves the site.
  return NextResponse.redirect(new URL(next, request.url), 303);
}
