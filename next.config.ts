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
// would make the static landing page dynamic. App routes get the full nonce policy from
// src/proxy.ts instead; two CSP headers would both be enforced, so the static one is kept off them.
const staticCsp = {
  key: "Content-Security-Policy",
  value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
};

// Every path except the proxy matcher in src/proxy.ts (/app, /app/*, /w/*, /sign-in, /auth/*).
// Keep the two lists in sync.
const outsideProxy = "/((?!app$|app/|w/|sign-in$|auth/).*)";

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
