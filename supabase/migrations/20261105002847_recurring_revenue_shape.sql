-- Recurring revenue is money (issue #114): amount in minor units plus an ISO 4217 code, like the
-- other money kinds, and never negative, like spend. Both checks from
-- 20261031090200_metrics_events_alerts.sql that list kinds are replaced with ones that list the new
-- kind, so each rule stays in one place; the enum value itself was added in
-- 20261105002846_polar_provider.sql.

alter table public.usage_snapshots drop constraint usage_snapshots_value_shape;

alter table public.usage_snapshots add constraint usage_snapshots_value_shape check (
  case
    when kind in ('verified_spend', 'estimated_spend', 'credit_balance', 'revenue', 'recurring_revenue') then
      amount_minor is not null and currency is not null and value is null and unit is null
    else
      value is not null and unit is not null and amount_minor is null and currency is null
  end
);

-- Spend and recurring revenue are never negative; revenue and credit balance may be (refunds, money owed).
alter table public.usage_snapshots drop constraint usage_snapshots_spend_nonnegative;

alter table public.usage_snapshots add constraint usage_snapshots_spend_nonnegative check (
  kind not in ('verified_spend', 'estimated_spend', 'recurring_revenue') or amount_minor >= 0
);
