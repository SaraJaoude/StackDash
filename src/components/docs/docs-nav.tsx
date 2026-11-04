import Link from "next/link";

import type { DocGroup } from "@/lib/docs";

interface DocsNavProps {
  groups: readonly DocGroup[];
  currentHref: string;
}

/** Every doc by folder: a sidebar from lg up, a wrapped list above the page below it. */
export function DocsNav({ groups, currentHref }: DocsNavProps) {
  return (
    <nav aria-label="Docs" className="lg:sticky lg:top-24 lg:w-56 lg:shrink-0 lg:self-start">
      <div className="flex flex-col gap-6">
        {groups.map((group) => (
          <div key={group.id}>
            <p id={`docs-nav-${group.id}`} className="font-mono text-xs text-accent">
              {group.label}
            </p>
            <ul aria-labelledby={`docs-nav-${group.id}`} className="mt-2 flex flex-wrap gap-2 lg:flex-col lg:gap-0.5">
              {group.docs.map((doc) => {
                const current = doc.href === currentHref;
                return (
                  <li key={doc.href}>
                    <Link
                      href={doc.href}
                      aria-current={current ? "page" : undefined}
                      className={`inline-flex min-h-8 items-center rounded-md border px-3 py-1 text-sm transition-colors lg:flex lg:rounded-none lg:border-y-0 lg:border-r-0 lg:border-l-2 ${
                        current
                          ? "border-accent bg-accent-soft font-medium text-foreground"
                          : "border-line text-muted hover:border-line-strong hover:text-foreground"
                      }`}
                    >
                      {doc.title}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
