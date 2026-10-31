import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DocMarkdown } from "@/components/docs/doc-markdown";
import { DocsNav } from "@/components/docs/docs-nav";
import { getDoc, groupDocs, listDocs } from "@/lib/docs";

// Every doc is prerendered from the repository at build time. 'navigation' makes the build fail if
// the route ever needs request-time rendering, and makes a slug that was not prerendered wait for
// its complete render, so an unknown doc answers with a real 404 instead of a streamed fallback.
export const ensureStatic = "navigation";

export function generateStaticParams() {
  return listDocs().map((doc) => ({ slug: [...doc.slug] }));
}

export async function generateMetadata({ params }: PageProps<"/docs/[...slug]">): Promise<Metadata> {
  const { slug } = await params;
  const doc = getDoc(slug);
  return doc ? { title: doc.title, description: doc.description } : {};
}

// params is awaited inside Suspense, as the Cache Components docs prescribe for a route with
// generateStaticParams, so the route keeps a shared App Shell for client navigation.
export default function DocRoute({ params }: PageProps<"/docs/[...slug]">) {
  return (
    <Suspense
      fallback={
        <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-6 py-16">
          <p className="text-sm text-muted">Loading the doc</p>
        </main>
      }
    >
      <DocContent params={params} />
    </Suspense>
  );
}

async function DocContent({ params }: Pick<PageProps<"/docs/[...slug]">, "params">) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-12 lg:flex-row lg:gap-12 lg:py-16">
      <DocsNav groups={groupDocs(listDocs())} currentHref={doc.href} />
      <main id="main" className="min-w-0 max-w-3xl flex-1">
        <article>
          <DocMarkdown doc={doc} />
        </article>
      </main>
    </div>
  );
}
