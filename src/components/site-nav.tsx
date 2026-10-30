import { GitHubButton } from "@/components/github-button";
import { StatusBadge } from "@/components/status-badge";
import { Wordmark } from "@/components/wordmark";
import { navLinks } from "@/lib/site";

/**
 * Sticky top nav. A server component: on small screens the section links hide and the page
 * itself is the menu, so the landing page ships no client JavaScript for navigation.
 */
export function SiteNav() {
  return (
    <header className="sticky top-0 z-50 border-b border-line bg-background/80 backdrop-blur-md">
      <nav aria-label="Main" className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-4 px-6">
        <div className="flex items-center gap-2">
          <a href="#top" className="inline-flex shrink-0">
            <Wordmark />
          </a>
          <span className="hidden sm:inline">
            <StatusBadge />
          </span>
        </div>

        <ul className="hidden items-center gap-8 lg:flex">
          {navLinks.map((link) => (
            <li key={link.href}>
              <a href={link.href} className="text-sm text-muted transition-colors hover:text-foreground">
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <GitHubButton size="sm" />
      </nav>
    </header>
  );
}
