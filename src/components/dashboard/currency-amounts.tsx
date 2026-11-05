import type { CurrencyAmounts, MoneyValue } from "@/lib/dashboard/aggregate";
import { formatMoney } from "@/lib/format";
import { amountKey, type AmountGroup } from "@/lib/realtime/arrivals";

import { ArrivalNumber } from "./arrival-values";
import { Freshness, ProvenanceBadge, ProvenanceDetail, Unavailable } from "./value-meta";

/**
 * One money value with its provenance, source, and freshness. The headline variant prints the
 * amount large and skips the source list, because the totals at the top of the dashboard sum
 * several connections and the provider cards below already name each one. Inside an ArrivalCard
 * the amount counts from its old value when a live refresh changes it (#171).
 */
export function MoneyValueBlock({
  value,
  group,
  now,
  headline = false,
}: {
  value: MoneyValue;
  /** Which of the card's money lists holds the value, so it is compared with its own old value. */
  group: AmountGroup;
  now: Date;
  headline?: boolean;
}) {
  return (
    <div className="space-y-1">
      <p className="flex flex-wrap items-center gap-2">
        <ArrivalNumber
          valueKey={amountKey(group, value.currency, value.provenance.status)}
          value={value.amountMinor}
          text={formatMoney(value.amountMinor, value.currency)}
          format={{ type: "money", currency: value.currency }}
          className={`font-mono font-semibold tabular-nums ${headline ? "text-2xl" : "text-lg"}`}
        />
        <ProvenanceBadge provenance={value.provenance} />
      </p>
      {headline ? null : <ProvenanceDetail provenance={value.provenance} sources={value.sources} />}
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
  group,
  now,
  verifiedLabel,
  estimatedLabel,
  headline = false,
}: {
  amounts: CurrencyAmounts;
  group: AmountGroup;
  now: Date;
  verifiedLabel: string;
  estimatedLabel: string;
  /** Large amounts without the source list; see `MoneyValueBlock`. */
  headline?: boolean;
}) {
  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      <div>
        <dt className="text-xs font-medium text-muted">{verifiedLabel}</dt>
        <dd className="mt-1">
          {amounts.verified === null ? (
            <Unavailable />
          ) : (
            <MoneyValueBlock value={amounts.verified} group={group} now={now} headline={headline} />
          )}
        </dd>
      </div>
      {amounts.estimated === null ? null : (
        <div>
          <dt className="text-xs font-medium text-muted">{estimatedLabel}</dt>
          <dd className="mt-1">
            <MoneyValueBlock value={amounts.estimated} group={group} now={now} headline={headline} />
          </dd>
        </div>
      )}
    </dl>
  );
}
