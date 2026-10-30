import { GitHubIcon } from "@/components/icons";
import { StatusBadge } from "@/components/status-badge";
import { Wordmark } from "@/components/wordmark";
import { sectionLinks, site } from "@/lib/site";

/** Footer: the full section map, the repository, and one founder credit. */
export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-6 py-12 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xs">
          <div className="flex flex-wrap items-center gap-3">
            <Wordmark withTagline />
            <StatusBadge />
          </div>
          <p className="mt-3 text-sm leading-6 text-muted">
            {site.tagline}. Open source, built in public.
          </p>
        </div>

        <nav aria-label="Footer">
          <ul className="grid grid-cols-2 gap-x-16 gap-y-2.5">
            {sectionLinks.map((link) => (
              <li key={link.href}>
                <a href={link.href} className="text-sm text-muted transition-colors hover:text-foreground">
                  {link.label}
                </a>
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
