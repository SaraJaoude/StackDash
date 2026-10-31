-- Row level security must be on for every table in the public schema.
-- PostgREST exposes public, so a table without RLS is readable and writable by
-- any role that holds a grant on it. This file fails CI the moment a migration
-- adds a table and forgets `enable row level security`.
begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

select is_empty(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
    order by 1
  $$,
  'rls enabled: no table in schema public has row level security disabled'
);

-- Guards against a vacuous pass: the check above is meaningless if the schema
-- under test is empty or a table was renamed away from the contract.
select results_eq(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and c.relrowsecurity
      and c.relname = any (array[
        'access_invites', 'activity_events', 'alert_rules', 'budgets',
        'connection_credentials', 'connections', 'external_accounts',
        'oauth_states', 'profiles', 'projects', 'sync_jobs',
        'triggered_alerts', 'usage_snapshots', 'workspace_members', 'workspaces'
      ])
    order by 1
  $$,
  $$
    values
      ('access_invites'), ('activity_events'), ('alert_rules'), ('budgets'),
      ('connection_credentials'), ('connections'), ('external_accounts'),
      ('oauth_states'), ('profiles'), ('projects'), ('sync_jobs'),
      ('triggered_alerts'), ('usage_snapshots'), ('workspace_members'), ('workspaces')
  $$,
  'rls enabled: every contract table exists in public with row level security on'
);

-- Views run with their owner's rights unless security_invoker is set, which
-- would bypass the RLS on the tables underneath.
select is_empty(
  $$
    select c.relname::text
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('v', 'm')
      and not coalesce(
        c.reloptions @> array['security_invoker=true']
          or c.reloptions @> array['security_invoker=on'],
        false
      )
    order by 1
  $$,
  'rls enabled: no view in schema public bypasses rls (every view is security_invoker)'
);

-- Credential, OAuth state, and invite tables are service role only: RLS on and
-- no policy at all, so even a stray grant exposes nothing.
select is_empty(
  $$
    select tablename::text
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename in ('connection_credentials', 'oauth_states', 'access_invites')
  $$,
  'rls enabled: service only tables (connection_credentials, oauth_states, access_invites) have no policies'
);

select * from finish();

rollback;
