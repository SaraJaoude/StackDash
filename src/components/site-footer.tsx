import Link from "next/link";

import { GitHubIcon } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { Wordmark } from "@/components/wordmark";
import { legalLinks } from "@/lib/legal";
import { docsLink, sectionLinks, signInLink, site } from "@/lib/site";

interface SiteFooterProps {
  /** "/" off the landing page, so the section anchors lead back to it. */
  anchorBase?: "" | "/";
}

/**
 * Footer: the full section map, the docs and sign-in pages, the privacy policy and terms of use
 * where this instance names an operator, the repository, and one founder credit.
 */
export function SiteFooter({ anchorBase = "" }: SiteFooterProps) {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs">
          <p className="flex items-center gap-3">
            <Wordmark loading="lazy" size="site" />
            <StatusBadge />
          </p>
          <p className="mt-3 text-sm leading-6 text-muted">
            {site.tagline}. Open source, built in public.
          </p>
        </div>

        <nav aria-label="Footer" className="flex flex-col gap-8 sm:flex-row sm:gap-16">
          <ul className="grid grid-cols-2 gap-x-16 gap-y-2.5">
            {sectionLinks.map((link) => (
              <li key={link.href}>
                <a
                  href={`${anchorBase}${link.href}`}
                  className="text-sm text-muted transition-colors hover:text-foreground"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
          <ul className="flex flex-col gap-y-2.5">
            {[docsLink, signInLink, ...legalLinks()].map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="text-sm text-muted transition-colors hover:text-foreground">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>

      <div className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-muted">
          <a
            href={site.githubUrl}
            className="inline-flex items-center gap-2 transition-colors hover:text-foreground"
          >
            <GitHubIcon />
            {site.name} on GitHub
          </a>
          <p>
            Built by{" "}
            <a href={site.founder.url} className="text-foreground/80 transition-colors hover:text-foreground">
              {site.founder.name}
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}
