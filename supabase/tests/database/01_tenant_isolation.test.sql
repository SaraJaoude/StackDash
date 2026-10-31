-- Tenant isolation: a signed in user in workspace B can never read, change,
-- delete, or add rows in workspace A, on every tenant table.
-- Rows are seeded as postgres (the migration owner, which bypasses RLS) and the
-- attacker is impersonated through the same role and JWT claims PostgREST uses.
begin;

create extension if not exists pgtap with schema extensions;

select plan(61);

-- Test helper, rolled back with the transaction. Runs a statement as the
-- current role and returns the number of rows it touched, or -1 when Postgres
-- refuses it (missing grant or an RLS with check failure, both 42501). A
-- refused write is therefore any result <= 0. Other errors propagate so a bad
-- fixture fails loudly instead of passing as "refused".
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

-- Users. The on_auth_user_created trigger gives each one a personal workspace.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('aaaaaaaa-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-tenant-a@example.com', '{"user_name": "rls-tenant-a"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('bbbbbbbb-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-tenant-b@example.com', '{"user_name": "rls-tenant-b"}', '{"provider": "github", "providers": ["github"]}', now(), now());

-- Workspace A with one row in every tenant table, owned by user A.
insert into public.workspaces (id, name, created_by)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'Workspace A', 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role)
values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000001', 'owner');

