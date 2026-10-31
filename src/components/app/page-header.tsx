import type { ReactNode } from "react";

/** The page's one `<h1>`, with an optional summary and page-level actions. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{title}</h1>
        {description === undefined ? null : (
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{description}</p>
        )}
      </div>
      {actions === undefined ? null : <div className="flex shrink-0 flex-wrap gap-3">{actions}</div>}
    </div>
  );
}
