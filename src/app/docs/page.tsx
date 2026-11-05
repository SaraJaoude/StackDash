import type { Metadata } from "next";
import Link from "next/link";

import { groupDocs, listDocs } from "@/lib/docs";

const intro = "How DevMacro connects to each provider, how to deploy and run it, and how its data is stored.";

export const metadata: Metadata = { title: "Docs", description: intro };

// Fully static: the docs are read from the repository at build time.
export default function DocsIndexPage() {
  const groups = groupDocs(listDocs());

  return (
    <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-6 py-16 sm:py-24">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Documentation</h1>
      <p className="mt-4 max-w-2xl text-base leading-7 text-muted">{intro}</p>

      <div className="mt-14 flex flex-col gap-14">
        {groups.map((group) => (
          <section key={group.id} aria-labelledby={`docs-group-${group.id}`}>
            <h2 id={`docs-group-${group.id}`} className="text-xl font-semibold tracking-tight">
              {group.label}
            </h2>
            <ul className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {group.docs.map((doc) => (
                <li
                  key={doc.href}
                  className="relative rounded-xl border border-line bg-panel p-5 transition-colors hover:border-line-strong"
                >
                  <h3 className="font-medium">
                    {/* The link stretches over the whole card, so the card is one large target. */}
                    <Link href={doc.href} className="after:absolute after:inset-0 after:rounded-xl">
                      {doc.title}
                    </Link>
                  </h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{doc.description}</p>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
