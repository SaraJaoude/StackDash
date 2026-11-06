-- Event counts for the dashboard's headline strip (issue #173): signups and deploys per connection
-- and event type within one window, so the page reads a handful of counts instead of every event
-- row. PostgREST has no GROUP BY without db aggregates, which this project leaves off.
--
-- Security invoker, so the activity_events select policy (has_workspace_role viewer) applies to
-- the caller exactly as it does to the timeline: a non-member counts nothing. The occurred_at range
-- keeps the read on an index range scan (activity_events_occurred_at_idx or
-- activity_events_workspace_timeline_idx, as the planner prefers): 3 ms for a week out of 24,000
-- events in a local explain analyze.
--
-- p_account_ids are the external accounts the dashboard's scope filter leaves in view (included
-- accounts only), so events of excluded or out of scope accounts never count. The window is half
-- open: occurred_at >= p_from and < p_until.
create function public.count_activity_events(
  p_workspace_id uuid,
  p_account_ids uuid[],
  p_type_ids text[],
  p_from timestamptz,
  p_until timestamptz
)
returns table (connection_id uuid, type_id text, events integer)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.connection_id, e.type_id, count(*)::integer
  from public.activity_events e
  where e.workspace_id = p_workspace_id
    and e.external_account_id = any (p_account_ids)
    and e.type_id = any (p_type_ids)
    and e.occurred_at >= p_from
    and e.occurred_at < p_until
    and e.connection_id is not null
  group by e.connection_id, e.type_id;
$$;

revoke execute on function public.count_activity_events(uuid, uuid[], text[], timestamptz, timestamptz) from public, anon;
grant execute on function public.count_activity_events(uuid, uuid[], text[], timestamptz, timestamptz) to authenticated;
