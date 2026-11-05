-- Event markers on the dashboard trend charts (#168): how many events of the given types happened
-- on each UTC day, per provider and type, from p_since onward.
--
-- * A day is the UTC calendar day of occurred_at, the same days usage_snapshots.snapshot_date and
--   the trend buckets use, whatever the session time zone is.
-- * Filters mirror the timeline query (src/lib/data/timeline.ts), so a marker counts exactly the
--   events its timeline link lists: p_providers empty means any provider, otherwise events with no
--   provider (DevMacro's own, such as devmacro.alert_triggered) are left out; p_account_ids null
--   means any account, otherwise events with no account are left out.
-- * security invoker: row level security on activity_events decides what the caller can count, so
--   a non-member counts nothing. Walks activity_events_workspace_timeline_idx
--   (workspace_id, occurred_at desc, id desc) for the window.
-- * One row per day, provider, and type with at least one event, so the result is bounded by the
--   window length times the number of requested types. The caller pages it.

create function public.activity_event_daily_counts(
  p_workspace_id uuid,
  p_since date,
  p_type_ids text[],
  p_providers public.provider_id[] default '{}',
  p_account_ids uuid[] default null
)
  returns table (day date, provider public.provider_id, type_id text, event_count bigint)
  language sql
  stable
  security invoker
  set search_path = ''
as $$
  select (e.occurred_at at time zone 'UTC')::date as day, e.provider, e.type_id, count(*) as event_count
  from public.activity_events e
  where e.workspace_id = p_workspace_id
    and e.occurred_at >= (p_since::timestamp at time zone 'UTC')
    and e.type_id = any (p_type_ids)
    and (coalesce(cardinality(p_providers), 0) = 0 or e.provider = any (p_providers))
    and (p_account_ids is null or e.external_account_id = any (p_account_ids))
  group by 1, 2, 3
$$;

revoke execute on function public.activity_event_daily_counts(uuid, date, text[], public.provider_id[], uuid[])
  from public, anon, authenticated;
grant execute on function public.activity_event_daily_counts(uuid, date, text[], public.provider_id[], uuid[])
  to authenticated, service_role;
