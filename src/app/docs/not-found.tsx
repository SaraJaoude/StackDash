import Link from "next/link";

import { buttonClass } from "@/components/ui/button";

// Shown for any /docs address with no doc behind it, inside the docs layout.
export default function DocNotFound() {
  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-6 py-16 sm:py-24">
      <div className="max-w-xl rounded-xl border border-line bg-panel px-6 py-10 sm:px-10">
        <p className="font-mono text-[11px] font-medium text-muted">Not found</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">We could not find that doc</h1>
        <p className="mt-3 text-sm leading-6 text-muted">
          The address may be mistyped, or the page may have moved. Every published doc is listed on the docs
          page.
        </p>
        <div className="mt-6">
          <Link
            href="/docs"
            className={buttonClass("primary")}
          >
            Browse all docs
          </Link>
        </div>
      </div>
    </main>
  );
}
