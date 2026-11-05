-- Railway adapter (#113): the provider id exists, and a value outside the enum is still refused.
begin;

create extension if not exists pgtap with schema extensions;

select plan(2);

select ok(
  'railway' = any (enum_range(null::public.provider_id)::text[]),
  'provider_id accepts railway'
);

select throws_ok(
  $$ select 'railways'::public.provider_id $$,
  '22P02',
  null,
  'provider_id refuses a near miss of railway'
);

select * from finish();
rollback;
