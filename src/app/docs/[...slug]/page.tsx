import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DocMarkdown } from "@/components/docs/doc-markdown";
import { DocsNav } from "@/components/docs/docs-nav";
import { getDoc, groupDocs, listDocs } from "@/lib/docs";

// Every doc is prerendered from the repository at build time. 'navigation' makes the build fail if
// the route ever needs request-time rendering, and makes a slug that was not prerendered wait for
// its complete render rather than stream a fallback (ensureStatic reference, "Dynamic route
// parameters").
export const ensureStatic = "navigation";

// The page awaits params outside any Suspense boundary, so it has no content in the shared App
// Shell and a client navigation into a doc blocks until the whole page has arrived ("Opting out"
// in the Instant Navigation guide). That is deliberate: a `/docs/x#heading` link can only scroll
// to the heading once it exists, and a page that streamed in after the shell was the bug. It also
// keeps notFound() ahead of the first byte, so an unknown doc answers 404. Opting out here also
// exempts the route from the non-empty static shell check that a top-level await would fail.
export const instant = false;

export function generateStaticParams() {
  return listDocs().map((doc) => ({ slug: [...doc.slug] }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[...slug]">): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}

export default async function DocRoute({ params }: PageProps<"/docs/[...slug]">) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-12 lg:flex-row lg:gap-12 lg:py-16">
      <DocsNav groups={groupDocs(listDocs())} currentHref={doc.href} />
      <main id="main" tabIndex={-1} className="min-w-0 max-w-3xl flex-1">
        <article>
          <DocMarkdown doc={doc} />
        </article>
      </main>
    </div>
  );
}
