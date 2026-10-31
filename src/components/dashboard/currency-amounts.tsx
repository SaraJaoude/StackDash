import type { CurrencyAmounts, MoneyValue } from "@/lib/dashboard/aggregate";
import { formatMoney } from "@/lib/format";

import { Freshness, ProvenanceBadge, ProvenanceDetail, Unavailable } from "./value-meta";

/** One money value with its provenance, source, and freshness. */
export function MoneyValueBlock({ value, now }: { value: MoneyValue; now: Date }) {
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-lg font-semibold tabular-nums">{formatMoney(value.amountMinor, value.currency)}</span>
        <ProvenanceBadge provenance={value.provenance} />
      </p>
      <ProvenanceDetail provenance={value.provenance} sources={value.sources} />
      <Freshness retrievedAt={value.retrievedAt} stale={value.stale} now={now} />
    </div>
  );
}

/**
 * One currency's verified and estimated amounts, side by side and labeled, never added together.
 * A missing verified amount reads "Unavailable"; an estimate is only listed when there is one.
 */
export function CurrencyAmountsList({
  amounts,
  now,
  verifiedLabel,
  estimatedLabel,
}: {
  amounts: CurrencyAmounts;
  now: Date;
  verifiedLabel: string;
  estimatedLabel: string;
}) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium text-muted">{verifiedLabel}</dt>
        <dd className="mt-1">
          {amounts.verified === null ? <Unavailable /> : <MoneyValueBlock value={amounts.verified} now={now} />}
        </dd>
      </div>
      {amounts.estimated === null ? null : (
        <div>
          <dt className="text-xs font-medium text-muted">{estimatedLabel}</dt>
          <dd className="mt-1">
            <MoneyValueBlock value={amounts.estimated} now={now} />
          </dd>
        </div>
      )}
    </dl>
  );
}
