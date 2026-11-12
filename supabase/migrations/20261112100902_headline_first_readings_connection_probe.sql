-- headline_first_readings (20261112100900_headline_first_readings.sql) reads each connection's
-- first reading on usage_snapshots_connection_date_idx whatever the table's statistics say (#346).
-- Same arguments, result, and privileges.
--
-- * The lateral no longer filters on s.workspace_id. With it, the planner knows the workspace but
--   not the connection, a join variable, so when the statistics understate the workspace's share
--   of the table (a workspace that connected or grew since the last autoanalyze, which waits for
--   10% of the table to change) it prices usage_snapshots_workspace_date_idx as the shorter scan
--   and runs one scan of the workspace's history per connection, one after another. On 46,200
--   synthetic rows across ten connections, statistics not refreshed: 18.0 to 26.8 ms and 99,432
--   buffers a call with the predicate, 0.15 to 0.30 ms and 38 buffers without it. After analyze
--   both use the connection index (0.14 to 0.51 ms, 42 to 310 buffers with it; 0.07 to 0.25 ms,
--   38 buffers without). Measured with explain (analyze, buffers), quoted on #346.
-- * Dropping it leaves every row read inside p_workspace_id. c.account_ids only holds accounts
--   with a.workspace_id = p_workspace_id, and usage_snapshots_external_account_fkey
--   (20261031090200_metrics_events_alerts.sql) ties every snapshot of an account to that
--   account's workspace. usage_snapshot_series_heads (20261112092000_filter_picker_options.sql)
--   and latest_usage_resets (20261112100901_latest_usage_resets_skip_scan.sql) rely on the same
--   key.

create or replace function public.headline_first_readings(p_workspace_id uuid, p_account_ids uuid[], p_on_or_before date)
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
        and s.external_account_id = any (c.account_ids)
        and s.snapshot_date <= p_on_or_before
      order by s.snapshot_date
      limit 1
    ) f;
end;
$$;
