-- DigitalOcean provider id (issue #116): the adapter's id is a value of public.provider_id, so a
-- connection, event, or alert rule can name it, and the enum still refuses a near miss.
begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

select ok(
  'digitalocean' = any (enum_range(null::public.provider_id)::text[]),
  'provider_id: digitalocean is a provider id'
);

select throws_ok(
  $$ select 'DigitalOcean'::public.provider_id $$,
  '22P02',
  null,
  'provider_id: ids are lowercase, so DigitalOcean is refused'
);

select * from finish();

rollback;
