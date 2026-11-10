import { useId } from "react";

import { SimulatedBadge } from "@/components/connections/simulated-badge";
import {
  providerCardFields,
  type Allowance,
  type DeclaredFields,
  type ProviderSummary,
  type QuantityValue,
} from "@/lib/dashboard/aggregate";
import { quotaProjectionText, type AllowanceProjection, type QuotaProjection, type SpendProjection } from "@/lib/dashboard/projection";
import { formatDateTime, formatPercent, formatPeriod, formatQuantity } from "@/lib/format";
import { providerName } from "@/lib/providers";
import {
  allowanceKey,
  allowanceValues,
  amountKey,
  amountValues,
  creditValues,
  recurringKey,
  recurringValues,
} from "@/lib/realtime/arrivals";

import { ArrivalBar, ArrivalCard, ArrivalNumber } from "./arrival-values";
import { CurrencyAmountsList, MoneyValueBlock } from "./currency-amounts";
import {
  connectionStatusLabel,
  Freshness,
  ProjectionNote,
  ProvenanceBadge,
  ProviderMark,
  SpendProjectionNote,
  Unavailable,
} from "./value-meta";

function QuantityCell({ label, valueKey, value }: { label: string; valueKey: string; value: QuantityValue | null }) {
  return (
    <div>
      <dt className="text-xs font-medium text-muted">{label}</dt>
      <dd className="mt-1 flex flex-wrap items-center gap-2">
        {value === null ? (
          <Unavailable />
        ) : (
          <>
            <ArrivalNumber
              valueKey={valueKey}
              value={value.value}
              text={formatQuantity(value.value, value.unit)}
              format={{ type: "quantity", unit: value.unit }}
              className="font-mono font-semibold tabular-nums"
            />
            <ProvenanceBadge provenance={value.provenance} />
          </>
        )}
      </dd>
    </div>
  );
}

function AllowanceCard({ allowance, quota, now }: { allowance: Allowance; quota: QuotaProjection | undefined; now: Date }) {
  const titleId = useId();
  const parts = [allowance.included, allowance.used, allowance.remaining].filter((value) => value !== null);
  // The oldest part decides "Updated", and one stale part marks the card stale.
  const oldest = parts.reduce<QuantityValue | null>(
    (current, value) => (current === null || Date.parse(value.retrievedAt) < Date.parse(current.retrievedAt) ? value : current),
    null,
  );
  const stale = parts.some((value) => value.stale);
  const percent = allowance.percentUsed;
  return (
    <li>
      <article aria-labelledby={titleId} className="relative isolate rounded-lg border border-line bg-panel-raised p-4">
        <ArrivalCard values={allowanceValues(allowance)} label={`${allowance.label} for ${allowance.accountName}`}>
          <h5 id={titleId} className="text-sm font-semibold">
            {allowance.label}
          </h5>
          <p className="text-xs text-muted">{allowance.accountName}</p>
          {/* Two columns once provider cards sit two to a row, so quantities and their badges fit. */}
          <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <QuantityCell label="Included" valueKey={allowanceKey(allowance, "included")} value={allowance.included} />
            <QuantityCell label="Used" valueKey={allowanceKey(allowance, "used")} value={allowance.used} />
            <QuantityCell label="Remaining" valueKey={allowanceKey(allowance, "remaining")} value={allowance.remaining} />
            <div>
              <dt className="text-xs font-medium text-muted">Percent used</dt>
              <dd className="mt-1 font-mono font-semibold tabular-nums">
                {percent === null ? (
                  <Unavailable />
                ) : (
                  <ArrivalNumber
                    valueKey={allowanceKey(allowance, "percent")}
                    value={percent}
                    text={formatPercent(percent)}
                    format={{ type: "percent" }}
                  />
                )}
              </dd>
            </div>
          </dl>
          {percent === null ? null : (
            // The number above is the accessible value; the bar only repeats it visually.
            <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-line">
              <ArrivalBar
                valueKey={allowanceKey(allowance, "percent")}
                percent={percent}
                className={percent >= 100 ? "bg-danger" : percent >= 80 ? "bg-warning" : "bg-accent"}
              />
            </div>
          )}
          {/* A point reading has no period and a reading without a reset says nothing of one, so
              neither row is shown as a permanent "Unavailable" (#269). */}
          {allowance.period === null && allowance.resetsAt === null ? null : (
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              {allowance.period === null ? null : (
                <div className="flex gap-1">
                  <dt className="text-muted">Billing period:</dt>
                  <dd>{formatPeriod(allowance.period)}</dd>
                </div>
              )}
              {allowance.resetsAt === null ? null : (
                <div className="flex gap-1">
                  <dt className="text-muted">Resets:</dt>
                  <dd>
                    <time dateTime={allowance.resetsAt}>{formatDateTime(allowance.resetsAt)}</time>
                  </dd>
                </div>
              )}
            </dl>
          )}
          {quota === undefined ? null : (
            <ProjectionNote text={quotaProjectionText(quota)} estimate={quota.status === "runs_out" || quota.status === "within"} />
          )}
          {oldest === null ? null : (
            <div className="mt-2">
              <Freshness retrievedAt={oldest.retrievedAt} stale={stale} now={now} />
            </div>
          )}
        </ArrivalCard>
      </article>
    </li>
  );
}

/**
 * One connection: its spend, revenue, recurring revenue, credit balance, billing period, and
 * allowances, with the spend and quota projections to the end of the period beside them (#167).
 * Only rows the provider can fill are shown (`providerCardFields`, #269); a provider that reports
 * no spend says so in one line. "Simulated" shows here only with `markSimulated`, which the page
 * turns off when it says so once for every connection.
 */
