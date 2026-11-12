import Link from "next/link";
import type { ReactNode } from "react";

import { INLINE_CODE_CLASS, LINK_CLASS } from "@/components/docs/doc-markdown";
import { SiteFooter } from "@/components/site-footer";
import { SiteNav } from "@/components/site-nav";

// Body text styled like a doc page (src/components/docs/doc-markdown.tsx), set once on the wrapper
// so the policy and terms read as plain paragraphs and lists.
const PROSE_CLASS = [
  "[&_p]:mt-4 [&_p]:leading-7 [&_p]:text-foreground/85",
  "[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_ul]:marker:text-muted",
  "[&_li]:pl-1 [&_li]:leading-7 [&_li]:text-foreground/85",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
].join(" ");

/**
 * The privacy policy or the terms of use: the site header and footer around one titled document.
 * `updated` is that document's own date (`PRIVACY_UPDATED`, `TERMS_UPDATED` in src/lib/legal.ts), so
 * an edit to one never moves the other's.
 */
export function LegalDocument({
  title,
  updated,
  intro,
  children,
}: {
  title: string;
  updated: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <SiteNav anchorBase="/" />
      <main id="main" className="mx-auto w-full max-w-3xl flex-1 px-6 py-16 sm:py-24">
        <article>
          <header>
            <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
            <p className="mt-3 text-sm text-muted">
              Last updated <time dateTime={updated}>{updated}</time>
            </p>
          </header>
          <div className={PROSE_CLASS}>
            <p>{intro}</p>
            {children}
          </div>
        </article>
      </main>
      <SiteFooter anchorBase="/" />
    </>
  );
}

/** One section, with an id so a reply to a privacy request can link to `/privacy#cookies`. */
export function LegalSection({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <>
      <h2 id={id} className="mt-14 scroll-mt-24 border-t border-line pt-8 text-2xl font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </>
  );
}

/** A link inside the text, styled like a doc link: a site path through `Link`, anything else a plain anchor. */
export function LegalLink({ href, children }: { href: string; children: ReactNode }) {
  return href.startsWith("/") ? (
    <Link href={href} className={LINK_CLASS}>
      {children}
    </Link>
  ) : (
    <a href={href} className={LINK_CLASS}>
      {children}
    </a>
  );
}

/** A scope, cookie prefix, or other literal value named in the text. */
export function LegalCode({ children }: { children: ReactNode }) {
  return <code className={INLINE_CODE_CLASS}>{children}</code>;
}
