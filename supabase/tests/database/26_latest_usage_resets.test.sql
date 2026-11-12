-- latest_usage_resets (20261112100901_latest_usage_resets_skip_scan.sql, #346): the reset time on
-- the newest snapshot of each metric of one account, read one row per metric instead of the whole
-- history. Its bound is one row per metric: an account with no rows (under), a metric with one row
-- (at), and metrics with a year of daily rows (over) each return exactly their newest row, the same
-- answer the distinct on query it replaces gave.
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- Fixtures as postgres: workspaces W and W2, a connection each. Account A (W) has 12 metrics with a
-- daily row from 2025-11-12 to 2026-11-12, metric keys that share prefixes, and one metric with a
-- single row. Account E (W) has no rows. Account B (W2) has rows of its own.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values ('f3460001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'resets-owner@example.com', '{"user_name": "resets-owner"}', '{"provider": "github", "providers": ["github"]}', now(), now());

insert into public.workspaces (id, name, created_by)
values
  ('f34600a0-0000-4000-8000-000000000000', 'Resets team', 'f3460001-0000-4000-8000-000000000000'),
  ('f34600b0-0000-4000-8000-000000000000', 'Other resets team', 'f3460001-0000-4000-8000-000000000000');

insert into public.connections (id, workspace_id, provider, status, display_name, poll_interval_seconds)
values
  ('f34600c1-0000-4000-8000-000000000000', 'f34600a0-0000-4000-8000-000000000000', 'fake', 'active', 'Resets C1', 3600),
  ('f34600c2-0000-4000-8000-000000000000', 'f34600b0-0000-4000-8000-000000000000', 'fake', 'active', 'Resets C2', 3600);

insert into public.external_accounts (id, workspace_id, connection_id, external_id, display_name, kind)
values
  ('f34600e1-0000-4000-8000-000000000000', 'f34600a0-0000-4000-8000-000000000000', 'f34600c1-0000-4000-8000-000000000000', 'a', 'A', 'team'),
  ('f34600e2-0000-4000-8000-000000000000', 'f34600a0-0000-4000-8000-000000000000', 'f34600c1-0000-4000-8000-000000000000', 'e', 'E', 'team'),
  ('f34600e3-0000-4000-8000-000000000000', 'f34600b0-0000-4000-8000-000000000000', 'f34600c2-0000-4000-8000-000000000000', 'b', 'B', 'team');

-- A: 12 metrics a day for 366 days. The reset is the first of the next month, except on even
-- metrics' newest row, where the provider reported none (null).
insert into public.usage_snapshots (workspace_id, connection_id, external_account_id, metric_key, kind, label,
  snapshot_date, value, unit, point_at, retrieved_at, resets_at, provenance_source)
select 'f34600a0-0000-4000-8000-000000000000', 'f34600c1-0000-4000-8000-000000000000', 'f34600e1-0000-4000-8000-000000000000',
  format('fake.requests%s.count', case when m = 0 then '' else '_' || m end), 'included_allowance', format('Requests %s', m),
  d::date, 100, 'requests', d, d,
  case when d = '2026-11-12' and m % 2 = 0 then null else date_trunc('month', d) + interval '1 month' end,
  'provider_api'
from generate_series(0, 11) m
cross join generate_series('2025-11-12'::timestamp, '2026-11-12'::timestamp, interval '1 day') d;

-- A: one metric with a single row.
insert into public.usage_snapshots (workspace_id, connection_id, external_account_id, metric_key, kind, label,
  snapshot_date, value, unit, point_at, retrieved_at, resets_at, provenance_source)
values ('f34600a0-0000-4000-8000-000000000000', 'f34600c1-0000-4000-8000-000000000000', 'f34600e1-0000-4000-8000-000000000000',
  'fake.builds.count', 'included_allowance', 'Builds', '2026-03-04', 10, 'builds', '2026-03-04T06:00:00Z',
  '2026-03-04T06:00:00Z', '2026-04-01T00:00:00Z', 'provider_api');

-- B: rows of another workspace's account.
insert into public.usage_snapshots (workspace_id, connection_id, external_account_id, metric_key, kind, label,
  snapshot_date, value, unit, point_at, retrieved_at, resets_at, provenance_source)
values ('f34600b0-0000-4000-8000-000000000000', 'f34600c2-0000-4000-8000-000000000000', 'f34600e3-0000-4000-8000-000000000000',
  'fake.requests.count', 'included_allowance', 'Requests', '2026-11-12', 10, 'requests', '2026-11-12T06:00:00Z',
  '2026-11-12T06:00:00Z', '2026-12-01T00:00:00Z', 'provider_api');

-- The query latest_usage_resets ran before #346, for comparison.
create function pg_temp.distinct_on_resets(p_workspace_id uuid, p_external_account_id uuid)
returns table (metric_key text, resets_at timestamptz) language sql as $$
  select distinct on (s.metric_key) s.metric_key, s.resets_at
  from public.usage_snapshots s
  where s.workspace_id = p_workspace_id and s.external_account_id = p_external_account_id
  order by s.metric_key, s.snapshot_date desc
$$;

set local role service_role;

-- ---------------------------------------------------------------------------
-- Under, at, and over the bound of one row per metric.
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select 1 from public.latest_usage_resets('f34600a0-0000-4000-8000-000000000000', 'f34600e2-0000-4000-8000-000000000000') $$,
  'latest_usage_resets: an account with no snapshot returns nothing');

select results_eq(
  $$
    select resets_at from public.latest_usage_resets('f34600a0-0000-4000-8000-000000000000', 'f34600e1-0000-4000-8000-000000000000')
    where metric_key = 'fake.builds.count'
  $$,
  $$ values ('2026-04-01T00:00:00Z'::timestamptz) $$,
  'latest_usage_resets: a metric with one row returns that row''s reset');

select results_eq(
  $$
    select metric_key, resets_at
    from public.latest_usage_resets('f34600a0-0000-4000-8000-000000000000', 'f34600e1-0000-4000-8000-000000000000')
    where metric_key in ('fake.requests.count', 'fake.requests_1.count')
    order by metric_key collate "C"
  $$,
  $$
    values
      ('fake.requests.count', null::timestamptz),
      ('fake.requests_1.count', '2026-12-01T00:00:00Z'::timestamptz)
  $$,
  'latest_usage_resets: a metric with a year of daily rows returns its newest row''s reset, null when the newest has none');

select is(
  (select count(*)::int from public.latest_usage_resets('f34600a0-0000-4000-8000-000000000000', 'f34600e1-0000-4000-8000-000000000000')),
  13,
  'latest_usage_resets: one row per metric over 4,393 rows');

select results_eq(
  $$
    select metric_key, resets_at
    from public.latest_usage_resets('f34600a0-0000-4000-8000-000000000000', 'f34600e1-0000-4000-8000-000000000000')
    order by metric_key
  $$,
  $$ select metric_key, resets_at from pg_temp.distinct_on_resets('f34600a0-0000-4000-8000-000000000000', 'f34600e1-0000-4000-8000-000000000000') order by metric_key $$,
  'latest_usage_resets: the same rows as the distinct on query it replaces');

-- ---------------------------------------------------------------------------
-- The workspace has to match the account.
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select 1 from public.latest_usage_resets('f34600b0-0000-4000-8000-000000000000', 'f34600e1-0000-4000-8000-000000000000') $$,
  'latest_usage_resets: an account of another workspace returns nothing');

select results_eq(
  $$ select metric_key, resets_at from public.latest_usage_resets('f34600b0-0000-4000-8000-000000000000', 'f34600e3-0000-4000-8000-000000000000') $$,
  $$ values ('fake.requests.count', '2026-12-01T00:00:00Z'::timestamptz) $$,
  'latest_usage_resets: each account reads only its own rows');

reset role;

-- ---------------------------------------------------------------------------
-- Still the sync's alone.
-- ---------------------------------------------------------------------------
set local role authenticated;
select throws_ok(
  $$ select public.latest_usage_resets('f34600a0-0000-4000-8000-000000000000', 'f34600e1-0000-4000-8000-000000000000') $$,
  '42501'::char(5), null::text,
  'latest_usage_resets: authenticated cannot call it');
reset role;

set local role anon;
select throws_ok(
  $$ select public.latest_usage_resets('f34600a0-0000-4000-8000-000000000000', 'f34600e1-0000-4000-8000-000000000000') $$,
  '42501'::char(5), null::text,
  'latest_usage_resets: anon cannot call it');
reset role;

select * from finish();
rollback;
