-- The headline strip's first readings in one call (#346). getHeadlineEvents
-- (src/lib/data/headline.ts) read each connection's oldest snapshot on or before the current
-- window's first day with one Data API request per connection in view: ten connections, ten
-- requests. headline_first_readings returns the same date for every connection in one call.
--
-- * Same answer per connection as the request it replaces: the oldest snapshot_date on or before
--   p_on_or_before among the rows of that connection and of its accounts that were passed in. A
--   connection with no such row returns no row. Connections come from the accounts passed in, so a
--   connection with no account in view is not read, as before.
-- * Starts each connection at its own oldest row. The per connection requests read
--   usage_snapshots_workspace_date_idx from the workspace's oldest day until they met a row of
--   their connection, so a connection added months after the others scanned the others' history
--   first: 6.4 ms and 27,236 buffers for the newest of ten connections over 46,200 synthetic rows.
--   Run in one statement those scans add up (43 ms). The connection_id index becomes
--   (connection_id, snapshot_date), so each connection starts at its own oldest row: 0.14 ms for
--   all ten. It still serves the foreign key to connections, whose leading column it keeps, so the
--   table keeps the same number of indexes. Measured with explain (analyze, buffers), quoted on
--   #346.
-- * What a connection reads: external_account_id is not a column of the index, so the accounts
--   passed in are a filter on the scan. When the connection's oldest row belongs to an account in
--   view, that is one index probe. Otherwise the scan first reads and discards the connection's
--   rows that are older than its first reading in view: a connection with a year of one account's
--   history, read for a second account that joined it six weeks ago, reads 6,474 buffers (6,461
--   rows filtered, 0.8 ms). That is bounded by one connection's history, where the request it
--   replaces was bounded by the workspace's.
-- * security definer with one membership check up front, as headline_event_counts
--   (20261112093000_headline_event_counts.sql): a non-member reads nothing.
--   20261112100902_headline_first_readings_connection_probe.sql drops the s.workspace_id
--   predicate below, which let the planner go back to the workspace index, and says why every row
--   read stays inside p_workspace_id without it.

create index usage_snapshots_connection_date_idx on public.usage_snapshots (connection_id, snapshot_date);
drop index public.usage_snapshots_connection_id_idx;

create function public.headline_first_readings(p_workspace_id uuid, p_account_ids uuid[], p_on_or_before date)
returns table (connection_id uuid, snapshot_date date)
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
    select c.connection_id, f.snapshot_date
    from (
      select a.connection_id, array_agg(a.id) as account_ids
      from public.external_accounts a
      where a.workspace_id = p_workspace_id
        and a.id = any (p_account_ids)
      group by a.connection_id
    ) c
    cross join lateral (
      select s.snapshot_date
      from public.usage_snapshots s
      where s.connection_id = c.connection_id
        and s.workspace_id = p_workspace_id
        and s.external_account_id = any (c.account_ids)
        and s.snapshot_date <= p_on_or_before
      order by s.snapshot_date
      limit 1
    ) f;
end;
$$;

-- Supabase's default privileges grant execute on every new public function to anon, authenticated,
-- and service_role, so all three are revoked before authenticated gets it back.
revoke execute on function public.headline_first_readings(uuid, uuid[], date)
  from public, anon, authenticated, service_role;
grant execute on function public.headline_first_readings(uuid, uuid[], date) to authenticated;
