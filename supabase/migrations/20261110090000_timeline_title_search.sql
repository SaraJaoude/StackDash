-- Title search on the timeline (issue #253): the provider badges count only the events whose title
-- matches the search, as the event list does. timeline_connection_event_counts
-- (20261107090000_timeline_connection_event_counts.sql) gains p_title_pattern, a case-insensitive
-- regular expression the app builds with titleSearchPattern (src/lib/timeline/query.ts), which
-- escapes every metacharacter so the search matches literally. The event list sends the same
-- pattern to PostgREST's imatch (~*), so a badge counts exactly what the list shows. Null means no
-- search. Everything else is unchanged from the previous definition.
--
-- A new parameter changes the signature, so the old function is dropped rather than overloaded:
-- an overload would make a call without p_title_pattern ambiguous. Callers that omit it get the
-- default, so code that does not search keeps working.
--
-- Cost: no index serves a substring match, so a search is one more predicate on the rows the
-- other filters already read. On the local stack's largest workspace (23,426 events, explain
-- analyze as a member) the unfiltered call takes 5.4 ms, with a search matching nothing 7.0 ms,
-- and with a search matching 9,132 events 7.6 ms.
drop function public.timeline_connection_event_counts(uuid, text[], text[], public.event_severity[], public.provider_id[], uuid[], timestamptz, timestamptz);

create function public.timeline_connection_event_counts(
  p_workspace_id uuid,
  p_type_ids text[] default '{}',
  p_hidden_type_ids text[] default '{}',
  p_severities public.event_severity[] default '{}',
  p_providers public.provider_id[] default '{}',
  p_account_ids uuid[] default null,
  p_from timestamptz default null,
  p_until timestamptz default null,
  p_title_pattern text default null
)
returns table (connection_id uuid, provider public.provider_id, display_name text, events bigint)
language plpgsql
stable
security definer
set search_path = ''
set plan_cache_mode = force_custom_plan
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
      and (p_title_pattern is null or e.title ~* p_title_pattern)
    group by c.id, c.provider, c.display_name;
end;
$$;

-- As before: Supabase's default privileges grant execute on every new public function to anon,
-- authenticated, and service_role, so all three are revoked before authenticated gets it back.
revoke execute on function public.timeline_connection_event_counts(uuid, text[], text[], public.event_severity[], public.provider_id[], uuid[], timestamptz, timestamptz, text)
  from public, anon, authenticated, service_role;
grant execute on function public.timeline_connection_event_counts(uuid, text[], text[], public.event_severity[], public.provider_id[], uuid[], timestamptz, timestamptz, text)
  to authenticated;