insert into public.projects (id, workspace_id, name, created_by, updated_by)
values ('aaaaaaaa-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000002', 'Project A',
        'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.connections (id, workspace_id, provider, status, display_name, poll_interval_seconds, created_by, updated_by)
values ('aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000002', 'fake', 'active',
        'Connection A', 3600, 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.external_accounts (id, workspace_id, connection_id, external_id, display_name, kind)
values ('aaaaaaaa-0000-4000-8000-000000000005', 'aaaaaaaa-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000004', 'ext-a', 'Account A', 'team');

insert into public.usage_snapshots (
  id, workspace_id, connection_id, external_account_id, metric_key, kind, label, snapshot_date,
  amount_minor, currency, period_start, period_end, retrieved_at, provenance_source
)
values ('aaaaaaaa-0000-4000-8000-000000000006', 'aaaaaaaa-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000005',
        'fake.spend', 'verified_spend', 'Snapshot A', date '2026-10-01',
        1234, 'USD', timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-11-01 00:00:00+00', now(), 'provider_api');

insert into public.activity_events (
  id, workspace_id, connection_id, external_account_id, provider, type_id, severity, title, occurred_at, dedupe_key
)
values ('aaaaaaaa-0000-4000-8000-000000000007', 'aaaaaaaa-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000005',
        'fake', 'fake.deployment', 'info', 'Event A', now(), 'rls-tenant-a-event');

insert into public.budgets (id, workspace_id, name, scope, amount_minor, currency, created_by, updated_by)
values ('aaaaaaaa-0000-4000-8000-000000000008', 'aaaaaaaa-0000-4000-8000-000000000002', 'Budget A', 'workspace',
        10000, 'USD', 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.alert_rules (id, workspace_id, kind, scope, metric_key, threshold_percent, created_by, updated_by)
values ('aaaaaaaa-0000-4000-8000-000000000009', 'aaaaaaaa-0000-4000-8000-000000000002', 'allowance_percent',
        'workspace', 'fake.minutes', 80, 'aaaaaaaa-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001');

insert into public.triggered_alerts (id, workspace_id, rule_id, cycle_key, threshold_label, is_estimated, message)
values ('aaaaaaaa-0000-4000-8000-000000000010', 'aaaaaaaa-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000009', '2026-10-01', '80%', false, 'Alert A');

insert into public.sync_jobs (id, workspace_id, connection_id, kind, dedupe_key)
values ('aaaaaaaa-0000-4000-8000-000000000011', 'aaaaaaaa-0000-4000-8000-000000000002',
        'aaaaaaaa-0000-4000-8000-000000000004', 'sync', 'rls-tenant-a-sync');

-- Workspace B with a project, so user B has something of their own to move.
insert into public.workspaces (id, name, created_by)
values ('bbbbbbbb-0000-4000-8000-000000000002', 'Workspace B', 'bbbbbbbb-0000-4000-8000-000000000001');

insert into public.workspace_members (workspace_id, user_id, role)
values ('bbbbbbbb-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'owner');

insert into public.projects (id, workspace_id, name, created_by, updated_by)
values ('bbbbbbbb-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000002', 'Project B',
        'bbbbbbbb-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000001');

-- ---------------------------------------------------------------------------
-- Control: user A sees their own rows, so the empty results for B below are
-- caused by the policies and not by missing fixtures.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "aaaaaaaa-0000-4000-8000-000000000001", "role": "authenticated"}';

select isnt_empty($$ select id from public.workspaces where id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select workspaces in workspace A');
select isnt_empty($$ select user_id from public.workspace_members where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select workspace_members in workspace A');
select isnt_empty($$ select id from public.projects where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select projects in workspace A');
select isnt_empty($$ select id from public.connections where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select connections in workspace A');
select isnt_empty($$ select id from public.external_accounts where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select external_accounts in workspace A');
select isnt_empty($$ select id from public.usage_snapshots where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select usage_snapshots in workspace A');
select isnt_empty($$ select id from public.activity_events where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select activity_events in workspace A');
select isnt_empty($$ select id from public.budgets where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select budgets in workspace A');
select isnt_empty($$ select id from public.alert_rules where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select alert_rules in workspace A');
select isnt_empty($$ select id from public.triggered_alerts where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select triggered_alerts in workspace A');
select isnt_empty($$ select id from public.sync_jobs where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation control: member A can select sync_jobs in workspace A');

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- User B against workspace A.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "bbbbbbbb-0000-4000-8000-000000000001", "role": "authenticated"}';

-- Select
select is_empty($$ select id from public.workspaces where id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select workspaces of workspace A');
select is_empty($$ select user_id from public.workspace_members where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select workspace_members of workspace A');
select is_empty($$ select id from public.projects where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select projects of workspace A');
select is_empty($$ select id from public.connections where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select connections of workspace A');
select is_empty($$ select id from public.external_accounts where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select external_accounts of workspace A');
select is_empty($$ select id from public.usage_snapshots where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select usage_snapshots of workspace A');
select is_empty($$ select id from public.activity_events where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select activity_events of workspace A');
select is_empty($$ select id from public.budgets where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select budgets of workspace A');
select is_empty($$ select id from public.alert_rules where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select alert_rules of workspace A');
select is_empty($$ select id from public.triggered_alerts where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select triggered_alerts of workspace A');
select is_empty($$ select id from public.sync_jobs where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$,
  'tenant isolation select: non-member B cannot select sync_jobs of workspace A');
select is_empty($$ select user_id from public.profiles where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$,
  'tenant isolation select: user B cannot select the profile of user A');

-- Every workspace B can see, including the personal one created by the auth
-- trigger, has B as a member. Catches a leak of any other workspace.
select is_empty(
  $$
    select w.id from public.workspaces w
    where not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = w.id and m.user_id = 'bbbbbbbb-0000-4000-8000-000000000001'
    )
  $$,
  'tenant isolation select: user B sees only workspaces where B is a member');

-- Update
select cmp_ok(rls_test.affected($$ update public.workspaces set name = 'Hijacked' where id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot update workspaces of workspace A');
select cmp_ok(rls_test.affected($$ update public.workspace_members set role = 'viewer' where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot update workspace_members of workspace A');
select cmp_ok(rls_test.affected($$ update public.projects set name = 'Hijacked' where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot update projects of workspace A');
select cmp_ok(rls_test.affected($$ update public.connections set display_name = 'Hijacked' where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot update connections of workspace A');
select cmp_ok(rls_test.affected($$ update public.external_accounts set included = false where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot update external_accounts of workspace A');
select cmp_ok(rls_test.affected($$ update public.usage_snapshots set label = 'Hijacked' where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot update usage_snapshots of workspace A');
select cmp_ok(rls_test.affected($$ update public.activity_events set title = 'Hijacked' where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot update activity_events of workspace A');
select cmp_ok(rls_test.affected($$ update public.budgets set name = 'Hijacked' where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot update budgets of workspace A');
select cmp_ok(rls_test.affected($$ update public.alert_rules set paused = true where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot update alert_rules of workspace A');
select cmp_ok(rls_test.affected($$ update public.triggered_alerts set acknowledged_at = now(), acknowledged_by = 'bbbbbbbb-0000-4000-8000-000000000001' where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot acknowledge triggered_alerts of workspace A');
select cmp_ok(rls_test.affected($$ update public.sync_jobs set status = 'failed' where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation update: non-member B cannot update sync_jobs of workspace A');
select cmp_ok(rls_test.affected($$ update public.profiles set display_name = 'Hijacked' where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' $$), '<=', 0,
  'tenant isolation update: user B cannot update the profile of user A');

-- Delete
select cmp_ok(rls_test.affected($$ delete from public.workspaces where id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete workspaces of workspace A');
select cmp_ok(rls_test.affected($$ delete from public.workspace_members where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete workspace_members of workspace A');
select cmp_ok(rls_test.affected($$ delete from public.projects where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete projects of workspace A');
select cmp_ok(rls_test.affected($$ delete from public.connections where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete connections of workspace A');
select cmp_ok(rls_test.affected($$ delete from public.external_accounts where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete external_accounts of workspace A');
select cmp_ok(rls_test.affected($$ delete from public.usage_snapshots where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete usage_snapshots of workspace A');
select cmp_ok(rls_test.affected($$ delete from public.activity_events where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete activity_events of workspace A');
select cmp_ok(rls_test.affected($$ delete from public.budgets where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete budgets of workspace A');
select cmp_ok(rls_test.affected($$ delete from public.alert_rules where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete alert_rules of workspace A');
select cmp_ok(rls_test.affected($$ delete from public.triggered_alerts where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete triggered_alerts of workspace A');
select cmp_ok(rls_test.affected($$ delete from public.sync_jobs where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' $$), '<=', 0,
  'tenant isolation delete: non-member B cannot delete sync_jobs of workspace A');

-- Insert into workspace A
select cmp_ok(rls_test.affected($$ insert into public.workspaces (name) values ('Intruder workspace') $$), '<=', 0,
  'tenant isolation insert: user B cannot insert workspaces directly (create_workspace function only)');
select cmp_ok(rls_test.affected($$
    insert into public.workspace_members (workspace_id, user_id, role)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'viewer')
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot add themself to workspace A as viewer');
select cmp_ok(rls_test.affected($$
    insert into public.workspace_members (workspace_id, user_id, role)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000001', 'owner')
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot add themself to workspace A as owner');
select cmp_ok(rls_test.affected($$
    insert into public.projects (workspace_id, name)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'Intruder project')
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot insert projects into workspace A');
select cmp_ok(rls_test.affected($$
    insert into public.connections (workspace_id, provider, display_name, poll_interval_seconds)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'fake', 'Intruder connection', 3600)
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot insert connections into workspace A');
select cmp_ok(rls_test.affected($$
    insert into public.external_accounts (workspace_id, connection_id, external_id, display_name, kind)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004', 'ext-intruder', 'Intruder account', 'team')
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot insert external_accounts into workspace A');
select cmp_ok(rls_test.affected($$
    insert into public.usage_snapshots (
      workspace_id, connection_id, external_account_id, metric_key, kind, label, snapshot_date,
      amount_minor, currency, period_start, period_end, retrieved_at, provenance_source
    )
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004', 'aaaaaaaa-0000-4000-8000-000000000005',
            'fake.spend', 'verified_spend', 'Intruder snapshot', date '2026-10-02',
            1, 'USD', timestamptz '2026-10-01 00:00:00+00', timestamptz '2026-11-01 00:00:00+00', now(), 'provider_api')
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot insert usage_snapshots into workspace A');
select cmp_ok(rls_test.affected($$
    insert into public.activity_events (workspace_id, provider, type_id, severity, title, occurred_at, dedupe_key)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'fake', 'fake.deployment', 'critical', 'Intruder event', now(), 'rls-tenant-intruder-event')
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot insert activity_events into workspace A');
select cmp_ok(rls_test.affected($$
    insert into public.budgets (workspace_id, name, scope, amount_minor, currency)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'Intruder budget', 'workspace', 100, 'USD')
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot insert budgets into workspace A');
select cmp_ok(rls_test.affected($$
    insert into public.alert_rules (workspace_id, kind, scope, metric_key, threshold_percent)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'allowance_percent', 'workspace', 'fake.minutes', 50)
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot insert alert_rules into workspace A');
select cmp_ok(rls_test.affected($$
    insert into public.triggered_alerts (workspace_id, rule_id, cycle_key, threshold_label, is_estimated, message)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000009', '2026-11-01', '50%', false, 'Intruder alert')
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot insert triggered_alerts into workspace A');
select cmp_ok(rls_test.affected($$
    insert into public.sync_jobs (workspace_id, connection_id, kind)
    values ('aaaaaaaa-0000-4000-8000-000000000002', 'aaaaaaaa-0000-4000-8000-000000000004', 'sync')
  $$), '<=', 0,
  'tenant isolation insert: non-member B cannot insert sync_jobs into workspace A');

-- Moving a row B legitimately owns into workspace A is an insert by another name.
select cmp_ok(rls_test.affected($$
    update public.projects set workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002'
    where id = 'bbbbbbbb-0000-4000-8000-000000000003'
  $$), '<=', 0,
  'tenant isolation update: owner B cannot move a project from workspace B into workspace A');

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- As postgres: every seeded row in workspace A survived untouched. Lists the
-- tables whose row changed or disappeared, so a failure names the table.
-- ---------------------------------------------------------------------------
select is_empty(
  $$
    select 'workspaces' where not exists (select 1 from public.workspaces where id = 'aaaaaaaa-0000-4000-8000-000000000002' and name = 'Workspace A')
    union all
    select 'workspace_members' where (select count(*) from public.workspace_members where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002') <> 1
      or not exists (select 1 from public.workspace_members where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002' and user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and role = 'owner')
    union all
    select 'projects' where (select count(*) from public.projects where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002') <> 1
      or not exists (select 1 from public.projects where id = 'aaaaaaaa-0000-4000-8000-000000000003' and name = 'Project A')
    union all
    select 'connections' where (select count(*) from public.connections where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002') <> 1
      or not exists (select 1 from public.connections where id = 'aaaaaaaa-0000-4000-8000-000000000004' and display_name = 'Connection A')
    union all
    select 'external_accounts' where (select count(*) from public.external_accounts where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002') <> 1
      or not exists (select 1 from public.external_accounts where id = 'aaaaaaaa-0000-4000-8000-000000000005' and included)
    union all
    select 'usage_snapshots' where (select count(*) from public.usage_snapshots where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002') <> 1
      or not exists (select 1 from public.usage_snapshots where id = 'aaaaaaaa-0000-4000-8000-000000000006' and label = 'Snapshot A')
    union all
    select 'activity_events' where (select count(*) from public.activity_events where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002') <> 1
      or not exists (select 1 from public.activity_events where id = 'aaaaaaaa-0000-4000-8000-000000000007' and title = 'Event A')
    union all
    select 'budgets' where (select count(*) from public.budgets where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002') <> 1
      or not exists (select 1 from public.budgets where id = 'aaaaaaaa-0000-4000-8000-000000000008' and name = 'Budget A')
    union all
    select 'alert_rules' where (select count(*) from public.alert_rules where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002') <> 1
      or not exists (select 1 from public.alert_rules where id = 'aaaaaaaa-0000-4000-8000-000000000009' and not paused)
    union all
    select 'triggered_alerts' where (select count(*) from public.triggered_alerts where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002') <> 1
      or not exists (select 1 from public.triggered_alerts where id = 'aaaaaaaa-0000-4000-8000-000000000010' and acknowledged_at is null)
    union all
    select 'sync_jobs' where (select count(*) from public.sync_jobs where workspace_id = 'aaaaaaaa-0000-4000-8000-000000000002') <> 1
      or not exists (select 1 from public.sync_jobs where id = 'aaaaaaaa-0000-4000-8000-000000000011' and status = 'queued')
    union all
    select 'profiles' where not exists (select 1 from public.profiles where user_id = 'aaaaaaaa-0000-4000-8000-000000000001' and display_name is distinct from 'Hijacked')
    union all
    select 'projects (workspace B)' where not exists (select 1 from public.projects where id = 'bbbbbbbb-0000-4000-8000-000000000003' and workspace_id = 'bbbbbbbb-0000-4000-8000-000000000002')
  $$,
  'tenant isolation: every row seeded in workspace A (and B''s project) is unchanged after user B''s attempts');

select * from finish();

rollback;
