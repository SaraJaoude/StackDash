-- Polar adapter (20261105002846_polar_provider.sql, 20261105002847_recurring_revenue_shape.sql):
-- the provider id exists, and recurring revenue is stored as money that is never negative.
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- Fixtures as postgres: one owner, one workspace, one Polar connection with one organization.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('a8000001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-polar-owner@example.com', '{"user_name": "rls-polar-owner"}', '{"provider": "github", "providers": ["github"]}', now(), now());

insert into public.workspaces (id, name, created_by)
values ('a80000a0-0000-4000-8000-000000000000', 'Polar team', 'a8000001-0000-4000-8000-000000000000');

insert into public.workspace_members (workspace_id, user_id, role)
values ('a80000a0-0000-4000-8000-000000000000', 'a8000001-0000-4000-8000-000000000000', 'owner');

insert into public.connections (id, workspace_id, provider, status, display_name, poll_interval_seconds)
values ('a80000c1-0000-4000-8000-000000000000', 'a80000a0-0000-4000-8000-000000000000', 'polar', 'active',
        'Polar (Example organization)', 3600);

insert into public.external_accounts (id, workspace_id, connection_id, external_id, display_name, kind)
values ('a80000e1-0000-4000-8000-000000000000', 'a80000a0-0000-4000-8000-000000000000',
        'a80000c1-0000-4000-8000-000000000000', '1dbfc517-0bbf-4301-9ba8-555ca42b9737', 'Example organization', 'organization');

select ok(
  'polar' = any (enum_range(null::public.provider_id)::text[]),
  'provider_id: polar is a provider');

select ok(
  'recurring_revenue' = any (enum_range(null::public.metric_kind)::text[]),
  'metric_kind: recurring_revenue is a metric kind');

select lives_ok(
  $$
    insert into public.usage_snapshots (
      workspace_id, connection_id, external_account_id, metric_key, kind, label, snapshot_date,
      amount_minor, currency, point_at, retrieved_at, provenance_source
    )
    values ('a80000a0-0000-4000-8000-000000000000', 'a80000c1-0000-4000-8000-000000000000',
            'a80000e1-0000-4000-8000-000000000000', 'polar.mrr.usd', 'recurring_revenue',
            'Monthly recurring revenue (USD)', date '2026-11-05', 125000, 'USD',
            timestamptz '2026-11-05 12:00:00+00', now(), 'provider_api')
  $$,
  'recurring_revenue: an amount and a currency are accepted');

select lives_ok(
  $$
    insert into public.usage_snapshots (
      workspace_id, connection_id, external_account_id, metric_key, kind, label, snapshot_date,
      amount_minor, currency, point_at, retrieved_at, provenance_source
    )
    values ('a80000a0-0000-4000-8000-000000000000', 'a80000c1-0000-4000-8000-000000000000',
            'a80000e1-0000-4000-8000-000000000000', 'polar.arr.usd', 'recurring_revenue',
            'Annual recurring revenue (USD)', date '2026-11-05', 0, 'USD',
            timestamptz '2026-11-05 12:00:00+00', now(), 'provider_api')
  $$,
  'recurring_revenue: zero, a business with no subscriptions yet, is accepted');

select throws_ok(
  $$
    insert into public.usage_snapshots (
      workspace_id, connection_id, external_account_id, metric_key, kind, label, snapshot_date,
      value, unit, point_at, retrieved_at, provenance_source
    )
    values ('a80000a0-0000-4000-8000-000000000000', 'a80000c1-0000-4000-8000-000000000000',
            'a80000e1-0000-4000-8000-000000000000', 'polar.mrr.quantity', 'recurring_revenue',
            'Monthly recurring revenue', date '2026-11-05', 1250, 'USD',
            timestamptz '2026-11-05 12:00:00+00', now(), 'provider_api')
  $$,
  '23514', null,
  'recurring_revenue: a quantity instead of money is rejected by the value shape check');

select throws_ok(
  $$
    insert into public.usage_snapshots (
      workspace_id, connection_id, external_account_id, metric_key, kind, label, snapshot_date,
      amount_minor, currency, point_at, retrieved_at, provenance_source
    )
    values ('a80000a0-0000-4000-8000-000000000000', 'a80000c1-0000-4000-8000-000000000000',
            'a80000e1-0000-4000-8000-000000000000', 'polar.mrr.negative', 'recurring_revenue',
            'Monthly recurring revenue (USD)', date '2026-11-05', -1, 'USD',
            timestamptz '2026-11-05 12:00:00+00', now(), 'provider_api')
  $$,
  '23514', null,
  'recurring_revenue: a negative amount is rejected');

-- Control: the replaced value shape check still holds for the kinds it covered before.
select throws_ok(
  $$
    insert into public.usage_snapshots (
      workspace_id, connection_id, external_account_id, metric_key, kind, label, snapshot_date,
      amount_minor, currency, value, unit, point_at, retrieved_at, provenance_source
    )
    values ('a80000a0-0000-4000-8000-000000000000', 'a80000c1-0000-4000-8000-000000000000',
            'a80000e1-0000-4000-8000-000000000000', 'polar.revenue.month.usd', 'revenue',
            'Revenue before fees, this month (USD)', date '2026-11-05', 100, 'USD', 1, 'orders',
            timestamptz '2026-11-05 12:00:00+00', now(), 'provider_api')
  $$,
  '23514', null,
  'value shape: revenue with a quantity as well as money is still rejected');

-- Control: the recreated non-negative check still holds for spend.
select throws_ok(
  $$
    insert into public.usage_snapshots (
      workspace_id, connection_id, external_account_id, metric_key, kind, label, snapshot_date,
      amount_minor, currency, period_start, period_end, retrieved_at, provenance_source
    )
    values ('a80000a0-0000-4000-8000-000000000000', 'a80000c1-0000-4000-8000-000000000000',
            'a80000e1-0000-4000-8000-000000000000', 'polar.fees.month.usd', 'verified_spend',
            'Polar fees, this month (USD)', date '2026-11-05', -1, 'USD',
            timestamptz '2026-11-01 00:00:00+00', timestamptz '2026-11-05 12:00:00+00', now(), 'provider_api')
  $$,
  '23514', null,
  'spend: a negative amount is still rejected');

select * from finish();
rollback;
