import type { Metadata } from "next";
import Link from "next/link";

import { Wordmark } from "@/components/wordmark";

export const metadata: Metadata = { title: "Page not found" };

// Next.js answers a URL that matches no route with this page, prerendered at build time. It also
// replaces the built-in not-found page, whose inline style block carries no CSP nonce. Unmatched
// paths under /app and /auth, where the proxy enforces the nonce policy (src/proxy.ts), never reach
// the prerendered copy: catch-all segments there call notFound() in a per-request render, which
// shows this page with the nonce (#197). It must stay static: Next.js renders it into every route
// as the root not-found boundary, so request data here would fail the prerendered docs.
export default function NotFound() {
  return (
    <main id="main" className="flex flex-1 items-center justify-center px-6 py-16">
      <div className="w-full max-w-xl rounded-xl border border-line bg-panel px-6 py-10 sm:px-10">
        <Link href="/" className="inline-flex min-h-6 items-center">
          <Wordmark />
        </Link>
        <p className="mt-6 font-mono text-[11px] font-medium text-muted">Not found</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">We could not find that page</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          The address may be mistyped, or the page may have moved. Check the address, or start again from
          the home page or your workspaces.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85"
          >
            Go to the home page
          </Link>
          <Link
            href="/app"
            className="inline-flex min-h-10 items-center rounded-md border border-line-strong px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            Open your workspaces
          </Link>
        </div>
      </div>
    </main>
  );
}
