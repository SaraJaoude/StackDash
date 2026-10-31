import { NextResponse } from "next/server";

import {
  FAKE_CALLBACK_PATH,
  FAKE_CODE_PREFIX,
  FAKE_PROVIDER_ENABLE_ENV,
  FakeModeSchema,
  fakeScopes,
  parseFakeScopes,
} from "@/lib/adapters/fake";

function plainText(message: string, status: number): NextResponse {
  return new NextResponse(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/**
 * Consent screen of the fake provider (#40), for tests and e2e only. It approves at once and
 * redirects to DevMacro's own fake callback, so the connect flow runs end to end without a real
 * OAuth app. Test switches in the query:
 * - `decline=usage:read` (space-separated scopes): the user unticked those scopes.
 * - `error=access_denied`: the user pressed Cancel.
 * - `mode=rate_limited|revoked|unavailable`: forwarded so later calls on the connection fail.
 *
 * Read on every request, not at module load, so the flag cannot be baked into a build.
 */
export function GET(request: Request): NextResponse {
  if (process.env[FAKE_PROVIDER_ENABLE_ENV] !== "1") return plainText("Not found", 404);

  const requestUrl = new URL(request.url);
  const query = requestUrl.searchParams;

  const state = query.get("state");
  if (state === null || state.length === 0) return plainText("Missing state.", 400);

  // The redirect target must be DevMacro's own fake callback: anything else is an open redirect.
  const callback = new URL(FAKE_CALLBACK_PATH, requestUrl.origin);
  if (query.get("redirect_uri") !== callback.href) {
    return plainText(`redirect_uri must be ${callback.href}.`, 400);
  }
  callback.searchParams.set("state", state);

  const error = query.get("error");
  if (error !== null) {
    if (error !== "access_denied") return plainText("Only error=access_denied is supported.", 400);
    callback.searchParams.set("error", "access_denied");
    return NextResponse.redirect(callback, 302);
  }

  const requestedText = query.get("scope") ?? "";
  const requested = parseFakeScopes(requestedText);
  const declinedText = query.get("decline") ?? "";
  const declined = parseFakeScopes(declinedText);
  // Unknown scope names are rejected rather than dropped, so a typo in a test fails loudly.
  const known: ReadonlySet<string> = new Set(fakeScopes);
  const unknown = [...requestedText.split(/\s+/), ...declinedText.split(/\s+/)].filter(
    (scope) => scope.length > 0 && !known.has(scope),
  );
  if (requested.length === 0 || unknown.length > 0) {
    return plainText(`scope and decline may only list: ${fakeScopes.join(", ")}.`, 400);
  }

  const mode = query.get("mode");
  if (mode !== null) {
    if (!FakeModeSchema.safeParse(mode).success) return plainText("Unknown mode.", 400);
    callback.searchParams.set("mode", mode);
  }

  callback.searchParams.set("code", `${FAKE_CODE_PREFIX}${crypto.randomUUID()}`);
  callback.searchParams.set("granted_scope", requested.filter((scope) => !declined.includes(scope)).join(" "));
  return NextResponse.redirect(callback, 302);
}
