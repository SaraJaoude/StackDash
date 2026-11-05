-- Anomaly detection (#169): the per-workspace switch defaults on and only admins change it; muted
-- metrics are read by members, added and removed by admins, never updated, and invisible to
-- everyone outside the workspace.
begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

-- Test helper, rolled back with the transaction. Returns rows touched, or -1
-- when Postgres refuses the statement (42501: missing grant or RLS with check).
-- A refused write is any result <= 0; an allowed write touches exactly 1 row.
create schema rls_test;
grant usage on schema rls_test to anon, authenticated;

create function rls_test.affected(p_sql text)
returns integer
language plpgsql
as $fn$
declare
  v_count integer;
begin
  execute p_sql;
  get diagnostics v_count = row_count;
  return v_count;
exception
  when insufficient_privilege then
    return -1;
end;
$fn$;

grant execute on function rls_test.affected(text) to anon, authenticated;

-- Fixtures as postgres: an admin and a viewer of one workspace, plus an outsider.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('a8000001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-anomaly-admin@example.com', '{"user_name": "rls-anomaly-admin"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('a8000002-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-anomaly-viewer@example.com', '{"user_name": "rls-anomaly-viewer"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('a8000003-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-anomaly-outsider@example.com', '{"user_name": "rls-anomaly-outsider"}', '{"provider": "github", "providers": ["github"]}', now(), now());

insert into public.workspaces (id, name, created_by)
values
  ('a80000a0-0000-4000-8000-000000000000', 'Anomaly team', 'a8000001-0000-4000-8000-000000000000'),
  ('a80000b0-0000-4000-8000-000000000000', 'Outsider team', 'a8000003-0000-4000-8000-000000000000');

insert into public.workspace_members (workspace_id, user_id, role)
values
  ('a80000a0-0000-4000-8000-000000000000', 'a8000001-0000-4000-8000-000000000000', 'admin'),
  ('a80000a0-0000-4000-8000-000000000000', 'a8000002-0000-4000-8000-000000000000', 'viewer'),
  ('a80000b0-0000-4000-8000-000000000000', 'a8000003-0000-4000-8000-000000000000', 'owner');

insert into public.anomaly_mutes (id, workspace_id, provider, metric_key)
values ('a80000a1-0000-4000-8000-000000000000', 'a80000a0-0000-4000-8000-000000000000', 'vercel', 'vercel.spend.total');

select col_default_is('public', 'workspaces', 'anomaly_detection_enabled', 'true',
  'anomaly detection: on by default, so it needs no setup');
select policies_are('public', 'anomaly_mutes', array['anomaly_mutes_select', 'anomaly_mutes_insert', 'anomaly_mutes_delete'],
  'anomaly_mutes: select, insert, and delete policies only (no update)');

-- ---------------------------------------------------------------------------
-- Viewer: reads, never writes.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "a8000002-0000-4000-8000-000000000000", "role": "authenticated"}';

select isnt_empty($$ select id from public.anomaly_mutes where workspace_id = 'a80000a0-0000-4000-8000-000000000000' $$,
  'anomaly_mutes viewer: can select the mutes of their workspace');
select is((select anomaly_detection_enabled from public.workspaces where id = 'a80000a0-0000-4000-8000-000000000000'), true,
  'anomaly detection viewer: can read the switch');
select cmp_ok(rls_test.affected($$ insert into public.anomaly_mutes (workspace_id, provider, metric_key) values ('a80000a0-0000-4000-8000-000000000000', 'github', 'github.spend.actions') $$), '<=', 0,
  'anomaly_mutes viewer: cannot mute a metric');
select cmp_ok(rls_test.affected($$ delete from public.anomaly_mutes where id = 'a80000a1-0000-4000-8000-000000000000' $$), '<=', 0,
  'anomaly_mutes viewer: cannot unmute a metric');
select cmp_ok(rls_test.affected($$ update public.workspaces set anomaly_detection_enabled = false where id = 'a80000a0-0000-4000-8000-000000000000' $$), '<=', 0,
  'anomaly detection viewer: cannot turn it off');

-- ---------------------------------------------------------------------------
-- Outsider: sees and changes nothing in another workspace.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "a8000003-0000-4000-8000-000000000000", "role": "authenticated"}';

select is_empty($$ select id from public.anomaly_mutes where workspace_id = 'a80000a0-0000-4000-8000-000000000000' $$,
  'anomaly_mutes outsider: cannot select another workspace''s mutes');
select cmp_ok(rls_test.affected($$ insert into public.anomaly_mutes (workspace_id, provider, metric_key) values ('a80000a0-0000-4000-8000-000000000000', 'github', 'github.spend.actions') $$), '<=', 0,
  'anomaly_mutes outsider: cannot mute a metric in another workspace');
select cmp_ok(rls_test.affected($$ delete from public.anomaly_mutes where id = 'a80000a1-0000-4000-8000-000000000000' $$), '<=', 0,
  'anomaly_mutes outsider: cannot unmute a metric in another workspace');
select cmp_ok(rls_test.affected($$ update public.workspaces set anomaly_detection_enabled = false where id = 'a80000a0-0000-4000-8000-000000000000' $$), '<=', 0,
  'anomaly detection outsider: cannot turn off another workspace''s detection');

-- ---------------------------------------------------------------------------
-- Admin: mutes, unmutes, and switches; never updates a mute or forges its author.
-- ---------------------------------------------------------------------------
set local request.jwt.claims to '{"sub": "a8000001-0000-4000-8000-000000000000", "role": "authenticated"}';

select is(rls_test.affected($$ insert into public.anomaly_mutes (workspace_id, provider, metric_key) values ('a80000a0-0000-4000-8000-000000000000', 'github', 'github.spend.actions') $$), 1,
  'anomaly_mutes admin: can mute a metric');
select is((select created_by from public.anomaly_mutes where metric_key = 'github.spend.actions'), 'a8000001-0000-4000-8000-000000000000'::uuid,
  'anomaly_mutes admin: the mute records who added it');
select cmp_ok(rls_test.affected($$ insert into public.anomaly_mutes (workspace_id, provider, metric_key, created_by) values ('a80000a0-0000-4000-8000-000000000000', 'resend', 'resend.emails.daily', 'a8000002-0000-4000-8000-000000000000') $$), '<=', 0,
  'anomaly_mutes admin: cannot set created_by');
select cmp_ok(rls_test.affected($$ update public.anomaly_mutes set metric_key = 'vercel.spend.other' where id = 'a80000a1-0000-4000-8000-000000000000' $$), '<=', 0,
  'anomaly_mutes admin: cannot update a mute in place');
select cmp_ok(rls_test.affected($$ insert into public.anomaly_mutes (workspace_id, provider, metric_key) values ('a80000b0-0000-4000-8000-000000000000', 'github', 'github.spend.actions') $$), '<=', 0,
  'anomaly_mutes admin: cannot mute a metric in a workspace they do not belong to');
select throws_ok($$ insert into public.anomaly_mutes (workspace_id, provider, metric_key) values ('a80000a0-0000-4000-8000-000000000000', 'vercel', 'vercel.spend.total') $$,
  '23505', null, 'anomaly_mutes: one mute per provider and metric key in a workspace');
select throws_ok($$ insert into public.anomaly_mutes (workspace_id, provider, metric_key) values ('a80000a0-0000-4000-8000-000000000000', 'vercel', 'Not a key') $$,
  '23514', null, 'anomaly_mutes: the metric key must be a dotted lowercase key');
select is(rls_test.affected($$ delete from public.anomaly_mutes where id = 'a80000a1-0000-4000-8000-000000000000' $$), 1,
  'anomaly_mutes admin: can unmute a metric');
select is(rls_test.affected($$ update public.workspaces set anomaly_detection_enabled = false where id = 'a80000a0-0000-4000-8000-000000000000' $$), 1,
  'anomaly detection admin: can turn it off');

-- ---------------------------------------------------------------------------
-- Anon: nothing.
-- ---------------------------------------------------------------------------
reset request.jwt.claims;
set local role anon;

select cmp_ok(rls_test.affected($$ select id from public.anomaly_mutes $$), '<=', 0,
  'anomaly_mutes anon: cannot select');

reset role;

select is((select anomaly_detection_enabled from public.workspaces where id = 'a80000a0-0000-4000-8000-000000000000'), false,
  'anomaly detection: the admin''s switch persisted');

select * from finish();

rollback;
