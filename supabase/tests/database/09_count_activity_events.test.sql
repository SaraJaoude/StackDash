-- Headline strip event counts (20261105003011_count_activity_events.sql): security invoker so the
-- activity_events select policy applies, half open windows, and only the accounts passed in.
begin;

create extension if not exists pgtap with schema extensions;

select plan(9);

-- Fixtures as postgres: a viewer of workspace W, an outsider, one connection with an included
-- account X1 and a second account X2, and events on both sides of the window edges.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('c0000001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'count-owner@example.com', '{"user_name": "count-owner"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('c0000002-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'count-viewer@example.com', '{"user_name": "count-viewer"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('c0000003-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'count-outsider@example.com', '{"user_name": "count-outsider"}', '{"provider": "github", "providers": ["github"]}', now(), now());

insert into public.workspaces (id, name, created_by)
values ('c00000a0-0000-4000-8000-000000000000', 'Count team', 'c0000001-0000-4000-8000-000000000000');

insert into public.workspace_members (workspace_id, user_id, role)
values
  ('c00000a0-0000-4000-8000-000000000000', 'c0000001-0000-4000-8000-000000000000', 'owner'),
  ('c00000a0-0000-4000-8000-000000000000', 'c0000002-0000-4000-8000-000000000000', 'viewer');

insert into public.connections (id, workspace_id, provider, status, display_name, poll_interval_seconds)
values ('c00000a1-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'fake', 'active', 'Count connection', 3600);

insert into public.external_accounts (id, workspace_id, connection_id, external_id, display_name, kind)
values
  ('c00000a2-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'x1', 'Production', 'account'),
  ('c00000a3-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'x2', 'Staging', 'account');

insert into public.activity_events (workspace_id, connection_id, external_account_id, provider, type_id, severity, title, occurred_at, dedupe_key)
values
  -- The first instant of the window counts; the instant before it does not.
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-02T00:00:00Z', 'count-1'),
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-01T23:59:59.999Z', 'count-2'),
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-04T09:30:00Z', 'count-3'),
  -- The window end is exclusive.
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-06T00:00:00Z', 'count-4'),
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.deploy.succeeded', 'success', 'Deployment succeeded', '2026-11-03T12:00:00Z', 'count-5'),
  -- A type that was not asked for.
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000',
   'fake', 'fake.other', 'info', 'Something else', '2026-11-03T12:00:00Z', 'count-6'),
  -- An account that was not asked for.
  ('c00000a0-0000-4000-8000-000000000000', 'c00000a1-0000-4000-8000-000000000000', 'c00000a3-0000-4000-8000-000000000000',
   'fake', 'fake.signup', 'info', 'New signup', '2026-11-03T12:00:00Z', 'count-7');

-- ---------------------------------------------------------------------------
-- Shape: security invoker, empty search_path, members only.
-- ---------------------------------------------------------------------------
select ok(
  not (select p.prosecdef from pg_catalog.pg_proc p where p.oid = 'public.count_activity_events(uuid, uuid[], text[], timestamptz, timestamptz)'::regprocedure),
  'count_activity_events: security invoker, so the activity_events select policy applies');
select ok(
  (select coalesce(p.proconfig && array['search_path=""', 'search_path='], false)
   from pg_catalog.pg_proc p where p.oid = 'public.count_activity_events(uuid, uuid[], text[], timestamptz, timestamptz)'::regprocedure),
  'count_activity_events: sets search_path to empty');
select ok(not has_function_privilege('anon', 'public.count_activity_events(uuid, uuid[], text[], timestamptz, timestamptz)', 'execute'),
  'count_activity_events: anon cannot execute it');
select ok(has_function_privilege('authenticated', 'public.count_activity_events(uuid, uuid[], text[], timestamptz, timestamptz)', 'execute'),
  'count_activity_events: authenticated can execute it');

-- ---------------------------------------------------------------------------
-- As a viewer of W.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000002-0000-4000-8000-000000000000", "role": "authenticated"}';

select results_eq(
  $$
    select type_id, events from public.count_activity_events(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup', 'fake.deploy.succeeded'],
      '2026-11-02T00:00:00Z', '2026-11-06T00:00:00Z')
    order by type_id
  $$,
  $$ values ('fake.deploy.succeeded'::text, 1), ('fake.signup'::text, 2) $$,
  'count_activity_events: counts per type in a half open window, only the types and accounts asked for');

select results_eq(
  $$
    select connection_id from public.count_activity_events(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup'],
      '2026-11-02T00:00:00Z', '2026-11-06T00:00:00Z')
  $$,
  $$ values ('c00000a1-0000-4000-8000-000000000000'::uuid) $$,
  'count_activity_events: one row per connection and type');

select is_empty(
  $$
    select * from public.count_activity_events(
      'c00000a0-0000-4000-8000-000000000000',
      array[]::uuid[],
      array['fake.signup'],
      '2026-11-02T00:00:00Z', '2026-11-06T00:00:00Z')
  $$,
  'count_activity_events: no accounts in scope counts nothing');

select is_empty(
  $$
    select * from public.count_activity_events(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup'],
      '2026-11-06T00:00:00Z', '2026-11-06T00:00:00Z')
  $$,
  'count_activity_events: an empty window counts nothing');

-- ---------------------------------------------------------------------------
-- As someone outside W: the select policy hides every row.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "c0000003-0000-4000-8000-000000000000", "role": "authenticated"}';

select is_empty(
  $$
    select * from public.count_activity_events(
      'c00000a0-0000-4000-8000-000000000000',
      array['c00000a2-0000-4000-8000-000000000000', 'c00000a3-0000-4000-8000-000000000000']::uuid[],
      array['fake.signup', 'fake.deploy.succeeded'],
      '2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z')
  $$,
  'count_activity_events: a non member counts nothing');

reset request.jwt.claims;
reset role;

select * from finish();
rollback;
