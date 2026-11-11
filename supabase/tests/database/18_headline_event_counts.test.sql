-- Headline strip event counts (20261112093000_headline_event_counts.sql, issue #320): summed from the
-- daily event rollup, they equal what count_activity_events counted from the events for every
-- window of whole UTC days; only the accounts and types passed in count; members only.
begin;

create extension if not exists pgtap with schema extensions;

select plan(16);

-- Fixtures as postgres: a viewer of workspace W, an outsider who owns workspace W2, a connection C1
-- with accounts X1 and X2, a connection C2 with account X3, and events on both sides of UTC day
-- edges. W2 holds the same kind of events, which no count for W may include.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('c0000001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'count-owner@example.com', '{"user_name": "count-owner"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('c0000002-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'count-viewer@example.com', '{"user_name": "count-viewer"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('c0000003-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'count-outsider@example.com', '{"user_name": "count-outsider"}', '{"provider": "github", "providers": ["github"]}', now(), now());

insert into public.workspaces (id, name, created_by)
values
  ('c00000a0-0000-4000-8000-000000000000', 'Count team', 'c0000001-0000-4000-8000-000000000000'),
  ('c00000b0-0000-4000-8000-000000000000', 'Other count team', 'c0000003-0000-4000-8000-000000000000');

insert into public.workspace_members (workspace_id, user_id, role)
values
  ('c00000a0-0000-4000-8000-000000000000', 'c0000001-0000-4000-8000-000000000000', 'owner'),
  ('c00000a0-0000-4000-8000-000000000000', 'c0000002-0000-4000-8000-000000000000', 'viewer'),
  ('c00000b0-0000-4000-8000-000000000000', 'c0000003-0000-4000-8000-000000000000', 'owner');

insert into public.connections (id, workspace_id, provider, status, display_name, poll_interval_seconds)
values
  ('c00000a1-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'fake', 'active', 'Count connection', 3600),
  ('c00000c1-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'fake', 'active', 'Second count connection', 3600),
  ('c00000b1-0000-4000-8000-000000000000', 'c00000b0-0000-4000-8000-000000000000', 'fake', 'active', 'Other count connection', 3600);

insert into public.external_accounts (id, workspace_id, connection_id, external_id, display_name, kind)
values
  ('c00000a2-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'x1', 'Production', 'account'),
  ('c00000a3-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'x2', 'Staging', 'account'),
  ('c00000c2-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'c00000c1-0000-4000-8000-000000000000', 'x3', 'Preview', 'account'),
  ('c00000b2-0000-4000-8000-000000000000', 'c00000b0-0000-4000-8000-000000000000', 'c00000b1-0000-4000-8000-000000000000', 'x4', 'Other', 'account');

insert into public.activity_events (workspace_id, connection_id, external_account_id, provider, type_id, severity, title, occurred_at, dedupe_key)
values
  -- X1: the first and last instants of 2026-11-02 and their neighbors on either side.
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-01T23:59:59.999Z', 'count-1'),
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-02T00:00:00Z', 'count-2'),
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-04T09:30:00Z', 'count-3'),
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-05T23:59:59.999Z', 'count-4'),
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-06T00:00:00Z', 'count-5'),
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.deploy.succeeded', 'success', 'Deployment succeeded', '2026-11-03T12:00:00Z', 'count-6'),
  -- X1: a type that is not asked for.
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.other', 'info', 'Something else', '2026-11-03T12:00:00Z', 'count-7'),
  -- X2: the second account of C1, so C1's counts add both accounts.
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a3-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-03T12:00:00Z', 'count-8'),
  -- X3 on C2.
  ('c00000a0-0000-4000-8000-000000000000', 'c00000c1-0000-4000-8000-000000000000', 'c00000c2-0000-4000-8000-000000000000',
   'fake', 'fake.deploy.succeeded', 'success', 'Deployment succeeded', '2026-11-02T00:00:00Z', 'count-9'),
  ('c00000a0-0000-4000-8000-000000000000', 'c00000c1-0000-4000-8000-000000000000', 'c00000c2-0000-4000-8000-000000000000',
   'fake', 'fake.deploy.succeeded', 'success', 'Deployment succeeded', '2026-11-04T23:00:00Z', 'count-10'),
  -- W2, on X4.
  ('c00000b0-0000-4000-8000-000000000000', 'c00000b1-0000-4000-8000-000000000000', 'c00000b2-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-03T12:00:00Z', 'count-11');

-- ---------------------------------------------------------------------------
-- Shape: security definer behind one membership check, empty search_path, members only, and the
-- per row counter it replaces is gone.
-- ---------------------------------------------------------------------------
select ok(
  (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.headline_event_counts(uuid, uuid[], text[], date, date)'::regprocedure),
  'headline_event_counts: security definer, gated by one membership check rather than per row policies');
select ok(
  (select coalesce(p.proconfig && array['search_path=""', 'search_path='], false)
   from pg_catalog.pg_proc p where p.oid = 'public.headline_event_counts(uuid, uuid[], text[], date, date)'::regprocedure),
  'headline_event_counts: sets search_path to empty');
select ok(not has_function_privilege('anon', 'public.headline_event_counts(uuid, uuid[], text[], date, date)', 'execute'),
  'headline_event_counts: anon cannot execute it');
select ok(not has_function_privilege('service_role', 'public.headline_event_counts(uuid, uuid[], text[], date, date)', 'execute'),
  'headline_event_counts: service_role cannot execute it');
select ok(has_function_privilege('authenticated', 'public.headline_event_counts(uuid, uuid[], text[], date, date)', 'execute'),
  'headline_event_counts: authenticated can execute it');
select hasnt_function('public', 'count_activity_events',
  'count_activity_events: removed, the headline reads headline_event_counts');

-- ---------------------------------------------------------------------------
-- As a viewer of W.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000002-0000-4000-8000-000000000000", "role": "authenticated"}';

select results_eq(
  $$
    select connection_id, type_id, events from public.headline_event_counts(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000', 'c00000a3-0000-4000-8000-000000000000', 'c00000c2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup', 'fake.deploy.succeeded'],
      '2026-11-02', '2026-11-05')
    order by connection_id, type_id
  $$,
  $$
    values
      ('c00000a1-0000-4000-8000-000000000000'::uuid, 'fake.deploy.succeeded'::text, 1),
      ('c00000a1-0000-4000-8000-000000000000'::uuid, 'fake.signup'::text, 4),
      ('c00000c1-0000-4000-8000-000000000000'::uuid, 'fake.deploy.succeeded'::text, 2)
  $$,
  'headline_event_counts: per connection and type, both window days inclusive, the accounts of a connection added up');

-- Every window of whole UTC days from 2026-10-31 to 2026-11-07 (start on or before end), counted
-- from the rollup and, as count_activity_events counted it, from the events from the window's first
-- instant to the instant after its last day. The viewer reads the events through the same select
-- policy count_activity_events applied.
select results_eq(
  $$
    select w.start_day, w.end_day, h.connection_id, h.type_id, h.events
    from (
      select s::date as start_day, e::date as end_day
      from generate_series('2026-10-31'::date, '2026-11-07'::date, interval '1 day') s
      cross join generate_series('2026-10-31'::date, '2026-11-07'::date, interval '1 day') e
      where e >= s
    ) w
    cross join lateral public.headline_event_counts(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000', 'c00000a3-0000-4000-8000-000000000000', 'c00000c2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup', 'fake.deploy.succeeded'],
      w.start_day, w.end_day) h
    order by 1, 2, 3, 4
  $$,
  $$
    select w.start_day, w.end_day, e.connection_id, e.type_id, count(*)::integer
    from (
      select s::date as start_day, e::date as end_day
      from generate_series('2026-10-31'::date, '2026-11-07'::date, interval '1 day') s
      cross join generate_series('2026-10-31'::date, '2026-11-07'::date, interval '1 day') e
      where e >= s
    ) w
    join public.activity_events e
      on e.workspace_id = 'c00000a0-0000-4000-8000-000000000000'
      and e.external_account_id = any (array['c00000a2-0000-4000-8000-000000000000', 'c00000a3-0000-4000-8000-000000000000', 'c00000c2-0000-4000-8000-000000000000']::uuid[])
      and e.type_id = any (array['fake.signup', 'fake.deploy.succeeded'])
      and e.occurred_at >= (w.start_day::text || 'T00:00:00Z')::timestamptz
      and e.occurred_at < ((w.end_day + 1)::text || 'T00:00:00Z')::timestamptz
      and e.connection_id is not null
    group by 1, 2, 3, 4
    order by 1, 2, 3, 4
  $$,
  'headline_event_counts: the same counts as counting the events, for every window of whole UTC days');

select results_eq(
  $$
    select type_id, events from public.headline_event_counts(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup'],
      '2026-11-02', '2026-11-02')
  $$,
  $$ values ('fake.signup'::text, 1) $$,
  'headline_event_counts: a one day window counts that UTC day only, not the instant before or after it');

select is_empty(
  $$
    select * from public.headline_event_counts(
      'c00000a0-0000-4000-8000-000000000000',
      array[]::uuid[],
      array['fake.signup', 'fake.deploy.succeeded'],
      '2026-11-01', '2026-11-07')
  $$,
  'headline_event_counts: no accounts in scope counts nothing');

select is_empty(
  $$
    select * from public.headline_event_counts(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000']::uuid[],
      array[]::text[],
      '2026-11-01', '2026-11-07')
  $$,
  'headline_event_counts: no types asked for counts nothing');

select is_empty(
  $$
    select * from public.headline_event_counts(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup'],
      '2026-11-06', '2026-11-05')
  $$,
  'headline_event_counts: a window that ends before it starts counts nothing');

select is_empty(
  $$
    select * from public.headline_event_counts(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000b2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup'],
      '2026-11-01', '2026-11-07')
  $$,
  'headline_event_counts: another workspace''s account counts nothing in this workspace');

-- ---------------------------------------------------------------------------
-- As the owner of W2, outside W: no rows, whatever is passed in.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "c0000003-0000-4000-8000-000000000000", "role": "authenticated"}';

select is_empty(
  $$
    select * from public.headline_event_counts(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000', 'c00000a3-0000-4000-8000-000000000000', 'c00000c2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup', 'fake.deploy.succeeded'],
      '2026-01-01', '2026-12-31')
  $$,
  'headline_event_counts: a non member counts nothing');

select results_eq(
  $$
    select type_id, events from public.headline_event_counts(
      'c00000b0-0000-4000-8000-000000000000',
      array['c00000b2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup'],
      '2026-11-01', '2026-11-07')
  $$,
  $$ values ('fake.signup'::text, 1) $$,
  'headline_event_counts: the same caller counts their own workspace');

-- ---------------------------------------------------------------------------
-- Signed out.
-- ---------------------------------------------------------------------------
reset request.jwt.claims;
set local role anon;

select throws_ok(
  $$
    select * from public.headline_event_counts(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup'],
      '2026-11-01', '2026-11-07')
  $$,
  '42501'::char(5), null::text,
  'headline_event_counts: anon is refused');

reset role;

select * from finish();
rollback;
