-- Review round one (20261031100300_review_round_one.sql): the dropped columns stay
-- dropped, and purge_oauth_states is service only and deletes expired states only.
begin;

create extension if not exists pgtap with schema extensions;

select plan(8);

-- Fixtures as postgres: one owner with one workspace.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('a6000001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-review-owner@example.com', '{"user_name": "rls-review-owner"}', '{"provider": "github", "providers": ["github"]}', now(), now());

insert into public.workspaces (id, name, created_by)
values ('a60000a0-0000-4000-8000-000000000000', 'Review team', 'a6000001-0000-4000-8000-000000000000');

insert into public.workspace_members (workspace_id, user_id, role)
values ('a60000a0-0000-4000-8000-000000000000', 'a6000001-0000-4000-8000-000000000000', 'owner');

select hasnt_column('public', 'connection_credentials', 'access_expires_at',
  'connection_credentials: access_expires_at is gone (the expiry lives only in the sealed credential)');
select hasnt_column('public', 'oauth_states', 'redirect_after',
  'oauth_states: redirect_after is gone (the callback builds return paths from the workspace)');

-- ---------------------------------------------------------------------------
-- purge_oauth_states: security definer, empty search_path, service role only.
-- ---------------------------------------------------------------------------
select is_empty(
  $$
    select p.oid::regprocedure::text || ': ' || v.problem
    from pg_catalog.pg_proc p
    cross join lateral (
      values
        (case when not p.prosecdef then 'not security definer' end),
        (case when not coalesce(p.proconfig && array['search_path=""', 'search_path='], false) then 'search_path not empty' end),
        (case when has_function_privilege('anon', p.oid, 'execute') then 'executable by anon' end),
        (case when has_function_privilege('authenticated', p.oid, 'execute') then 'executable by authenticated' end),
        (case when not has_function_privilege('service_role', p.oid, 'execute') then 'not executable by service_role' end)
    ) as v(problem)
    where p.oid = 'public.purge_oauth_states(timestamptz, int)'::regprocedure
      and v.problem is not null
  $$,
  'purge_oauth_states: security definer, empty search_path, and only service_role may execute it');

set local role authenticated;
set local request.jwt.claims to '{"sub": "a6000001-0000-4000-8000-000000000000", "role": "authenticated"}';

select throws_ok($$ select public.purge_oauth_states(now(), 10) $$, '42501'::char(5), null::text,
  'purge_oauth_states: even a workspace owner cannot call it through the Data API');

reset role;
reset request.jwt.claims;

-- now() is fixed for the transaction: one state long expired, one expiring exactly now, one still
-- in progress. Expiry far in the past puts the first two ahead of any other local rows.
insert into public.oauth_states (state, workspace_id, provider, user_id, expires_at)
values
  ('rls-review-abandoned', 'a60000a0-0000-4000-8000-000000000000', 'fake', 'a6000001-0000-4000-8000-000000000000',
   timestamptz '1970-01-01 00:00:00+00'),
  ('rls-review-expires-now', 'a60000a0-0000-4000-8000-000000000000', 'fake', 'a6000001-0000-4000-8000-000000000000',
   now()),
  ('rls-review-in-progress', 'a60000a0-0000-4000-8000-000000000000', 'fake', 'a6000001-0000-4000-8000-000000000000',
   now() + interval '10 minutes');

select throws_ok($$ select public.purge_oauth_states(now(), 0) $$, '22023'::char(5), null::text,
  'purge_oauth_states: a batch size below 1 is refused');

select is(public.purge_oauth_states(timestamptz '1970-01-01 00:00:00+00', 10), 1,
  'purge_oauth_states: a state that expired at the cutoff is deleted, a later one is not');

select lives_ok($$ select public.purge_oauth_states(now(), 10000) $$,
  'purge_oauth_states: a full batch runs as the service role would');

select results_eq(
  $$
    select state::text from public.oauth_states
    where state in ('rls-review-abandoned', 'rls-review-expires-now', 'rls-review-in-progress')
  $$,
  $$ values ('rls-review-in-progress') $$,
  'purge_oauth_states: expired states are gone and a flow still in progress is kept');

select * from finish();

rollback;
