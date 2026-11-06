-- GitLab adapter (issue #112): `gitlab` is a provider id, so a GitLab connection, its synced rows,
-- and alert rules scoped to GitLab can be stored. The labels are checked one by one rather than
-- with enum_has_labels, so another provider added beside it does not fail this file.
begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

select ok(
  exists (
    select 1
    from pg_catalog.pg_enum e
    join pg_catalog.pg_type t on t.oid = e.enumtypid
    join pg_catalog.pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'provider_id'
      and e.enumlabel = 'gitlab'
  ),
  'provider gitlab: public.provider_id has the gitlab label'
);

-- The ids the adapters already use stay valid next to the new one.
select lives_ok(
  $$ select array['vercel', 'github', 'resend', 'stripe', 'supabase', 'fake', 'digitalocean', 'posthog', 'polar', 'sentry', 'railway', 'gitlab']::public.provider_id[] $$,
  'provider gitlab: every existing provider id and gitlab cast to public.provider_id'
);

select * from finish();

rollback;