export function ProviderCard({
  summary,
  declared,
  spendProjections,
  quotaProjections,
  now,
  markSimulated,
}: {
  summary: ProviderSummary;
  /** What the provider's adapter declares it reports. */
  declared: DeclaredFields;
  spendProjections: readonly SpendProjection[];
  /** Keyed like `Allowance.key`. */
  quotaProjections: ReadonlyMap<string, AllowanceProjection>;
  now: Date;
  markSimulated: boolean;
}) {
  const titleId = useId();
  const name = providerName(summary.provider);
  const fields = providerCardFields(summary, declared);
  // Allowances are cards of their own, so only the money on this card marks it as changed.
  const values = {
    ...amountValues("spend", summary.spend),
    ...amountValues("revenue", summary.revenue),
    ...creditValues(summary.credits),
    ...recurringValues(summary.recurringRevenue),
  };
  return (
    <li>
      <article aria-labelledby={titleId} className="relative isolate h-full rounded-xl border border-line bg-panel p-4">
        <ArrivalCard values={values} label={summary.name}>
          <header className="flex flex-wrap items-start gap-3">
            <ProviderMark provider={summary.provider} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 id={titleId} className="font-semibold">
                  {summary.name}
                </h3>
                {markSimulated && summary.simulated ? <SimulatedBadge /> : null}
              </div>
              <p className="text-xs text-muted">
                {name}. Status: {connectionStatusLabel(summary.status)}
              </p>
            </div>
            <div className="text-right">
              {summary.lastSyncedAt === null ? (
                <p className="text-xs text-muted">Not synced yet</p>
              ) : (
                <Freshness retrievedAt={summary.lastSyncedAt} stale={summary.stale} now={now} />
              )}
            </div>
          </header>

          {fields.billingPeriod || fields.resetsAt ? (
            <dl className="mt-4 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              {fields.billingPeriod ? (
                <div className="flex gap-1">
                  <dt className="text-muted">Billing period:</dt>
                  <dd>{summary.billingPeriod === null ? <Unavailable /> : formatPeriod(summary.billingPeriod)}</dd>
                </div>
              ) : null}
              {!fields.resetsAt || summary.resetsAt === null ? null : (
                <div className="flex gap-1">
                  <dt className="text-muted">Next reset:</dt>
                  <dd>
                    <time dateTime={summary.resetsAt}>{formatDateTime(summary.resetsAt)}</time>
                  </dd>
                </div>
              )}
            </dl>
          ) : null}

          {fields.spend ? (
            <>
              <h4 className="mt-5 text-sm font-semibold">Spend this billing period</h4>
              {summary.spend.length === 0 ? (
                <p className="mt-1 text-sm">
                  <Unavailable />
                </p>
              ) : (
                <ul className="mt-2 space-y-4">
                  {summary.spend.map((amounts) => (
                    <li key={amounts.currency}>
                      <p className="mb-1 font-mono text-xs font-medium text-muted">{amounts.currency}</p>
                      <CurrencyAmountsList
                        amounts={amounts}
                        group="spend"
                        now={now}
                        verifiedLabel="Verified spend"
                        estimatedLabel="Estimated spend"
                      />
                      <SpendProjectionNote projection={spendProjections.find((projection) => projection.currency === amounts.currency)} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">{name} does not report spend.</p>
          )}

          {fields.credits ? (
            <>
              <h4 className="mt-5 text-sm font-semibold">Credit balance</h4>
              {summary.credits.length === 0 ? (
                <p className="mt-1 text-sm">
                  <Unavailable />
                </p>
              ) : (
                <ul className="mt-2 space-y-3">
                  {summary.credits.map((credit) => (
                    <li key={`${credit.currency}-${credit.provenance.status}`}>
                      <MoneyValueBlock
                        value={credit}
                        valueKey={amountKey("credit", credit.currency, credit.provenance.status)}
                        now={now}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : null}

          {summary.revenue.length === 0 ? null : (
            <>
              <h4 className="mt-5 text-sm font-semibold">Revenue this billing period</h4>
              <ul className="mt-2 space-y-4">
                {summary.revenue.map((amounts) => (
                  <li key={amounts.currency}>
                    <p className="mb-1 font-mono text-xs font-medium text-muted">{amounts.currency}</p>
                    <CurrencyAmountsList
                      amounts={amounts}
                      group="revenue"
                      now={now}
                      verifiedLabel="Verified revenue"
                      estimatedLabel="Estimated revenue"
                    />
                  </li>
                ))}
              </ul>
            </>
          )}

          {summary.recurringRevenue.length === 0 ? null : (
            <>
              {/* Run rates at the time they were read, never added into revenue or spend above. */}
              <h4 className="mt-5 text-sm font-semibold">Recurring revenue</h4>
              <dl className="mt-2 grid gap-4 sm:grid-cols-2">
                {summary.recurringRevenue.map((rate) => (
                  <div key={rate.key}>
                    <dt className="text-xs font-medium text-muted">{rate.label}</dt>
                    <dd className="mt-1">
                      <MoneyValueBlock value={rate.value} valueKey={recurringKey(rate)} now={now} />
                    </dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {summary.allowances.length === 0 ? null : (
            <>
              <h4 className="mt-5 text-sm font-semibold">Allowances</h4>
              <ul className="mt-2 space-y-3">
                {summary.allowances.map((allowance) => (
                  <AllowanceCard key={allowance.key} allowance={allowance} quota={quotaProjections.get(allowance.key)?.quota} now={now} />
                ))}
              </ul>
            </>
          )}
        </ArrivalCard>
      </article>
    </li>
  );
}
