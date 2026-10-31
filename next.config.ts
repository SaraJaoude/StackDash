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
// would make the static landing page dynamic. src/proxy.ts enforces the same policy on app routes
// (its enforcedPolicy), except that form-action there also allows the no-JavaScript sign-in
// redirect chain; e2e/auth.spec.ts asserts both. It adds the nonce policy as report-only, so this
// header is kept off the proxied paths rather than sent twice.
const staticCsp = {
  key: "Content-Security-Policy",
  value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

// Every path except the proxy matcher in src/proxy.ts (/app, /app/*, /w/*, /account, /sign-in,
// /auth/*). Keep the two lists in sync.
const outsideProxy = "/((?!app$|app/|w/|account$|sign-in$|auth/).*)";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
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
