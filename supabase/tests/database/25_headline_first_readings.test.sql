-- Headline first readings (20261112100900_headline_first_readings.sql and
-- 20261112100902_headline_first_readings_connection_probe.sql, #346): one call returns each
-- connection's oldest snapshot on or before a day, for the accounts passed in, for zero, one, and
-- many connections; members only.
begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

-- Fixtures as postgres: a viewer of workspace W and an outsider who owns W2. W has connection C1
-- with accounts X1 and X2, C2 with X3, and C3 with X4; W2 has C4 with X5.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('e3460001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'first-viewer@example.com', '{"user_name": "first-viewer"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('e3460002-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'first-outsider@example.com', '{"user_name": "first-outsider"}', '{"provider": "github", "providers": ["github"]}', now(), now());

insert into public.workspaces (id, name, created_by)
values
  ('e34600a0-0000-4000-8000-000000000000', 'First readings team', 'e3460001-0000-4000-8000-000000000000'),
  ('e34600b0-0000-4000-8000-000000000000', 'Other first readings team', 'e3460002-0000-4000-8000-000000000000');

insert into public.workspace_members (workspace_id, user_id, role)
values
  ('e34600a0-0000-4000-8000-000000000000', 'e3460001-0000-4000-8000-000000000000', 'viewer'),
  ('e34600b0-0000-4000-8000-000000000000', 'e3460002-0000-4000-8000-000000000000', 'owner');

insert into public.connections (id, workspace_id, provider, status, display_name, poll_interval_seconds)
values
  ('e34600c1-0000-4000-8000-000000000000', 'e34600a0-0000-4000-8000-000000000000', 'fake', 'active', 'First C1', 3600),
  ('e34600c2-0000-4000-8000-000000000000', 'e34600a0-0000-4000-8000-000000000000', 'fake', 'active', 'First C2', 3600),
  ('e34600c3-0000-4000-8000-000000000000', 'e34600a0-0000-4000-8000-000000000000', 'fake', 'active', 'First C3', 3600),
  ('e34600c4-0000-4000-8000-000000000000', 'e34600b0-0000-4000-8000-000000000000', 'fake', 'active', 'First C4', 3600);

insert into public.external_accounts (id, workspace_id, connection_id, external_id, display_name, kind)
values
  ('e34600e1-0000-4000-8000-000000000000', 'e34600a0-0000-4000-8000-000000000000', 'e34600c1-0000-4000-8000-000000000000', 'x1', 'X1', 'team'),
  ('e34600e2-0000-4000-8000-000000000000', 'e34600a0-0000-4000-8000-000000000000', 'e34600c1-0000-4000-8000-000000000000', 'x2', 'X2', 'team'),
  ('e34600e3-0000-4000-8000-000000000000', 'e34600a0-0000-4000-8000-000000000000', 'e34600c2-0000-4000-8000-000000000000', 'x3', 'X3', 'team'),
  ('e34600e4-0000-4000-8000-000000000000', 'e34600a0-0000-4000-8000-000000000000', 'e34600c3-0000-4000-8000-000000000000', 'x4', 'X4', 'team'),
  ('e34600e5-0000-4000-8000-000000000000', 'e34600b0-0000-4000-8000-000000000000', 'e34600c4-0000-4000-8000-000000000000', 'x5', 'X5', 'team');

-- X1 from 2026-10-05, X2 from 2026-10-01 (so C1 starts with X2), X3 from 2026-11-09 exactly, X4 only
-- after it, X5 in the other workspace from 2026-09-01.
insert into public.usage_snapshots (workspace_id, connection_id, external_account_id, metric_key, kind, label,
  snapshot_date, value, unit, point_at, retrieved_at, provenance_source)
select v.workspace_id::uuid, v.connection_id::uuid, v.account_id::uuid, 'fake.requests.count', 'usage', 'Requests',
  v.day::date, 1, 'requests', v.day::timestamptz, v.day::timestamptz, 'provider_api'
from (values
  ('e34600a0-0000-4000-8000-000000000000', 'e34600c1-0000-4000-8000-000000000000', 'e34600e1-0000-4000-8000-000000000000', '2026-10-05'),
  ('e34600a0-0000-4000-8000-000000000000', 'e34600c1-0000-4000-8000-000000000000', 'e34600e1-0000-4000-8000-000000000000', '2026-10-10'),
  ('e34600a0-0000-4000-8000-000000000000', 'e34600c1-0000-4000-8000-000000000000', 'e34600e2-0000-4000-8000-000000000000', '2026-10-01'),
  ('e34600a0-0000-4000-8000-000000000000', 'e34600c2-0000-4000-8000-000000000000', 'e34600e3-0000-4000-8000-000000000000', '2026-11-09'),
  ('e34600a0-0000-4000-8000-000000000000', 'e34600c2-0000-4000-8000-000000000000', 'e34600e3-0000-4000-8000-000000000000', '2026-11-10'),
  ('e34600a0-0000-4000-8000-000000000000', 'e34600c3-0000-4000-8000-000000000000', 'e34600e4-0000-4000-8000-000000000000', '2026-11-10'),
  ('e34600b0-0000-4000-8000-000000000000', 'e34600c4-0000-4000-8000-000000000000', 'e34600e5-0000-4000-8000-000000000000', '2026-09-01')
) as v (workspace_id, connection_id, account_id, day);

-- ---------------------------------------------------------------------------
-- Shape: security definer, empty search_path, members only; the index each probe uses.
-- ---------------------------------------------------------------------------
select is_empty(
  $$
    select v.problem
    from pg_catalog.pg_proc p
    cross join lateral (
      values
        (case when not p.prosecdef then 'security invoker' end),
        (case when not coalesce(p.proconfig && array['search_path=""', 'search_path='], false) then 'search_path not empty' end),
        (case when has_function_privilege('anon', p.oid, 'execute') then 'executable by anon' end),
        (case when has_function_privilege('service_role', p.oid, 'execute') then 'executable by service_role' end),
        (case when not has_function_privilege('authenticated', p.oid, 'execute') then 'not executable by authenticated' end)
    ) as v(problem)
    where p.oid = 'public.headline_first_readings(uuid, uuid[], date)'::regprocedure
      and v.problem is not null
  $$,
  'headline_first_readings: security definer, empty search_path, executable by authenticated only');

select has_index(
  'public', 'usage_snapshots', 'usage_snapshots_connection_date_idx', array['connection_id', 'snapshot_date'],
  'headline_first_readings: usage_snapshots is indexed on (connection_id, snapshot_date)');

select hasnt_index(
  'public', 'usage_snapshots', 'usage_snapshots_connection_id_idx',
  'headline_first_readings: the connection_id index it replaces is gone');

set local role authenticated;
set local request.jwt.claims to '{"sub": "e3460001-0000-4000-8000-000000000000", "role": "authenticated"}';

-- ---------------------------------------------------------------------------
-- Zero, one, and many connections.
-- ---------------------------------------------------------------------------
select is_empty(
  $$ select 1 from public.headline_first_readings('e34600a0-0000-4000-8000-000000000000', array[]::uuid[], '2026-11-09') $$,
  'headline_first_readings: no account in view reads no connection');

select results_eq(
  $$
    select connection_id, snapshot_date
    from public.headline_first_readings('e34600a0-0000-4000-8000-000000000000',
      array['e34600e3-0000-4000-8000-000000000000']::uuid[], '2026-11-09')
  $$,
  $$ values ('e34600c2-0000-4000-8000-000000000000'::uuid, '2026-11-09'::date) $$,
  'headline_first_readings: one connection returns its oldest reading, a reading on the day itself included');

select results_eq(
  $$
    select connection_id, snapshot_date
    from public.headline_first_readings('e34600a0-0000-4000-8000-000000000000', array[
      'e34600e1-0000-4000-8000-000000000000', 'e34600e2-0000-4000-8000-000000000000',
      'e34600e3-0000-4000-8000-000000000000', 'e34600e4-0000-4000-8000-000000000000']::uuid[], '2026-11-09')
    order by connection_id
  $$,
  $$
    values
      ('e34600c1-0000-4000-8000-000000000000'::uuid, '2026-10-01'::date),
      ('e34600c2-0000-4000-8000-000000000000'::uuid, '2026-11-09'::date)
  $$,
  'headline_first_readings: many connections in one call, each its oldest reading over all its accounts, none for a connection with no reading by then');

select is_empty(
  $$
    select 1 from public.headline_first_readings('e34600a0-0000-4000-8000-000000000000',
      array['e34600e3-0000-4000-8000-000000000000']::uuid[], '2026-11-08')
  $$,
  'headline_first_readings: a reading the day after is not a first reading');

-- ---------------------------------------------------------------------------
-- Only the accounts passed in count.
-- ---------------------------------------------------------------------------
select results_eq(
  $$
    select connection_id, snapshot_date
    from public.headline_first_readings('e34600a0-0000-4000-8000-000000000000',
      array['e34600e1-0000-4000-8000-000000000000']::uuid[], '2026-11-09')
  $$,
  $$ values ('e34600c1-0000-4000-8000-000000000000'::uuid, '2026-10-05'::date) $$,
  'headline_first_readings: an account of the connection left out of view does not move its first reading');

select is_empty(
  $$
    select 1 from public.headline_first_readings('e34600a0-0000-4000-8000-000000000000',
      array['e34600e5-0000-4000-8000-000000000000']::uuid[], '2026-11-09')
  $$,
  'headline_first_readings: an account of another workspace reads nothing');

select is_empty(
  $$ select 1 from public.headline_first_readings('e34600a0-0000-4000-8000-000000000000', null, '2026-11-09') $$,
  'headline_first_readings: null accounts read nothing');

select is_empty(
  $$
    select 1 from public.headline_first_readings('e34600a0-0000-4000-8000-000000000000',
      array['e34600e1-0000-4000-8000-000000000000']::uuid[], null)
  $$,
  'headline_first_readings: a null day reads nothing');

-- ---------------------------------------------------------------------------
-- Non-members read nothing.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "e3460002-0000-4000-8000-000000000000", "role": "authenticated"}';

select is_empty(
  $$
    select 1 from public.headline_first_readings('e34600a0-0000-4000-8000-000000000000',
      array['e34600e1-0000-4000-8000-000000000000', 'e34600e3-0000-4000-8000-000000000000']::uuid[], '2026-11-09')
  $$,
  'headline_first_readings: a non-member reads nothing in another workspace');

select results_eq(
  $$
    select connection_id, snapshot_date
    from public.headline_first_readings('e34600b0-0000-4000-8000-000000000000',
      array['e34600e5-0000-4000-8000-000000000000']::uuid[], '2026-11-09')
  $$,
  $$ values ('e34600c4-0000-4000-8000-000000000000'::uuid, '2026-09-01'::date) $$,
  'headline_first_readings: the outsider reads its own workspace');

reset role;
reset request.jwt.claims;

set local role anon;
select throws_ok(
  $$ select public.headline_first_readings('e34600a0-0000-4000-8000-000000000000', array[]::uuid[], '2026-11-09') $$,
  '42501'::char(5), null::text,
  'headline_first_readings: anon cannot call it');
reset role;

set local role service_role;
select throws_ok(
  $$ select public.headline_first_readings('e34600a0-0000-4000-8000-000000000000', array[]::uuid[], '2026-11-09') $$,
  '42501'::char(5), null::text,
  'headline_first_readings: the service role cannot call it');
reset role;

select * from finish();
rollback;
