import Form from "next/form";
import Link from "next/link";

import {
  EVENT_SEVERITIES,
  eventTypeLabel,
  severityBadge,
  type TimelineQuery,
} from "@/lib/timeline/query";

import { typeOwnerName } from "./provider";

const CHECKBOX_LABEL = "flex min-h-6 cursor-pointer items-center gap-2 px-1 text-sm";
const CHECKBOX = "size-4 shrink-0 accent-accent";
const DATE_INPUT =
  "mt-1 block min-h-10 w-full rounded-md border border-line-strong bg-panel-raised px-3 py-2 text-sm text-foreground [color-scheme:dark]";

/**
 * A plain GET form, so the filters live in the URL: a filtered view can be bookmarked, shared,
 * and reloaded, and it works before any JavaScript loads. Submitting starts from the newest
 * events, because the form carries no cursor.
 */
export function TimelineFilters({
  action,
  query,
  typeIds,
}: {
  action: string;
  query: TimelineQuery;
  /** Type ids present in the workspace; selected ones are added so they can be unticked. */
  typeIds: readonly string[];
}) {
  const typeOptions = [...new Set([...typeIds, ...query.types])].sort();
  // Inputs are uncontrolled, so the form remounts when the filters in the URL change; otherwise
  // a client navigation (such as Clear filters) would leave the old boxes ticked.
  const formKey = JSON.stringify([query.types, query.severities, query.from, query.to]);
  return (
    <section aria-labelledby="timeline-filters-title" className="mt-8 rounded-xl border border-line bg-panel">
      <h2 id="timeline-filters-title" className="border-b border-line px-5 py-3 text-sm font-semibold">
        Filters
      </h2>
      <Form key={formKey} action={action} className="grid gap-6 px-5 py-5 md:grid-cols-[2fr_1fr_1fr]">
        <fieldset className="min-w-0">
          <legend className="text-sm font-medium">Event type</legend>
          <div className="mt-2 grid max-h-56 gap-1 overflow-y-auto pr-1 sm:grid-cols-2">
            {typeOptions.map((typeId) => (
              <label key={typeId} className={CHECKBOX_LABEL}>
                <input
                  type="checkbox"
                  name="type"
                  value={typeId}
                  defaultChecked={query.types.includes(typeId)}
                  className={CHECKBOX}
                />
                <span className="min-w-0 break-words">
                  {typeOwnerName(typeId)}: {eventTypeLabel(typeId)}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Severity</legend>
          <div className="mt-2 grid gap-1">
            {EVENT_SEVERITIES.map((severity) => (
              <label key={severity} className={CHECKBOX_LABEL}>
                <input
                  type="checkbox"
                  name="severity"
                  value={severity}
                  defaultChecked={query.severities.includes(severity)}
                  className={CHECKBOX}
                />
                <span>{severityBadge(severity)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Date range</legend>
          <p id="timeline-dates-hint" className="mt-1 text-xs text-muted">
            Whole days, UK time. Both dates are included.
          </p>
          <div className="mt-2 grid gap-3">
            <label className="block text-sm">
              From
              <input
                type="date"
                name="from"
                defaultValue={query.from ?? ""}
                aria-describedby="timeline-dates-hint"
                className={DATE_INPUT}
              />
            </label>
            <label className="block text-sm">
              To
              <input
                type="date"
                name="to"
                defaultValue={query.to ?? ""}
                aria-describedby="timeline-dates-hint"
                className={DATE_INPUT}
              />
            </label>
          </div>
        </fieldset>

        <div className="flex flex-wrap items-center gap-3 md:col-span-3">
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
