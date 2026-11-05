import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { isAppPath, safeNextPath } from "@/lib/auth/redirect";
import { publicEnv } from "@/lib/env";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Where a form on an app page may lead. Browsers apply form-action to every redirect hop of a
 * form submission, so the list names where that chain goes: without JavaScript the sign-in form
 * posts, then redirects through Supabase Auth to GitHub. The connect form's start route answers
 * with a page that moves on to the provider by meta refresh, a navigation form-action does not
 * govern, so no provider origin belongs here. The landing page has no such form and keeps
 * `form-action 'self'` (next.config.ts).
 */
function formActionSources(supabaseOrigin: string): string {
  return `'self' ${supabaseOrigin} https://github.com`;
}

/**
 * Builds the per-request nonce policy, enforced on every proxied page. Next.js reads the nonce from
 * the request's CSP header and stamps it on the scripts it renders per request, so no page code has
 * to handle it. That only works for HTML rendered per request: a static shell prerendered at build
 * time carries no nonce. So every page a proxied path can answer with renders its HTML per request
 * (`instant = false` plus `connection()` at the top): each app entry segment (decision on issue
 * #125), and the global not-found page that answers paths matching no route (#197).
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
    `form-action ${formActionSources(supabaseOrigin)}`,
    "frame-ancestors 'none'",
    // Local Supabase serves plain http on 127.0.0.1, which this directive would break.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

// Doc slugs are lowercase (isDocSlug in src/lib/docs.ts), so a /docs path with an uppercase letter
// is never a doc. It is answered here, before Next looks the path up in its prerender cache: that
// cache is files on disk, and on a case-insensitive file system (macOS) /docs/Providers/Vercel
// would find the prerendered /docs/providers/vercel and serve it with a 200. The rewrite target is
// a slug that can never exist (`_` is outside the slug alphabet), so the docs route renders its
// not-found page with a 404 status.
const MIS_CASED_DOC_PATH = /^\/docs\/.*[A-Z]/;
const UNKNOWN_DOC_PATH = "/docs/_";

// Public project pages (#150) are addressed as /@<workspace slug>/<page slug>. A route folder that
// starts with @ is a parallel route slot, so the address is rewritten to the page route under /p.
// That route is never answered under its own path: anything else under /@ or /p is rewritten to a
// path no route matches, so a page has one address and every other path there is the global 404.
// The alphabets mirror isWorkspaceSlug and the page slug format in src/lib/public-metrics/project-page.ts.
const PROJECT_PAGE_ADDRESS = /^\/@([a-z0-9]{1,64})\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const UNKNOWN_PROJECT_PAGE = "/p/_";

/** Puts a fresh nonce policy on the request (Next.js stamps its scripts with it) and the response. */
function withNoncePolicy(
  request: NextRequest,
  supabaseUrl: string,
  respond: (init: { request: { headers: Headers } }) => NextResponse,
): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, new URL(supabaseUrl));
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("Content-Security-Policy", policy);
  const response = respond({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

/**
 * Refreshes the Supabase session cookie, bounces signed-out visitors away from app pages, sets the
 * CSP headers, and rewrites public project page addresses. This is not authorization: every page,
 * Server Function, and route handler still checks the user itself, because a matcher can drift and
 * silently stop covering a path.
 */
export async function proxy(request: NextRequest) {
  if (MIS_CASED_DOC_PATH.test(request.nextUrl.pathname)) {
    // No session refresh and no app CSP: docs keep the static policy from next.config.ts.
    return NextResponse.rewrite(new URL(UNKNOWN_DOC_PATH, request.url));
  }

  const { pathname, search } = request.nextUrl;
  if (pathname.startsWith("/@") || pathname === "/p" || pathname.startsWith("/p/")) {
    // No session refresh: nothing on a public page depends on who is signed in. The nonce policy
    // still applies, because the page renders its scripts per request.
    const address = PROJECT_PAGE_ADDRESS.exec(pathname);
    const target = address === null ? UNKNOWN_PROJECT_PAGE : `/p/${address[1]}/${address[2]}`;
    return withNoncePolicy(request, publicEnv().NEXT_PUBLIC_SUPABASE_URL, (init) =>
      NextResponse.rewrite(new URL(target, request.url), init),
    );
  }

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

  let response: NextResponse;
  if (!signedIn && isAppPath(pathname)) {
    const signIn = new URL("/sign-in", request.url);
    signIn.searchParams.set("next", safeNextPath(`${pathname}${search}`));
    response = NextResponse.redirect(signIn);
  } else {
    response = withNoncePolicy(request, NEXT_PUBLIC_SUPABASE_URL, (init) => NextResponse.next(init));
  }

  for (const { name, value, options } of cookiesToApply) response.cookies.set(name, value, options);
  // Cache-Control: private, no-store when auth cookies change, so no CDN serves one user's tokens
  // to another.
  for (const [key, value] of Object.entries(headersToApply)) response.headers.set(key, value);
  return response;
}

// The signed-in app, the account page, the auth pages, and public project pages (/@ addresses and
// the /p route they are rewritten to), plus /docs paths with an uppercase letter (answered as not
// found above, before any session or CSP work). The landing page, the docs, the signed-out
// /account/deleted page, API routes, and static assets stay out: they need no session refresh, and
// a nonce would force static pages to render per request. next.config.ts applies the static CSP to
// every path except the paths listed here; keep them in sync.
//
// Next compiles each matcher to a case-sensitive regular expression, so the docs entry matches only
// paths that contain an uppercase letter and correctly cased docs never invoke the proxy. "/@" is
// followed by a pattern rather than `:path*`, which repeats only after a slash.
export const config = {
  matcher: [
    "/app",
    "/app/:path*",
    "/w/:path*",
    "/account",
    "/sign-in",
    "/auth/:path*",
    "/docs/:path(.*[A-Z].*)",
    "/@:path(.*)",
    "/p/:path*",
  ],
};
