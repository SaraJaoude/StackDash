import type { Metadata, Viewport } from "next";
import { connection } from "next/server";

import { SkipLink } from "@/components/skip-link";

import { documentClassName } from "./fonts";
import { viewport as rootViewport } from "./layout";
import NotFound from "./not-found";
import "./globals.css";

export const metadata: Metadata = { title: "Page not found" };
export const viewport: Viewport = rootViewport;

// Next.js answers every URL that matches no route with this page (experimental.globalNotFound in
// next.config.ts), including unmatched paths under /app, /w/<slug>, and /auth, where the proxy
// enforces the nonce CSP (src/proxy.ts). A page prerendered at build time carries no nonce, and its
// scripts would be blocked, so this one renders per request like the app entry segments: it awaits
// `connection()` before anything renders and allows an empty static shell (#125, #197). The cost:
// every 404 on the site is a render instead of a cached file.
//
// This is not `not-found.tsx`: Next.js renders that one into every route as the root not-found
// boundary, so request data there would make the prerendered pages, the docs included, fail.
export const instant = false;

export default async function GlobalNotFound() {
  await connection();
  return (
    <html lang="en" className={documentClassName}>
      <body className="flex min-h-full flex-col">
        <SkipLink />
        <NotFound />
      </body>
    </html>
  );
}
