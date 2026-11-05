import type { NextConfig } from "next";

// Baseline browser policy for every route.
const securityHeaders = [
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), browsing-topics=()" },
];

// Static CSP for routes outside the proxy (the landing page, API routes, assets). It covers
// framing, base, form, and plugin policy only: a script-src policy needs per-request nonces, which
// would make the static landing page dynamic. src/proxy.ts enforces a full nonce policy on app
// routes with the same four directives, except that form-action there also allows the
// no-JavaScript sign-in redirect chain; e2e/csp.spec.ts asserts both. This header is kept off the
// proxied paths, because a second policy would be enforced alongside the nonce policy.
const staticCsp = {
  key: "Content-Security-Policy",
  value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

// Every path except the paths in the proxy matcher in src/proxy.ts (/app, /app/*, /w/*, /account,
// /sign-in, /auth/*, /unsubscribe, and the public project pages at /@* and /p/*). Keep the two
// lists in sync. The proxy also matches mis-cased /docs paths but sets no CSP there, so they stay
// covered here.
const outsideProxy = "/((?!app$|app/|w/|account$|sign-in$|auth/|unsubscribe$|@|p$|p/).*)";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  experimental: {
    // src/app/global-not-found.tsx answers unmatched URLs, rendered per request so the 404 under the
    // app paths carries the CSP nonce (#197). The root not-found.tsx cannot: it is rendered into every
    // route, so request data there would make the prerendered pages dynamic.
    globalNotFound: true,
  },
  // src/lib/docs.ts reads docs/**/*.md with fs. A /docs slug that was not prerendered renders on
  // demand (and answers 404), so the Markdown ships with that route's server output.
  outputFileTracingIncludes: {
    "/docs/**": ["./docs/**/*.md"],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      { source: outsideProxy, headers: [staticCsp] },
    ];
  },
};

export default nextConfig;
