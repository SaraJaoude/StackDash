-- Event markers (20261105002238_activity_event_daily_counts.sql): activity_event_daily_counts
-- counts per UTC day whatever the session time zone, filters like the timeline query, and counts
-- only what row level security lets the caller read.
begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- Fixtures as postgres: a member and an outsider, one workspace with one account, and events
-- either side of UTC midnight.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('a8000001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'markers-member@example.com', '{"user_name": "markers-member"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('a8000002-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'markers-outsider@example.com', '{"user_name": "markers-outsider"}', '{"provider": "github", "providers": ["github"]}', now(), now());

insert into public.workspaces (id, name, created_by)
values ('a80000a0-0000-4000-8000-000000000000', 'Markers team', 'a8000001-0000-4000-8000-000000000000');

insert into public.workspace_members (workspace_id, user_id, role)
values ('a80000a0-0000-4000-8000-000000000000', 'a8000001-0000-4000-8000-000000000000', 'viewer');

insert into public.connections (id, workspace_id, provider, status, display_name, poll_interval_seconds)
values ('a80000c0-0000-4000-8000-000000000000', 'a80000a0-0000-4000-8000-000000000000', 'fake', 'active',
        'Markers connection', 3600);

insert into public.external_accounts (id, workspace_id, connection_id, external_id, display_name, kind)
values ('a80000e0-0000-4000-8000-000000000000', 'a80000a0-0000-4000-8000-000000000000',
        'a80000c0-0000-4000-8000-000000000000', 'ext-markers', 'Markers account', 'team');

insert into public.activity_events (
  workspace_id, connection_id, external_account_id, provider, type_id, severity, title, occurred_at, dedupe_key
)
values
  -- Before the window.
  ('a80000a0-0000-4000-8000-000000000000', 'a80000c0-0000-4000-8000-000000000000', 'a80000e0-0000-4000-8000-000000000000',
   'fake', 'fake.deploy.succeeded', 'success', 'Deploy', '2026-10-19T23:59:59.999Z', 'markers-before'),
  -- The first second of 2026-10-20 UTC; in Europe/London it is still 2026-10-20 01:00.
  ('a80000a0-0000-4000-8000-000000000000', 'a80000c0-0000-4000-8000-000000000000', 'a80000e0-0000-4000-8000-000000000000',
   'fake', 'fake.deploy.succeeded', 'success', 'Deploy', '2026-10-20T00:00:00Z', 'markers-first'),
  -- The last moment of 2026-10-20 UTC; in Europe/London it is already 2026-10-21.
  ('a80000a0-0000-4000-8000-000000000000', 'a80000c0-0000-4000-8000-000000000000', 'a80000e0-0000-4000-8000-000000000000',
   'fake', 'fake.deploy.succeeded', 'success', 'Deploy', '2026-10-20T23:59:59.999Z', 'markers-last'),
  ('a80000a0-0000-4000-8000-000000000000', 'a80000c0-0000-4000-8000-000000000000', 'a80000e0-0000-4000-8000-000000000000',
   'fake', 'fake.deploy.succeeded', 'success', 'Deploy', '2026-10-21T00:00:00Z', 'markers-next-day'),
  ('a80000a0-0000-4000-8000-000000000000', 'a80000c0-0000-4000-8000-000000000000', 'a80000e0-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-10-20T12:00:00Z', 'markers-signup'),
  -- DevMacro's own event: no provider, no account.
  ('a80000a0-0000-4000-8000-000000000000', null, null,
   null, 'devmacro.alert_triggered', 'warning', 'Alert', '2026-10-20T12:00:00Z', 'markers-alert');

-- ---------------------------------------------------------------------------
-- Shape: security invoker (row level security applies), empty search_path, members only.
-- ---------------------------------------------------------------------------
select is_empty(
  $$
    select p.oid::regprocedure::text || ': ' || v.problem
    from pg_catalog.pg_proc p
    cross join lateral (
      values
        (case when p.prosecdef then 'security definer' end),
        (case when not coalesce(p.proconfig && array['search_path=""', 'search_path='], false) then 'search_path not empty' end),
        (case when has_function_privilege('anon', p.oid, 'execute') then 'executable by anon' end),
        (case when not has_function_privilege('authenticated', p.oid, 'execute') then 'not executable by authenticated' end)
    ) as v(problem)
    where p.oid = 'public.activity_event_daily_counts(uuid, date, text[], public.provider_id[], uuid[])'::regprocedure
      and v.problem is not null
  $$,
  'activity_event_daily_counts: security invoker, empty search_path, executable by authenticated and not anon');

set local role authenticated;
set local request.jwt.claims to '{"sub": "a8000001-0000-4000-8000-000000000000", "role": "authenticated"}';
-- London is UTC+1 on these dates; the days must still be UTC days.
set local timezone to 'Europe/London';

select results_eq(
  $$
    select day, provider::text, type_id, event_count
    from public.activity_event_daily_counts(
      'a80000a0-0000-4000-8000-000000000000', '2026-10-20', array['fake.deploy.succeeded', 'fake.signup']
    )
    order by day, type_id
  $$,
  $$
    values
      ('2026-10-20'::date, 'fake', 'fake.deploy.succeeded', 2::bigint),
      ('2026-10-20'::date, 'fake', 'fake.signup', 1::bigint),
      ('2026-10-21'::date, 'fake', 'fake.deploy.succeeded', 1::bigint)
  $$,
  'activity_event_daily_counts: groups by UTC day in a London session, from the first UTC instant of p_since');

select is_empty(
  $$
    select 1 from public.activity_event_daily_counts(
      'a80000a0-0000-4000-8000-000000000000', '2026-10-20', array['fake.deploy.failed']
    )
  $$,
  'activity_event_daily_counts: a type with no events returns no rows, not a zero');

select is_empty(
  $$ select 1 from public.activity_event_daily_counts('a80000a0-0000-4000-8000-000000000000', '2026-10-20', '{}') $$,
  'activity_event_daily_counts: no requested types counts nothing');

select results_eq(
  $$
    select provider::text, event_count
    from public.activity_event_daily_counts(
      'a80000a0-0000-4000-8000-000000000000', '2026-10-20', array['devmacro.alert_triggered']
    )
  $$,
  $$ values (null::text, 1::bigint) $$,
  'activity_event_daily_counts: with no provider filter, events with no provider are counted');

select is_empty(
  $$
    select 1 from public.activity_event_daily_counts(
      'a80000a0-0000-4000-8000-000000000000', '2026-10-20', array['devmacro.alert_triggered'], array['fake']::public.provider_id[]
    )
  $$,
  'activity_event_daily_counts: a provider filter leaves out events with no provider, as the timeline does');

select is(
  (
    select sum(event_count)::int from public.activity_event_daily_counts(
      'a80000a0-0000-4000-8000-000000000000', '2026-10-20', array['fake.deploy.succeeded'], array['fake']::public.provider_id[]
    )
  ),
  3,
  'activity_event_daily_counts: a provider filter keeps that provider''s events');

select is_empty(
  $$
    select 1 from public.activity_event_daily_counts(
      'a80000a0-0000-4000-8000-000000000000', '2026-10-20', array['fake.deploy.succeeded'], array['vercel']::public.provider_id[]
    )
  $$,
  'activity_event_daily_counts: another provider''s filter counts nothing');

select is(
  (
    select sum(event_count)::int from public.activity_event_daily_counts(
      'a80000a0-0000-4000-8000-000000000000', '2026-10-20', array['fake.deploy.succeeded', 'devmacro.alert_triggered'],
      '{}', array['a80000e0-0000-4000-8000-000000000000']::uuid[]
    )
  ),
  3,
  'activity_event_daily_counts: an account filter keeps that account''s events and leaves out events with no account');

select is_empty(
  $$
    select 1 from public.activity_event_daily_counts(
      'a80000a0-0000-4000-8000-000000000000', '2026-10-20', array['fake.deploy.succeeded'], '{}', '{}'::uuid[]
    )
  $$,
  'activity_event_daily_counts: an empty account list matches nothing');

-- The outsider reads nothing through the function, because activity_events RLS applies.
set local request.jwt.claims to '{"sub": "a8000002-0000-4000-8000-000000000000", "role": "authenticated"}';

select is_empty(
  $$
    select 1 from public.activity_event_daily_counts(
      'a80000a0-0000-4000-8000-000000000000', '2026-01-01', array['fake.deploy.succeeded', 'devmacro.alert_triggered']
    )
  $$,
  'activity_event_daily_counts: a non-member counts nothing in another workspace');

reset role;
reset request.jwt.claims;

set local role anon;
select throws_ok(
  $$ select public.activity_event_daily_counts('a80000a0-0000-4000-8000-000000000000', '2026-01-01', array['fake.signup']) $$,
  '42501'::char(5), null::text,
  'activity_event_daily_counts: anon cannot call it');
reset role;

select * from finish();
rollback;
