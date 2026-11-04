-- Role matrix (#104) inside one workspace: owner > admin > viewer.
-- Viewer reads everything and writes nothing; admin writes configuration but
-- cannot touch owner memberships or grant owner; owner can; no signed in role
-- writes the provider data tables (service role only).
begin;

create extension if not exists pgtap with schema extensions;

select plan(79);

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

-- Users: owner, admin, viewer, plus two outsiders the tests add as members.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('c0000001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-role-owner@example.com', '{"user_name": "rls-role-owner"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('c0000002-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-role-admin@example.com', '{"user_name": "rls-role-admin"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('c0000003-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-role-viewer@example.com', '{"user_name": "rls-role-viewer"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('c0000004-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-role-newcomer@example.com', '{"user_name": "rls-role-newcomer"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('c0000005-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-role-coowner@example.com', '{"user_name": "rls-role-coowner"}', '{"provider": "github", "providers": ["github"]}', now(), now());

-- One shared workspace with a row in every tenant table.
insert into public.workspaces (id, name, created_by)
values ('c00000a0-0000-4000-8000-000000000000', 'Role matrix team', 'c0000001-0000-4000-8000-000000000000');

insert into public.workspace_members (workspace_id, user_id, role)
values
  ('c00000a0-0000-4000-8000-000000000000', 'c0000001-0000-4000-8000-000000000000', 'owner'),
  ('c00000a0-0000-4000-8000-000000000000', 'c0000002-0000-4000-8000-000000000000', 'admin'),
  ('c00000a0-0000-4000-8000-000000000000', 'c0000003-0000-4000-8000-000000000000', 'viewer');

insert into public.projects (id, workspace_id, name, created_by, updated_by)
values ('c00000a1-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'Role project',
        'c0000001-0000-4000-8000-000000000000', 'c0000001-0000-4000-8000-000000000000');

insert into public.connections (id, workspace_id, provider, status, display_name, poll_interval_seconds, created_by, updated_by)
values ('c00000a2-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'fake', 'active',
        'Role connection', 3600, 'c0000001-0000-4000-8000-000000000000', 'c0000001-0000-4000-8000-000000000000');

insert into public.external_accounts (id, workspace_id, connection_id, external_id, display_name, kind)
values ('c00000a3-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000',
        'c00000a2-0000-4000-8000-000000000000', 'ext-role', 'Role account', 'team');

insert into public.usage_snapshots (
  id, workspace_id, connection_id, external_account_id, metric_key, kind, label, snapshot_date,
  amount_minor, currency, period_start, period_end, retrieved_at, provenance_source
)
values ('c00000a4-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000',
        'c00000a2-0000-4000-8000-000000000000', 'c00000a3-0000-4000-8000-000000000000',
        'fake.spend', 'verified_spend', 'Role snapshot', date '2026-10-01',
        500, 'USD', timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-11-01 00:00:00+00', now(), 'provider_api');

insert into public.activity_events (
  id, workspace_id, connection_id, external_account_id, provider, type_id, severity, title, occurred_at, dedupe_key
)
values ('c00000a5-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000',
        'c00000a2-0000-4000-8000-000000000000', 'c00000a3-0000-4000-8000-000000000000',
        'fake', 'fake.deployment', 'info', 'Role event', now(), 'rls-role-event');

insert into public.budgets (id, workspace_id, name, scope, amount_minor, currency, created_by, updated_by)
values ('c00000a6-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'Role budget', 'workspace',
        10000, 'USD', 'c0000001-0000-4000-8000-000000000000', 'c0000001-0000-4000-8000-000000000000');

insert into public.alert_rules (id, workspace_id, kind, scope, metric_key, threshold_percent, created_by, updated_by)
values ('c00000a7-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000', 'allowance_percent',
        'workspace', 'fake.minutes', 80, 'c0000001-0000-4000-8000-000000000000', 'c0000001-0000-4000-8000-000000000000');

insert into public.triggered_alerts (id, workspace_id, rule_id, cycle_key, threshold_label, is_estimated, message)
values ('c00000a8-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000',
        'c00000a7-0000-4000-8000-000000000000', '2026-10-01', '80%', false, 'Role alert');

insert into public.sync_jobs (id, workspace_id, connection_id, kind, dedupe_key)
values ('c00000a9-0000-4000-8000-000000000000', 'c00000a0-0000-4000-8000-000000000000',
        'c00000a2-0000-4000-8000-000000000000', 'sync', 'rls-role-sync');

-- ---------------------------------------------------------------------------
-- Viewer: reads every table, every write is refused.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000003-0000-4000-8000-000000000000", "role": "authenticated"}';

select isnt_empty($$ select id from public.workspaces where id = 'c00000a0-0000-4000-8000-000000000000' $$,
  'role matrix viewer read: viewer can select workspaces');
select is((select count(*)::integer from public.workspace_members where workspace_id = 'c00000a0-0000-4000-8000-000000000000'), 3,
  'role matrix viewer read: viewer can select every workspace_members row of their workspace');
select isnt_empty($$ select id from public.projects where workspace_id = 'c00000a0-0000-4000-8000-000000000000' $$,
  'role matrix viewer read: viewer can select projects');
select isnt_empty($$ select id from public.connections where workspace_id = 'c00000a0-0000-4000-8000-000000000000' $$,
  'role matrix viewer read: viewer can select connections');
select isnt_empty($$ select id from public.external_accounts where workspace_id = 'c00000a0-0000-4000-8000-000000000000' $$,
  'role matrix viewer read: viewer can select external_accounts');
select isnt_empty($$ select id from public.usage_snapshots where workspace_id = 'c00000a0-0000-4000-8000-000000000000' $$,
  'role matrix viewer read: viewer can select usage_snapshots');
select isnt_empty($$ select id from public.activity_events where workspace_id = 'c00000a0-0000-4000-8000-000000000000' $$,
  'role matrix viewer read: viewer can select activity_events');
select isnt_empty($$ select id from public.budgets where workspace_id = 'c00000a0-0000-4000-8000-000000000000' $$,
  'role matrix viewer read: viewer can select budgets');
select isnt_empty($$ select id from public.alert_rules where workspace_id = 'c00000a0-0000-4000-8000-000000000000' $$,
  'role matrix viewer read: viewer can select alert_rules');
select isnt_empty($$ select id from public.triggered_alerts where workspace_id = 'c00000a0-0000-4000-8000-000000000000' $$,
  'role matrix viewer read: viewer can select triggered_alerts');
select isnt_empty($$ select id from public.sync_jobs where workspace_id = 'c00000a0-0000-4000-8000-000000000000' $$,
  'role matrix viewer read: viewer can select sync_jobs');

select cmp_ok(rls_test.affected($$ update public.workspaces set name = 'Viewer rename' where id = 'c00000a0-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot update workspaces');
select cmp_ok(rls_test.affected($$ delete from public.workspaces where id = 'c00000a0-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot delete workspaces');
select cmp_ok(rls_test.affected($$ insert into public.projects (workspace_id, name) values ('c00000a0-0000-4000-8000-000000000000', 'Viewer project') $$), '<=', 0,
  'role matrix viewer write: viewer cannot insert projects');
select cmp_ok(rls_test.affected($$ update public.projects set name = 'Viewer rename' where id = 'c00000a1-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot update projects');
select cmp_ok(rls_test.affected($$ delete from public.projects where id = 'c00000a1-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot delete projects');
select cmp_ok(rls_test.affected($$
    insert into public.connections (workspace_id, provider, display_name, poll_interval_seconds)
    values ('c00000a0-0000-4000-8000-000000000000', 'fake', 'Viewer connection', 3600)
  $$), '<=', 0,
  'role matrix viewer write: viewer cannot insert connections');
select cmp_ok(rls_test.affected($$ update public.connections set display_name = 'Viewer rename' where id = 'c00000a2-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot update connections');
select cmp_ok(rls_test.affected($$ delete from public.connections where id = 'c00000a2-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot delete connections');
select cmp_ok(rls_test.affected($$
    insert into public.external_accounts (workspace_id, connection_id, external_id, display_name, kind)
    values ('c00000a0-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000', 'ext-viewer', 'Viewer account', 'team')
  $$), '<=', 0,
  'role matrix viewer write: viewer cannot insert external_accounts');
select cmp_ok(rls_test.affected($$ update public.external_accounts set included = false where id = 'c00000a3-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot update external_accounts');
select cmp_ok(rls_test.affected($$ delete from public.external_accounts where id = 'c00000a3-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot delete external_accounts');
select cmp_ok(rls_test.affected($$
    insert into public.budgets (workspace_id, name, scope, amount_minor, currency)
    values ('c00000a0-0000-4000-8000-000000000000', 'Viewer budget', 'workspace', 100, 'USD')
  $$), '<=', 0,
  'role matrix viewer write: viewer cannot insert budgets');
select cmp_ok(rls_test.affected($$ update public.budgets set amount_minor = 1 where id = 'c00000a6-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot update budgets');
select cmp_ok(rls_test.affected($$ delete from public.budgets where id = 'c00000a6-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot delete budgets');
select cmp_ok(rls_test.affected($$
    insert into public.alert_rules (workspace_id, kind, scope, metric_key, threshold_percent)
    values ('c00000a0-0000-4000-8000-000000000000', 'allowance_percent', 'workspace', 'fake.minutes', 50)
  $$), '<=', 0,
  'role matrix viewer write: viewer cannot insert alert_rules');
select cmp_ok(rls_test.affected($$ update public.alert_rules set paused = true where id = 'c00000a7-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot update alert_rules');
select cmp_ok(rls_test.affected($$ delete from public.alert_rules where id = 'c00000a7-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix viewer write: viewer cannot delete alert_rules');
select cmp_ok(rls_test.affected($$
    update public.triggered_alerts set acknowledged_at = now(), acknowledged_by = 'c0000003-0000-4000-8000-000000000000'
    where id = 'c00000a8-0000-4000-8000-000000000000'
  $$), '<=', 0,
  'role matrix viewer write: viewer cannot acknowledge triggered_alerts');
select cmp_ok(rls_test.affected($$
    insert into public.workspace_members (workspace_id, user_id, role)
    values ('c00000a0-0000-4000-8000-000000000000', 'c0000004-0000-4000-8000-000000000000', 'viewer')
  $$), '<=', 0,
  'role matrix viewer write: viewer cannot add workspace_members');
select cmp_ok(rls_test.affected($$
    update public.workspace_members set role = 'admin'
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000003-0000-4000-8000-000000000000'
  $$), '<=', 0,
  'role matrix viewer write: viewer cannot promote themself to admin');
select cmp_ok(rls_test.affected($$
    delete from public.workspace_members
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000002-0000-4000-8000-000000000000'
  $$), '<=', 0,
  'role matrix viewer write: viewer cannot remove workspace_members');

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Admin: writes configuration tables, manages non-owner members only.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000002-0000-4000-8000-000000000000", "role": "authenticated"}';

select is(rls_test.affected($$ update public.workspaces set name = 'Admin rename' where id = 'c00000a0-0000-4000-8000-000000000000' $$), 1,
  'role matrix admin write: admin can update workspaces');
select cmp_ok(rls_test.affected($$ delete from public.workspaces where id = 'c00000a0-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix admin write: admin cannot delete workspaces (owner only)');
select is(rls_test.affected($$ insert into public.projects (workspace_id, name) values ('c00000a0-0000-4000-8000-000000000000', 'Admin project') $$), 1,
  'role matrix admin write: admin can insert projects');
select is(rls_test.affected($$ update public.projects set name = 'Admin rename' where id = 'c00000a1-0000-4000-8000-000000000000' $$), 1,
  'role matrix admin write: admin can update projects');
select is(rls_test.affected($$ delete from public.projects where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and name = 'Admin project' $$), 1,
  'role matrix admin write: admin can delete projects');
select is(rls_test.affected($$
    insert into public.connections (workspace_id, provider, display_name, poll_interval_seconds)
    values ('c00000a0-0000-4000-8000-000000000000', 'fake', 'Admin connection', 3600)
  $$), 1,
  'role matrix admin write: admin can insert connections');
select is(rls_test.affected($$ update public.connections set display_name = 'Admin rename' where id = 'c00000a2-0000-4000-8000-000000000000' $$), 1,
  'role matrix admin write: admin can update connections');
select is(rls_test.affected($$ delete from public.connections where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and display_name = 'Admin connection' $$), 1,
  'role matrix admin write: admin can delete connections');
select is(rls_test.affected($$ update public.external_accounts set included = false where id = 'c00000a3-0000-4000-8000-000000000000' $$), 1,
  'role matrix admin write: admin can update external_accounts included');
select is(rls_test.affected($$
    update public.external_accounts set project_id = 'c00000a1-0000-4000-8000-000000000000'
    where id = 'c00000a3-0000-4000-8000-000000000000'
  $$), 1,
  'role matrix admin write: admin can assign external_accounts to a project');
select is(rls_test.affected($$
    insert into public.budgets (workspace_id, name, scope, amount_minor, currency)
    values ('c00000a0-0000-4000-8000-000000000000', 'Admin budget', 'workspace', 2500, 'USD')
  $$), 1,
  'role matrix admin write: admin can insert budgets');
select is(rls_test.affected($$ update public.budgets set amount_minor = 20000 where id = 'c00000a6-0000-4000-8000-000000000000' $$), 1,
  'role matrix admin write: admin can update budgets');
select is(rls_test.affected($$ delete from public.budgets where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and name = 'Admin budget' $$), 1,
  'role matrix admin write: admin can delete budgets');
select is(rls_test.affected($$
    insert into public.alert_rules (workspace_id, kind, scope, metric_key, threshold_percent)
    values ('c00000a0-0000-4000-8000-000000000000', 'allowance_percent', 'workspace', 'fake.admin', 90)
  $$), 1,
  'role matrix admin write: admin can insert alert_rules');
select is(rls_test.affected($$ update public.alert_rules set paused = true where id = 'c00000a7-0000-4000-8000-000000000000' $$), 1,
  'role matrix admin write: admin can update alert_rules');
select is(rls_test.affected($$ delete from public.alert_rules where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and metric_key = 'fake.admin' $$), 1,
  'role matrix admin write: admin can delete alert_rules');
select is(rls_test.affected($$
    update public.triggered_alerts set acknowledged_at = now(), acknowledged_by = 'c0000002-0000-4000-8000-000000000000'
    where id = 'c00000a8-0000-4000-8000-000000000000'
  $$), 1,
  'role matrix admin write: admin can acknowledge triggered_alerts');

select cmp_ok(rls_test.affected($$
    update public.workspace_members set role = 'viewer'
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000001-0000-4000-8000-000000000000'
  $$), '<=', 0,
  'role matrix admin members: admin cannot change an owner''s membership role');
select cmp_ok(rls_test.affected($$
    delete from public.workspace_members
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000001-0000-4000-8000-000000000000'
  $$), '<=', 0,
  'role matrix admin members: admin cannot remove an owner''s membership');
select cmp_ok(rls_test.affected($$
    update public.workspace_members set role = 'owner'
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000003-0000-4000-8000-000000000000'
  $$), '<=', 0,
  'role matrix admin members: admin cannot grant owner to an existing member');
select cmp_ok(rls_test.affected($$
    update public.workspace_members set role = 'owner'
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000002-0000-4000-8000-000000000000'
  $$), '<=', 0,
  'role matrix admin members: admin cannot promote themself to owner');
select cmp_ok(rls_test.affected($$
    insert into public.workspace_members (workspace_id, user_id, role)
    values ('c00000a0-0000-4000-8000-000000000000', 'c0000004-0000-4000-8000-000000000000', 'owner')
  $$), '<=', 0,
  'role matrix admin members: admin cannot add a new member as owner');
select is(rls_test.affected($$
    update public.workspace_members set role = 'admin'
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000003-0000-4000-8000-000000000000'
  $$), 1,
  'role matrix admin members: admin can promote a viewer to admin');
select is(rls_test.affected($$
    update public.workspace_members set role = 'viewer'
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000003-0000-4000-8000-000000000000'
  $$), 1,
  'role matrix admin members: admin can demote a non-owner admin to viewer');
select is(rls_test.affected($$
    insert into public.workspace_members (workspace_id, user_id, role)
    values ('c00000a0-0000-4000-8000-000000000000', 'c0000004-0000-4000-8000-000000000000', 'viewer')
  $$), 1,
  'role matrix admin members: admin can add a new member as viewer');
select is(rls_test.affected($$
    delete from public.workspace_members
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000004-0000-4000-8000-000000000000'
  $$), 1,
  'role matrix admin members: admin can remove a non-owner member');

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Owner: everything admin can do, plus owner memberships.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "c0000001-0000-4000-8000-000000000000", "role": "authenticated"}';

select is(rls_test.affected($$
    update public.workspace_members set role = 'owner'
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000002-0000-4000-8000-000000000000'
  $$), 1,
  'role matrix owner members: owner can grant owner to an admin');
select is(rls_test.affected($$
    update public.workspace_members set role = 'admin'
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000002-0000-4000-8000-000000000000'
  $$), 1,
  'role matrix owner members: owner can change another owner''s membership role');
select is(rls_test.affected($$
    insert into public.workspace_members (workspace_id, user_id, role)
    values ('c00000a0-0000-4000-8000-000000000000', 'c0000005-0000-4000-8000-000000000000', 'owner')
  $$), 1,
  'role matrix owner members: owner can add a new member as owner');
select is(rls_test.affected($$
    delete from public.workspace_members
    where workspace_id = 'c00000a0-0000-4000-8000-000000000000' and user_id = 'c0000005-0000-4000-8000-000000000000'
  $$), 1,
  'role matrix owner members: owner can remove another owner''s membership');
select is(rls_test.affected($$ update public.projects set name = 'Owner rename' where id = 'c00000a1-0000-4000-8000-000000000000' $$), 1,
  'role matrix owner write: owner can update projects');

-- Service role only tables: refused even for the highest role.
select cmp_ok(rls_test.affected($$ insert into public.workspaces (name) values ('Owner direct insert') $$), '<=', 0,
  'role matrix nobody: owner cannot insert workspaces directly (create_workspace function only)');
select cmp_ok(rls_test.affected($$
    insert into public.usage_snapshots (
      workspace_id, connection_id, external_account_id, metric_key, kind, label, snapshot_date,
      amount_minor, currency, period_start, period_end, retrieved_at, provenance_source
    )
    values ('c00000a0-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000', 'c00000a3-0000-4000-8000-000000000000',
            'fake.spend', 'verified_spend', 'Owner snapshot', date '2026-10-02',
            1, 'USD', timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-11-01 00:00:00+00', now(), 'provider_api')
  $$), '<=', 0,
  'role matrix nobody: owner cannot insert usage_snapshots (service role only)');
select cmp_ok(rls_test.affected($$ update public.usage_snapshots set amount_minor = 1 where id = 'c00000a4-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix nobody: owner cannot update usage_snapshots (service role only)');
select cmp_ok(rls_test.affected($$ delete from public.usage_snapshots where id = 'c00000a4-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix nobody: owner cannot delete usage_snapshots (service role only)');
select cmp_ok(rls_test.affected($$
    insert into public.activity_events (workspace_id, provider, type_id, severity, title, occurred_at, dedupe_key)
    values ('c00000a0-0000-4000-8000-000000000000', 'fake', 'fake.deployment', 'info', 'Owner event', now(), 'rls-role-owner-event')
  $$), '<=', 0,
  'role matrix nobody: owner cannot insert activity_events (service role only)');
select cmp_ok(rls_test.affected($$ update public.activity_events set title = 'Owner rename' where id = 'c00000a5-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix nobody: owner cannot update activity_events (service role only)');
select cmp_ok(rls_test.affected($$ delete from public.activity_events where id = 'c00000a5-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix nobody: owner cannot delete activity_events (service role only)');
select cmp_ok(rls_test.affected($$
    insert into public.sync_jobs (workspace_id, connection_id, kind)
    values ('c00000a0-0000-4000-8000-000000000000', 'c00000a2-0000-4000-8000-000000000000', 'sync')
  $$), '<=', 0,
  'role matrix nobody: owner cannot insert sync_jobs (service role only)');
select cmp_ok(rls_test.affected($$ update public.sync_jobs set status = 'succeeded' where id = 'c00000a9-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix nobody: owner cannot update sync_jobs (service role only)');
select cmp_ok(rls_test.affected($$ delete from public.sync_jobs where id = 'c00000a9-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix nobody: owner cannot delete sync_jobs (service role only)');
select cmp_ok(rls_test.affected($$
    insert into public.triggered_alerts (workspace_id, rule_id, cycle_key, threshold_label, is_estimated, message)
    values ('c00000a0-0000-4000-8000-000000000000', 'c00000a7-0000-4000-8000-000000000000', '2026-11-01', '80%', false, 'Owner alert')
  $$), '<=', 0,
  'role matrix nobody: owner cannot insert triggered_alerts (service role only)');
select cmp_ok(rls_test.affected($$ delete from public.triggered_alerts where id = 'c00000a8-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix nobody: owner cannot delete triggered_alerts (service role only)');
select cmp_ok(rls_test.affected($$ update public.triggered_alerts set message = 'Owner rewrite' where id = 'c00000a8-0000-4000-8000-000000000000' $$), '<=', 0,
  'role matrix nobody: owner cannot update triggered_alerts columns other than the acknowledge columns');

reset role;
reset request.jwt.claims;

-- Grants are the outer wall: whatever the policies say, authenticated holds no
-- write privilege on the service written tables, and on triggered_alerts it
-- may update the acknowledge columns only.
select is_empty(
  $$
    select t.tbl || ' ' || p.priv
    from unnest(array['public.usage_snapshots', 'public.activity_events', 'public.sync_jobs']) as t(tbl)
    cross join unnest(array['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']) as p(priv)
    where case
      when p.priv in ('INSERT', 'UPDATE') then has_any_column_privilege('authenticated', t.tbl, p.priv)
      else has_table_privilege('authenticated', t.tbl, p.priv)
    end
  $$,
  'role matrix nobody: authenticated has no insert, update, delete, or truncate grant on usage_snapshots, activity_events, sync_jobs');
select is_empty(
  $$
    select a.attname::text
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.triggered_alerts'::regclass
      and a.attnum > 0
      and not a.attisdropped
      and has_column_privilege('authenticated', a.attrelid, a.attnum, 'UPDATE')
      and a.attname not in ('acknowledged_at', 'acknowledged_by')
  $$,
  'role matrix: authenticated may update only acknowledged_at and acknowledged_by on triggered_alerts');

-- The writes above that were allowed really landed, and the refused ones did not.
select results_eq(
  $$
    select
      (select name from public.workspaces where id = 'c00000a0-0000-4000-8000-000000000000'),
      (select name from public.projects where id = 'c00000a1-0000-4000-8000-000000000000'),
      (select amount_minor from public.budgets where id = 'c00000a6-0000-4000-8000-000000000000'),
      (select acknowledged_by from public.triggered_alerts where id = 'c00000a8-0000-4000-8000-000000000000'),
      (select string_agg(user_id::text || '=' || role::text, ',' order by user_id)
         from public.workspace_members where workspace_id = 'c00000a0-0000-4000-8000-000000000000')
  $$,
  $$
    values (
      'Admin rename'::text,
      'Owner rename'::text,
      20000::bigint,
      'c0000002-0000-4000-8000-000000000000'::uuid,
      'c0000001-0000-4000-8000-000000000000=owner,c0000002-0000-4000-8000-000000000000=admin,c0000003-0000-4000-8000-000000000000=viewer'::text
    )
  $$,
  'role matrix: allowed writes persisted and membership ends as owner, admin, viewer');

select * from finish();

rollback;
