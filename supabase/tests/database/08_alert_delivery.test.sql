-- Alert delivery (#152, #153): a member reads and writes only their own
-- notification preference, and only owners and admins may write one; channel
-- secrets and delivery records are service role only; removing a channel
-- deletes its sealed URL and rule links; recipients are owners and admins.
begin;

create extension if not exists pgtap with schema extensions;

select plan(38);

-- Rows touched, or -1 when Postgres refuses the statement (42501: missing
-- grant or RLS with check). Rolled back with the transaction.
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

-- Fixtures as postgres: owner, admin, viewer of workspace A; an outsider who
-- owns workspace B.
insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
values
  ('f8000001-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-alerts-owner@example.com', '{"user_name": "rls-alerts-owner"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('f8000002-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-alerts-admin@example.com', '{"user_name": "rls-alerts-admin"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('f8000003-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-alerts-viewer@example.com', '{"user_name": "rls-alerts-viewer"}', '{"provider": "github", "providers": ["github"]}', now(), now()),
  ('f8000004-0000-4000-8000-000000000000', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
   'rls-alerts-outsider@example.com', '{"user_name": "rls-alerts-outsider"}', '{"provider": "github", "providers": ["github"]}', now(), now());

insert into public.workspaces (id, name, created_by)
values
  ('f80000a0-0000-4000-8000-000000000000', 'Alert delivery team', 'f8000001-0000-4000-8000-000000000000'),
  ('f80000b0-0000-4000-8000-000000000000', 'Other team', 'f8000004-0000-4000-8000-000000000000');

insert into public.workspace_members (workspace_id, user_id, role)
values
  ('f80000a0-0000-4000-8000-000000000000', 'f8000001-0000-4000-8000-000000000000', 'owner'),
  ('f80000a0-0000-4000-8000-000000000000', 'f8000002-0000-4000-8000-000000000000', 'admin'),
  ('f80000a0-0000-4000-8000-000000000000', 'f8000003-0000-4000-8000-000000000000', 'viewer'),
  ('f80000b0-0000-4000-8000-000000000000', 'f8000004-0000-4000-8000-000000000000', 'owner');

insert into public.alert_rules (id, workspace_id, kind, scope, threshold_percent)
values ('f80000a1-0000-4000-8000-000000000000', 'f80000a0-0000-4000-8000-000000000000', 'allowance_percent', 'workspace', 80);

-- A channel written the way the app writes one: row, sealed URL, and rule link together.
select lives_ok($$
    select public.create_notification_destination(
      'f80000a2-0000-4000-8000-000000000000', 'f80000a0-0000-4000-8000-000000000000', 'discord', '#alerts',
      'discord.com', false, 'daily', array['f80000a1-0000-4000-8000-000000000000']::uuid[],
      'deadbeef', '\x00'::bytea, '\x01'::bytea, '\x02'::bytea, 'f8000001-0000-4000-8000-000000000000')
  $$,
  'channels: create_notification_destination writes the channel as the service role');

-- ---------------------------------------------------------------------------
-- notification_preferences: own row only, owners and admins only.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "f8000001-0000-4000-8000-000000000000", "role": "authenticated"}';

select is(rls_test.affected($$
    insert into public.notification_preferences (workspace_id, user_id, email_frequency)
    values ('f80000a0-0000-4000-8000-000000000000', 'f8000001-0000-4000-8000-000000000000', 'daily')
  $$), 1, 'preferences: an owner saves their own setting');
select is(rls_test.affected($$
    insert into public.notification_preferences (workspace_id, user_id, email_frequency)
    values ('f80000a0-0000-4000-8000-000000000000', 'f8000003-0000-4000-8000-000000000000', 'off')
  $$), -1, 'preferences: an owner cannot write a setting for another member');
select is(rls_test.affected($$
    insert into public.notification_preferences (workspace_id, user_id, email_frequency)
    values ('f80000b0-0000-4000-8000-000000000000', 'f8000001-0000-4000-8000-000000000000', 'off')
  $$), -1, 'preferences: nobody writes a setting in a workspace they do not belong to');
select is(rls_test.affected($$
    update public.notification_preferences set email_frequency = 'weekly'
    where workspace_id = 'f80000a0-0000-4000-8000-000000000000' and user_id = 'f8000001-0000-4000-8000-000000000000'
  $$), 1, 'preferences: an owner changes their own setting');
select is(rls_test.affected($$
    delete from public.notification_preferences where workspace_id = 'f80000a0-0000-4000-8000-000000000000'
  $$), -1, 'preferences: a member cannot delete a setting (no delete grant; leaving the workspace removes it)');

set local request.jwt.claims to '{"sub": "f8000002-0000-4000-8000-000000000000", "role": "authenticated"}';

select is(rls_test.affected($$
    insert into public.notification_preferences (workspace_id, user_id, email_frequency)
    values ('f80000a0-0000-4000-8000-000000000000', 'f8000002-0000-4000-8000-000000000000', 'off')
  $$), 1, 'preferences: an admin saves their own setting');
select is((select count(*)::int from public.notification_preferences where workspace_id = 'f80000a0-0000-4000-8000-000000000000'), 1,
  'preferences: an admin sees only their own row, not the owner''s');
select is(rls_test.affected($$
    update public.notification_preferences set email_frequency = 'off'
    where workspace_id = 'f80000a0-0000-4000-8000-000000000000' and user_id = 'f8000001-0000-4000-8000-000000000000'
  $$), 0, 'preferences: an admin cannot change the owner''s setting');
select is(rls_test.affected($$
    update public.notification_preferences set user_id = 'f8000001-0000-4000-8000-000000000000'
    where workspace_id = 'f80000a0-0000-4000-8000-000000000000' and user_id = 'f8000002-0000-4000-8000-000000000000'
  $$), -1, 'preferences: an admin cannot hand their row to another member');

set local request.jwt.claims to '{"sub": "f8000003-0000-4000-8000-000000000000", "role": "authenticated"}';

select is(rls_test.affected($$
    insert into public.notification_preferences (workspace_id, user_id, email_frequency)
    values ('f80000a0-0000-4000-8000-000000000000', 'f8000003-0000-4000-8000-000000000000', 'immediate')
  $$), -1, 'preferences: a viewer cannot save a setting (viewers receive no alert email)');
select is((select count(*)::int from public.notification_preferences), 0,
  'preferences: a viewer sees no other member''s setting');

set local request.jwt.claims to '{"sub": "f8000004-0000-4000-8000-000000000000", "role": "authenticated"}';

select is((select count(*)::int from public.notification_preferences where workspace_id = 'f80000a0-0000-4000-8000-000000000000'), 0,
  'preferences: an outsider sees nothing in another workspace');

reset role;
reset request.jwt.claims;

set local role anon;
set local request.jwt.claims to '{"role": "anon"}';

select throws_ok($$ select user_id from public.notification_preferences $$, '42501'::char(5), null::text,
  'preferences: anon cannot read settings');

reset role;
reset request.jwt.claims;

-- ---------------------------------------------------------------------------
-- Channels: members read, admins change name and routing, secrets stay server side.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub": "f8000003-0000-4000-8000-000000000000", "role": "authenticated"}';

select is((select count(*)::int from public.notification_destinations), 1, 'channels: a viewer sees the workspace''s channel');
select is(rls_test.affected($$ update public.notification_destinations set name = 'Renamed' $$), 0,
  'channels: a viewer cannot rename a channel');
select is(rls_test.affected($$ delete from public.notification_destinations $$), 0,
  'channels: a viewer cannot remove a channel');
select is(rls_test.affected($$ delete from public.alert_rule_destinations $$), 0,
  'channels: a viewer cannot change which rules a channel receives');
select throws_ok($$ select ciphertext from public.notification_destination_secrets $$, '42501'::char(5), null::text,
  'channel secrets: a viewer cannot read a sealed URL');

set local request.jwt.claims to '{"sub": "f8000004-0000-4000-8000-000000000000", "role": "authenticated"}';

select is((select count(*)::int from public.notification_destinations), 0, 'channels: an outsider sees no channel of another workspace');
select is((select count(*)::int from public.alert_rule_destinations), 0, 'channels: an outsider sees no rule link of another workspace');

set local request.jwt.claims to '{"sub": "f8000001-0000-4000-8000-000000000000", "role": "authenticated"}';

select throws_ok($$ select ciphertext from public.notification_destination_secrets $$, '42501'::char(5), null::text,
  'channel secrets: even an owner cannot read a sealed URL');
select throws_ok($$ select target_key from public.notification_deliveries $$, '42501'::char(5), null::text,
  'deliveries: an owner cannot read delivery records');
select is(rls_test.affected($$
    update public.notification_destinations set status = 'active', consecutive_failures = 0
    where id = 'f80000a2-0000-4000-8000-000000000000'
  $$), -1, 'channels: an owner cannot clear a channel''s health (server written)');
select is(rls_test.affected($$
    insert into public.notification_destinations (workspace_id, kind, name, url_host)
    values ('f80000a0-0000-4000-8000-000000000000', 'slack', 'Direct', 'hooks.slack.com')
  $$), -1, 'channels: a channel cannot be inserted without its sealed URL (server only)');
select is(rls_test.affected($$
    update public.notification_destinations set name = 'Ops alerts', digest = 'weekly'
    where id = 'f80000a2-0000-4000-8000-000000000000'
  $$), 1, 'channels: an owner renames a channel and changes its digest');
select is(rls_test.affected($$ delete from public.notification_destinations where id = 'f80000a2-0000-4000-8000-000000000000' $$), 1,
  'channels: an owner removes a channel');

reset role;
reset request.jwt.claims;

select is((select count(*)::int from public.notification_destination_secrets where destination_id = 'f80000a2-0000-4000-8000-000000000000'), 0,
  'channels: removing a channel deletes its sealed URL');
select is((select count(*)::int from public.alert_rule_destinations where destination_id = 'f80000a2-0000-4000-8000-000000000000'), 0,
  'channels: removing a channel deletes its rule links');

-- Grants are the outer wall on the service only tables.
select is_empty(
  $$
    select r.role || ' ' || t.tbl || ' ' || p.priv
    from unnest(array['anon', 'authenticated']) as r(role)
    cross join unnest(array['public.notification_destination_secrets', 'public.notification_deliveries']) as t(tbl)
    cross join unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) as p(priv)
    where case
      when p.priv in ('SELECT', 'INSERT', 'UPDATE', 'REFERENCES') then has_any_column_privilege(r.role, t.tbl, p.priv)
      else has_table_privilege(r.role, t.tbl, p.priv)
    end
  $$,
  'service only: anon and authenticated hold no privilege on notification_destination_secrets or notification_deliveries');

-- ---------------------------------------------------------------------------
-- Functions: service role only.
-- ---------------------------------------------------------------------------
select ok(not has_function_privilege('authenticated',
    'public.create_notification_destination(uuid, uuid, public.destination_kind, text, text, boolean, public.digest_frequency, uuid[], text, bytea, bytea, bytea, uuid)',
    'execute'),
  'function grants: authenticated cannot execute create_notification_destination');
select ok(not has_function_privilege('authenticated', 'public.notification_recipients(uuid)', 'execute'),
  'function grants: authenticated cannot execute notification_recipients (it reads email addresses)');
select ok(not has_function_privilege('authenticated', 'public.enqueue_alert_dispatches()', 'execute'),
  'function grants: authenticated cannot execute enqueue_alert_dispatches');
select ok(not has_function_privilege('authenticated', 'public.enqueue_digests(date)', 'execute'),
  'function grants: authenticated cannot execute enqueue_digests');
select ok(not has_function_privilege('authenticated', 'public.purge_notification_deliveries(timestamp with time zone, integer)', 'execute'),
  'function grants: authenticated cannot execute purge_notification_deliveries');
select ok(has_function_privilege('service_role', 'public.notification_recipients(uuid)', 'execute'),
  'function grants: the service role can execute notification_recipients');

-- ---------------------------------------------------------------------------
-- Recipients: owners and admins with their setting, never viewers.
-- ---------------------------------------------------------------------------
select results_eq(
  $$ select user_id, email_frequency::text from public.notification_recipients('f80000a0-0000-4000-8000-000000000000') $$,
  $$ values ('f8000001-0000-4000-8000-000000000000'::uuid, 'weekly'), ('f8000002-0000-4000-8000-000000000000'::uuid, 'off') $$,
  'recipients: the owner and the admin with their own settings, and not the viewer');

-- A member who never chose gets each alert as it happens (decision on #152).
delete from public.notification_preferences where user_id = 'f8000002-0000-4000-8000-000000000000';

select results_eq(
  $$ select email_frequency::text from public.notification_recipients('f80000a0-0000-4000-8000-000000000000')
     where user_id = 'f8000002-0000-4000-8000-000000000000' $$,
  $$ values ('immediate') $$,
  'recipients: an admin with no saved setting defaults to immediate');

select * from finish();

rollback;
