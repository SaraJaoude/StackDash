-- Events per connection for the timeline's connection badges (issue #245): the logo of every
-- connection with events in view and how many it holds, under the same filters as the event list.
-- PostgREST has no GROUP BY without db aggregates, which this project leaves off, and neither
-- existing counter fits: count_activity_events needs account ids, type ids, and a window, and the
-- activity_event_daily_counts rollup has neither connection_id nor severity.
--
-- Security definer with one membership check up front, like activity_event_counts: a non-member
-- gets no rows. Security invoker evaluated the activity_events and connections select policies on
-- every row, which took 427 ms for a workspace of 23,000 events in a local explain analyze; the
-- same aggregate without them takes 6.5 ms. Every row read is still scoped to p_workspace_id.
--
-- Every filter mirrors listTimelineEvents (src/lib/data/timeline.ts), so a badge counts what the
-- timeline lists across all of its pages. An empty array means no filter on that column, except
-- p_hidden_type_ids, which always excludes what it lists. p_account_ids null means every account,
-- and an empty array means none. The window is half open: occurred_at >= p_from and < p_until,
-- and a null bound is open. Events with no connection (DevMacro's own, such as daily summaries)
-- belong to no badge.
create function public.timeline_connection_event_counts(
  p_workspace_id uuid,
  p_type_ids text[] default '{}',
  p_hidden_type_ids text[] default '{}',
  p_severities public.event_severity[] default '{}',
  p_providers public.provider_id[] default '{}',
  p_account_ids uuid[] default null,
  p_from timestamptz default null,
  p_until timestamptz default null
)
returns table (connection_id uuid, provider public.provider_id, display_name text, events bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_workspace_role(p_workspace_id, 'viewer') then
    return;
  end if;
  return query
    select c.id, c.provider, c.display_name, count(*)
    from public.activity_events e
    join public.connections c on c.workspace_id = e.workspace_id and c.id = e.connection_id
    where e.workspace_id = p_workspace_id
      and (coalesce(cardinality(p_type_ids), 0) = 0 or e.type_id = any (p_type_ids))
      and e.type_id <> all (coalesce(p_hidden_type_ids, '{}'))
      and (coalesce(cardinality(p_severities), 0) = 0 or e.severity = any (p_severities))
      and (coalesce(cardinality(p_providers), 0) = 0 or e.provider = any (p_providers))
      and (p_account_ids is null or e.external_account_id = any (p_account_ids))
      and (p_from is null or e.occurred_at >= p_from)
      and (p_until is null or e.occurred_at < p_until)
    group by c.id, c.provider, c.display_name;
end;
$$;

revoke execute on function public.timeline_connection_event_counts(uuid, text[], text[], public.event_severity[], public.provider_id[], uuid[], timestamptz, timestamptz) from public, anon;
grant execute on function public.timeline_connection_event_counts(uuid, text[], text[], public.event_severity[], public.provider_id[], uuid[], timestamptz, timestamptz) to authenticated;
