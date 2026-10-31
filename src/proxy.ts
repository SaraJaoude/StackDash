import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isAppPath, safeNextPath } from "@/lib/auth/redirect";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

// Enforced on every proxied response: the directives that do not depend on scripts. Identical to
// the static landing policy in next.config.ts (e2e/auth.spec.ts asserts they match).
// frame-ancestors is ignored in report-only mode, so it must stay in the enforced header.
const ENFORCED_CSP = "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";

/**
 * Builds the per-request nonce policy. Next.js reads the nonce from the request's CSP header and
 * stamps it on the scripts it renders per request, so no page code has to handle it.
 */
function contentSecurityPolicy(nonce: string, supabaseUrl: URL): string {
  const isDev = process.env.NODE_ENV === "development";
  const supabaseOrigin = supabaseUrl.origin;
  const supabaseSocket = `${supabaseUrl.protocol === "https:" ? "wss:" : "ws:"}//${supabaseUrl.host}`;

  return [
    "default-src 'self'",
    // No 'strict-dynamic': Next.js loads its chunks from this origin, and 'self' keeps them allowed.
    // 'unsafe-eval' only in development, where React rebuilds server error stacks with eval (per the
    // Next.js CSP guide); production policy never includes it.
    `script-src 'self' 'nonce-${nonce}'${isDev ? " 'unsafe-eval'" : ""}`,
    // Development injects unnonced style tags for hot reloading, as the Next.js CSP guide notes.
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    // Style attributes cannot carry a nonce, and server-rendered usage bars set their width with
    // one. Attributes cannot run script, so allowing them does not reopen script injection.
    "style-src-attr 'unsafe-inline'",
    // GitHub avatars appear next to the signed-in user.
    "img-src 'self' blob: data: https://avatars.githubusercontent.com",
    "font-src 'self'",
    `connect-src 'self' ${supabaseOrigin} ${supabaseSocket}`,
    "object-src 'none'",
    "base-uri 'self'",
    // Without JavaScript the sign-in form posts, then redirects through Supabase Auth to GitHub;
    // browsers apply form-action to every hop of that redirect chain. The enforced policy keeps
    // form-action 'self' for now, so only the JavaScript path (a fetch, then a navigation) works.
    `form-action 'self' ${supabaseOrigin} https://github.com`,
    "frame-ancestors 'none'",
    // Local Supabase serves plain http on 127.0.0.1, which this directive would break.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/**
 * Refreshes the Supabase session cookie, bounces signed-out visitors away from app pages, and sets
 * the CSP headers. This is not authorization: every page, Server Function, and route handler still
 * checks the user itself, because a matcher can drift and silently stop covering a path.
 */
export async function proxy(request: NextRequest) {
  const { NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY } = publicEnv();

  // Cookie writes are collected and applied to whichever response this request ends with.
  const cookiesToApply: { name: string; value: string; options: CookieOptions }[] = [];
  const headersToApply: Record<string, string> = {};

  const supabase = createServerClient<Database>(
    NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          // Updating the request cookies forwards the refreshed tokens to this request's render,
          // so Server Components do not try (and fail) to refresh the same single-use token.
          for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
          cookiesToApply.push(...cookiesToSet);
          Object.assign(headersToApply, headers);
        },
      },
    },
  );

  // Verifies the access token and refreshes it when it is close to expiry. Run before deciding
  // anything else so a refresh is never lost to an early return.
  const { data } = await supabase.auth.getClaims();
  const signedIn = data !== null;

  const { pathname, search } = request.nextUrl;
  let response: NextResponse;
  if (!signedIn && isAppPath(pathname)) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", safeNextPath(`${pathname}${search}`));
    response = NextResponse.redirect(signIn);
  } else {
    const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
    const policy = contentSecurityPolicy(nonce, new URL(NEXT_PUBLIC_SUPABASE_URL));
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("Content-Security-Policy", policy);
    response = NextResponse.next({ request: { headers: requestHeaders } });
    // Report-only for now: with Cache Components the static shell is prerendered at build time,
    // so its inline scripts carry no nonce, and enforcing the nonce policy stops app pages from
    // hydrating (the Next.js CSP guide notes partial prerendering is incompatible with nonces).
    // There is no reporting endpoint yet, so violations only show in the browser console; issue
    // #125 tracks collecting reports and moving to enforcement.
    response.headers.set("Content-Security-Policy-Report-Only", policy);
    response.headers.set("Content-Security-Policy", ENFORCED_CSP);
  }

  for (const { name, value, options } of cookiesToApply) response.cookies.set(name, value, options);
  // Cache-Control: private, no-store when auth cookies change, so no CDN serves one user's tokens
  // to another.
  for (const [key, value] of Object.entries(headersToApply)) response.headers.set(key, value);
  return response;
}

// Only the signed-in app, the account page, and the auth pages. The landing page, the signed-out
// /account/deleted page, API routes, and static assets stay out: they need no session refresh, and
// a nonce would force the static landing page to render per request. next.config.ts applies the
// static CSP to every path NOT listed here; keep them in sync.
export const config = {
  matcher: ["/app", "/app/:path*", "/w/:path*", "/account", "/sign-in", "/auth/:path*"],
};
