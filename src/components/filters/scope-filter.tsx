import Form from "next/form";
import Link from "next/link";
import { useId, type ReactNode } from "react";

import type { ScopeFilters, ScopeOption, ScopeOptions } from "@/lib/filters/scope";

const CHECKBOX_LABEL = "flex min-h-6 cursor-pointer items-center gap-2 px-1 text-sm";
const CHECKBOX = "size-4 shrink-0 accent-accent";

function OptionGroup({
  legend,
  name,
  options,
  selected,
  emptyText,
}: {
  legend: string;
  name: string;
  options: readonly ScopeOption[];
  selected: readonly string[];
  emptyText: string;
}) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-medium">{legend}</legend>
      {options.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{emptyText}</p>
      ) : (
        <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto pr-1">
          {options.map((option) => (
            <label key={option.value} className={CHECKBOX_LABEL}>
              <input
                type="checkbox"
                name={name}
                value={option.value}
                defaultChecked={selected.includes(option.value)}
                className={CHECKBOX}
              />
              <span className="min-w-0 break-words">{option.label}</span>
            </label>
          ))}
        </div>
      )}
    </fieldset>
  );
}

/**
 * The one filter control for the dashboard and the timeline: provider, project, and account,
 * plus any screen-specific fields passed as `children`. A plain GET form, so the filter lives in
 * the URL: a filtered view can be bookmarked, shared, and reloaded, and it works before any
 * JavaScript loads. Native checkboxes keep it keyboard operable. The page announces the result in
 * its own `role="status"` summary.
 */
export function ScopeFilter({
  action,
  scope,
  options,
  hidden,
  resetKey,
  children,
}: {
  action: string;
  scope: ScopeFilters;
  options: ScopeOptions;
  /** Other URL state the form must carry, such as the dashboard's trend period. */
  hidden?: Readonly<Record<string, string>> | undefined;
  /** Changes when the screen's own fields change, so their uncontrolled inputs reset too. */
  resetKey?: string | undefined;
  children?: ReactNode;
}) {
  const titleId = useId();
  // Inputs are uncontrolled, so the form remounts when the filters in the URL change; otherwise
  // a client navigation (such as Clear filters) would leave the old boxes ticked.
  const formKey = JSON.stringify([scope.providers, scope.projects, scope.accounts, resetKey ?? ""]);
  return (
    <section aria-labelledby={titleId} className="mt-8 rounded-xl border border-line bg-panel">
      <h2 id={titleId} className="border-b border-line px-5 py-3 text-sm font-semibold">
        Filters
      </h2>
      <Form key={formKey} action={action} className="grid gap-6 px-5 py-5">
        {Object.entries(hidden ?? {}).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <div className="grid gap-6 md:grid-cols-3">
          <OptionGroup
            legend="Provider"
            name="provider"
            options={options.providers}
            selected={scope.providers}
            emptyText="No providers connected yet."
          />
          <OptionGroup
            legend="Project"
            name="project"
            options={options.projects}
            selected={scope.projects}
            emptyText="No projects yet."
          />
          <OptionGroup
            legend="Account"
            name="account"
            options={options.accounts}
            selected={scope.accounts}
            emptyText="No provider accounts yet."
          />
        </div>
        {children}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="submit"
            className="inline-flex min-h-10 items-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-85"
          >
            Apply filters
          </button>
          <Link
            href={action}
            className="inline-flex min-h-10 items-center rounded-md border border-line-strong px-4 py-2 text-sm text-muted transition-colors hover:text-foreground"
          >
            Clear filters
          </Link>
        </div>
      </Form>
    </section>
  );
}
