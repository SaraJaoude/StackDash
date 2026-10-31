import Link from "next/link";
import { useId, type ReactNode } from "react";

import type { CurrencyAmounts, DashboardView as View, ProviderId } from "@/lib/dashboard/aggregate";

import { CurrencyAmountsList } from "./currency-amounts";
import { ProviderCard } from "./provider-card";
import { providerName } from "./value-meta";

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="mt-10">
      <h2 id={titleId} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {description === undefined ? null : <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">{description}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** One card per currency, each its own labeled region, so currencies are never read as one sum. */
function CurrencyCards({ amounts, noun, now }: { amounts: readonly CurrencyAmounts[]; noun: string; now: Date }) {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {amounts.map((entry) => (
        <CurrencyCard key={entry.currency} amounts={entry} noun={noun} now={now} />
      ))}
    </ul>
  );
}

function CurrencyCard({ amounts, noun, now }: { amounts: CurrencyAmounts; noun: string; now: Date }) {
  const titleId = useId();
  return (
    <li>
      <section aria-labelledby={titleId} className="rounded-xl border border-line bg-panel p-5">
        <h3 id={titleId} className="font-mono text-sm font-medium text-muted">
          {`${noun} in ${amounts.currency}`}
        </h3>
        <div className="mt-3">
          <CurrencyAmountsList
            amounts={amounts}
            now={now}
            verifiedLabel={`Verified ${noun.toLowerCase()}`}
            estimatedLabel={`Estimated ${noun.toLowerCase()}`}
          />
        </div>
      </section>
    </li>
  );
}

function ProviderFilter({
  providers,
  selected,
  action,
}: {
  providers: readonly ProviderId[];
  selected: ProviderId | null;
  action: string;
}) {
  const selectId = useId();
  return (
    // A plain GET form: the filter lives in the URL, works without JavaScript, and can be shared.
    <form method="get" action={action} className="mt-6 flex flex-wrap items-end gap-3">
      <div>
        <label htmlFor={selectId} className="block text-sm font-medium">
          Provider
        </label>
        <select
          id={selectId}
          name="provider"
          defaultValue={selected ?? ""}
          className="mt-1 block min-h-10 rounded-md border border-line bg-panel-raised px-3 py-2 text-sm text-foreground"
        >
          <option value="">All providers</option>
          {providers.map((provider) => (
            <option key={provider} value={provider}>
              {providerName(provider)}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        className="inline-flex min-h-10 items-center rounded-md border border-line-strong px-4 py-2 text-sm font-medium transition-colors hover:bg-panel-raised"
      >
        Apply filter
      </button>
      {selected === null ? null : (
        <Link href={action} className="inline-flex min-h-10 items-center px-2 text-sm text-muted underline underline-offset-4">
          Show all providers
        </Link>
      )}
    </form>
  );
}

export function DashboardView({
  view,
  now,
  selectedProvider,
  dashboardPath,
}: {
  view: View;
  now: Date;
  selectedProvider: ProviderId | null;
  dashboardPath: string;
}) {
  return (
    <>
      {view.providers.length > 1 || selectedProvider !== null ? (
        <ProviderFilter providers={view.providers} selected={selectedProvider} action={dashboardPath} />
      ) : null}

      <Section
        title="Spending this billing period"
        description="Totals per currency. Currencies are never added together, and verified amounts from providers are kept apart from DevMacro estimates."
      >
        {view.totals.length === 0 ? (
          <p className="text-sm text-muted">
            No spend has been reported for the current billing period yet. Values appear after the next sync.
          </p>
        ) : (
          <CurrencyCards amounts={view.totals} noun="Spend" now={now} />
        )}
      </Section>

      {view.revenue.length === 0 ? null : (
        <Section title="Revenue this billing period" description="Money coming in, shown apart from spending.">
          <CurrencyCards amounts={view.revenue} noun="Revenue" now={now} />
        </Section>
      )}

      <Section title="By provider" description="Spend, credit balance, and allowances for each connected account.">
        {view.byProvider.length === 0 ? (
          <p className="text-sm text-muted">No connections match this filter. Choose another provider or show all providers.</p>
        ) : (
          <ul className="space-y-4">
            {view.byProvider.map((summary) => (
              <ProviderCard key={summary.connectionId} summary={summary} now={now} />
            ))}
          </ul>
        )}
      </Section>

      <Section
        title="By project"
        description="Spend this billing period grouped by project. Accounts without a project are listed as unassigned."
      >
        {view.byProject.length === 0 ? (
          <p className="text-sm text-muted">No spend to group by project yet.</p>
        ) : (
          <ul className="grid gap-4 md:grid-cols-2">
            {view.byProject.map((project) => (
              <ProjectCard key={project.projectId ?? "unassigned"} name={project.name} spend={project.spend} now={now} />
            ))}
          </ul>
        )}
      </Section>
    </>
  );
}

function ProjectCard({ name, spend, now }: { name: string; spend: readonly CurrencyAmounts[]; now: Date }) {
  const titleId = useId();
  return (
    <li>
      <section aria-labelledby={titleId} className="rounded-xl border border-line bg-panel p-5">
        <h3 id={titleId} className="font-semibold">
          {name}
        </h3>
        <ul className="mt-3 space-y-4">
          {spend.map((amounts) => (
            <li key={amounts.currency}>
              <p className="mb-1 font-mono text-xs font-medium text-muted">{amounts.currency}</p>
              <CurrencyAmountsList
                amounts={amounts}
                now={now}
                verifiedLabel="Verified spend"
                estimatedLabel="Estimated spend"
              />
            </li>
          ))}
        </ul>
      </section>
    </li>
  );
}
