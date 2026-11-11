-- Monthly trend rollup (20261112091000_usage_snapshot_monthly_latest.sql, #317):
-- usage_snapshot_monthly_latest returns each account's latest row per metric, currency or unit,
-- and UTC month from p_since, whatever the number of daily rows behind it: just under, at, and over
-- the 10,000 row cap the snapshot read used to stop at, every month is there and the newest row of
-- each month is the one returned. A non-member reads nothing.
begin;

create extension if not exists pgtap with schema extensions;

select plan(17);

-- Fixtures as postgres: a member and an outsider, one workspace with two accounts.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('b3170001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'monthly-member@example.com', '{"user_name": "monthly-member"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('b3170002-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'monthly-outsider@example.com', '{"user_name": "monthly-outsider"}', '{"provider": "github", "providers": ["github"]}', now(), now());

insert into public.workspaces (id, name, created_by)
values ('b31700a0-0000-4000-8000-000000000000', 'Monthly trend team', 'b3170001-0000-4000-8000-000000000000');

insert into public.workspace_members (workspace_id, user_id, role)
values ('b31700a0-0000-4000-8000-000000000000', 'b3170001-0000-4000-8000-000000000000', 'viewer')
on conflict do nothing;

insert into public.connections (id, workspace_id, provider, status, display_name, poll_interval_seconds)
values ('b31700c0-0000-4000-8000-000000000000', 'b31700a0-0000-4000-8000-000000000000', 'fake', 'active',
        'Monthly connection', 3600);

insert into public.external_accounts (id, workspace_id, connection_id, external_id, display_name, kind)
values
  ('b31700e1-0000-4000-8000-000000000000', 'b31700a0-0000-4000-8000-000000000000',
   'b31700c0-0000-4000-8000-000000000000', 'ext-monthly-busy', 'Busy account', 'team'),
  ('b31700e2-0000-4000-8000-000000000000', 'b31700a0-0000-4000-8000-000000000000',
   'b31700c0-0000-4000-8000-000000000000', 'ext-monthly-money', 'Money account', 'team');

-- The busy account: 27 usage metrics, one row a day each, filled day by day from 2025-11-01 (row i
-- is metric i % 27 on day i / 27). 9,999 rows end on 2026-11-06 with metric 8, so metrics 9 to 26
-- last reported on 2026-11-05. Every metric has rows in all 13 months from 2025-11 to 2026-11.
create function pg_temp.busy_rows(p_from int, p_to int) returns void language sql as $$
  insert into public.usage_snapshots (workspace_id, connection_id, external_account_id, metric_key, kind, label,
    snapshot_date, value, unit, point_at, retrieved_at, provenance_source)
  select 'b31700a0-0000-4000-8000-000000000000', 'b31700c0-0000-4000-8000-000000000000',
    'b31700e1-0000-4000-8000-000000000000', format('fake.metric_%s.count', lpad((i % 27)::text, 2, '0')), 'usage',
    format('Metric %s', i % 27), '2025-11-01'::date + i / 27, i, 'requests',
    ('2025-11-01'::date + i / 27)::timestamp at time zone 'UTC', ('2025-11-01'::date + i / 27)::timestamp at time zone 'UTC',
    'provider_api'
  from generate_series(p_from, p_to) i;
$$;

-- What the member sees for the busy account: rows, months, and the latest date of two metrics in
-- the current month.
create function pg_temp.busy_summary() returns table (rollup_rows bigint, months bigint, metric_08 date, metric_09 date)
language sql as $$
  select count(*), count(distinct date_trunc('month', l.snapshot_date::timestamp)),
    max(l.snapshot_date) filter (where l.metric_key = 'fake.metric_08.count'),
    max(l.snapshot_date) filter (where l.metric_key = 'fake.metric_09.count')
  from public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', '2025-11-01') l
  where l.external_account_id = 'b31700e1-0000-4000-8000-000000000000';
$$;

select pg_temp.busy_rows(0, 9998);

-- The money account: verified spend in USD and then EUR within October 2026, and one row the day
-- before p_since.
insert into public.usage_snapshots (workspace_id, connection_id, external_account_id, metric_key, kind, label,
  snapshot_date, amount_minor, currency, point_at, retrieved_at, provenance_source)
values
  ('b31700a0-0000-4000-8000-000000000000', 'b31700c0-0000-4000-8000-000000000000', 'b31700e2-0000-4000-8000-000000000000',
   'fake.spend.month', 'verified_spend', 'Spend this month', '2025-10-31', 50, 'USD', '2025-10-31T06:00:00Z', '2025-10-31T06:00:00Z', 'provider_api'),
  ('b31700a0-0000-4000-8000-000000000000', 'b31700c0-0000-4000-8000-000000000000', 'b31700e2-0000-4000-8000-000000000000',
   'fake.spend.month', 'verified_spend', 'Spend this month', '2025-11-01', 60, 'USD', '2025-11-01T06:00:00Z', '2025-11-01T06:00:00Z', 'provider_api'),
  ('b31700a0-0000-4000-8000-000000000000', 'b31700c0-0000-4000-8000-000000000000', 'b31700e2-0000-4000-8000-000000000000',
   'fake.spend.month', 'verified_spend', 'Spend this month', '2026-10-01', 100, 'USD', '2026-10-01T06:00:00Z', '2026-10-01T06:00:00Z', 'provider_api'),
  ('b31700a0-0000-4000-8000-000000000000', 'b31700c0-0000-4000-8000-000000000000', 'b31700e2-0000-4000-8000-000000000000',
   'fake.spend.month', 'verified_spend', 'Spend this month', '2026-10-14', 200, 'USD', '2026-10-14T06:00:00Z', '2026-10-14T06:00:00Z', 'provider_api'),
  ('b31700a0-0000-4000-8000-000000000000', 'b31700c0-0000-4000-8000-000000000000', 'b31700e2-0000-4000-8000-000000000000',
   'fake.spend.month', 'verified_spend', 'Spend this month', '2026-10-20', 300, 'EUR', '2026-10-20T06:00:00Z', '2026-10-20T06:00:00Z', 'provider_api'),
  ('b31700a0-0000-4000-8000-000000000000', 'b31700c0-0000-4000-8000-000000000000', 'b31700e2-0000-4000-8000-000000000000',
   'fake.spend.month', 'verified_spend', 'Spend this month', '2026-10-31', 400, 'EUR', '2026-10-31T06:00:00Z', '2026-10-31T06:00:00Z', 'provider_api');

-- ---------------------------------------------------------------------------
-- Shape: security definer with an empty search_path, members only.
-- ---------------------------------------------------------------------------
select is_empty(
  $$
    select p.oid::regprocedure::text || ': ' || v.problem
    from pg_catalog.pg_proc p
    cross join lateral (
      values
        (case when not p.prosecdef then 'security invoker' end),
        (case when not coalesce(p.proconfig && array['search_path=""', 'search_path='], false) then 'search_path not empty' end),
        (case when has_function_privilege('anon', p.oid, 'execute') then 'executable by anon' end),
        (case when has_function_privilege('service_role', p.oid, 'execute') then 'executable by service_role' end),
        (case when not has_function_privilege('authenticated', p.oid, 'execute') then 'not executable by authenticated' end)
    ) as v(problem)
    where p.oid = 'public.usage_snapshot_monthly_latest(uuid, date)'::regprocedure
      and v.problem is not null
  $$,
  'usage_snapshot_monthly_latest: security definer, empty search_path, executable by authenticated only');

set local role authenticated;
set local request.jwt.claims to '{"sub": "b3170001-0000-4000-8000-000000000000", "role": "authenticated"}';

-- ---------------------------------------------------------------------------
-- Just under, at, and over the 10,000 row cap: one row per metric and month, all 13 months.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select * from pg_temp.busy_summary() $$,
  $$ values (351::bigint, 13::bigint, '2026-11-06'::date, '2026-11-05'::date) $$,
  'usage_snapshot_monthly_latest: 9,999 daily rows give 27 metrics times 13 months, the oldest month included');

reset role;
select pg_temp.busy_rows(9999, 9999);
set local role authenticated;

select results_eq(
  $$ select * from pg_temp.busy_summary() $$,
  $$ values (351::bigint, 13::bigint, '2026-11-06'::date, '2026-11-06'::date) $$,
  'usage_snapshot_monthly_latest: at 10,000 daily rows every month is still there, and the newest row replaces its month''s');

reset role;
select pg_temp.busy_rows(10000, 10000);
set local role authenticated;

select results_eq(
  $$ select * from pg_temp.busy_summary() $$,
  $$ values (351::bigint, 13::bigint, '2026-11-06'::date, '2026-11-06'::date) $$,
  'usage_snapshot_monthly_latest: over 10,000 daily rows the oldest months are not cut');

select is(
  (select count(*)::int from public.usage_snapshots where external_account_id = 'b31700e1-0000-4000-8000-000000000000'),
  10001,
  'usage_snapshot_monthly_latest: the busy account holds 10,001 daily rows');

-- ---------------------------------------------------------------------------
-- The row of a month is its latest, whole.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select l.snapshot_date, l.value, l.unit, l.kind::text, l.label
    from public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', '2025-11-01') l
    where l.metric_key = 'fake.metric_00.count'
      and l.snapshot_date < '2026-01-01'
    order by l.snapshot_date
  $$,
  $$
    values
      ('2025-11-30'::date, 783::double precision, 'requests', 'usage', 'Metric 0'),
      ('2025-12-31'::date, 1620::double precision, 'requests', 'usage', 'Metric 0')
  $$,
  'usage_snapshot_monthly_latest: each month returns its last day''s row with every column');

select results_eq(
  $$
    select l.snapshot_date, l.currency::text, l.amount_minor
    from public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', '2025-11-01') l
    where l.external_account_id = 'b31700e2-0000-4000-8000-000000000000'
    order by l.snapshot_date
  $$,
  $$
    values
      ('2025-11-01'::date, 'USD', 60::bigint),
      ('2026-10-14'::date, 'USD', 200::bigint),
      ('2026-10-31'::date, 'EUR', 400::bigint)
  $$,
  'usage_snapshot_monthly_latest: p_since is included, the day before is not, and each currency keeps its own latest row');

select results_eq(
  $$
    select l.snapshot_date
    from public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', '2026-10-15') l
    where l.external_account_id = 'b31700e2-0000-4000-8000-000000000000'
    order by l.snapshot_date
  $$,
  $$ values ('2026-10-31'::date) $$,
  'usage_snapshot_monthly_latest: a month that starts before p_since keeps only the rows from p_since');

-- A session time zone far from UTC does not move rows between months.
set local timezone to 'Pacific/Kiritimati';
select is(
  (
    select count(*)::int
    from public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', '2025-11-01') l
    where l.external_account_id = 'b31700e1-0000-4000-8000-000000000000'
  ),
  351,
  'usage_snapshot_monthly_latest: groups by UTC month in a UTC+14 session');
set local timezone to 'America/Los_Angeles';
select is(
  (
    select count(*)::int
    from public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', '2025-11-01') l
    where l.external_account_id = 'b31700e1-0000-4000-8000-000000000000'
  ),
  351,
  'usage_snapshot_monthly_latest: groups by UTC month in a UTC-8 session');
reset timezone;

select is_empty(
  $$ select 1 from public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', '2026-11-12') $$,
  'usage_snapshot_monthly_latest: no row from p_since onward returns nothing');

select is_empty(
  $$ select 1 from public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', null) $$,
  'usage_snapshot_monthly_latest: a null p_since returns nothing');

select is_empty(
  $$ select 1 from public.usage_snapshot_monthly_latest('b31700a9-0000-4000-8000-000000000000', '2025-11-01') $$,
  'usage_snapshot_monthly_latest: a workspace that does not exist returns nothing');

-- ---------------------------------------------------------------------------
-- Non-members read nothing.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "b3170002-0000-4000-8000-000000000000", "role": "authenticated"}';

select is_empty(
  $$ select 1 from public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', '2025-11-01') $$,
  'usage_snapshot_monthly_latest: a non-member reads nothing in another workspace');

select is_empty(
  $$ select 1 from public.usage_snapshots where workspace_id = 'b31700a0-0000-4000-8000-000000000000' $$,
  'usage_snapshot_monthly_latest: the outsider reads no snapshot of the workspace directly either');

reset role;
reset request.jwt.claims;

set local role anon;
select throws_ok(
  $$ select public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', '2025-11-01') $$,
  '42501'::char(5), null::text,
  'usage_snapshot_monthly_latest: anon cannot call it');
reset role;

set local role service_role;
select throws_ok(
  $$ select public.usage_snapshot_monthly_latest('b31700a0-0000-4000-8000-000000000000', '2025-11-01') $$,
  '42501'::char(5), null::text,
  'usage_snapshot_monthly_latest: the service role cannot call it');
reset role;

select * from finish();
rollback;
