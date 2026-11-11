-- usage_snapshot_monthly_latest (20261112095000_usage_snapshot_monthly_latest.sql, #317) finds each
-- month's latest row without sorting whole rows. Same arguments, rules, privileges, and result.
--
-- distinct on sorted every row of the window with all its columns: over 39,480 rows (105 account
-- and metric pairs, every day of 13 months) the sort spilled to disk and one call took 78 ms. A
-- hash aggregate of the narrow key now finds the latest snapshot_date of each account, metric,
-- UTC month, currency, and unit, and each row is then read through the unique key
-- (external_account_id, metric_key, snapshot_date): 17 ms on the same rows, measured with
-- explain (analyze, buffers) and quoted on #317. The limit 1 inside the lateral subquery changes
-- no result, since the key is unique; it stops the planner from turning the lookups into a hash
-- join that reads every snapshot of every workspace.

create or replace function public.usage_snapshot_monthly_latest(p_workspace_id uuid, p_since date)
  returns setof public.usage_snapshots
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
    select s.*
    from (
      select u.external_account_id, u.metric_key, max(u.snapshot_date) as snapshot_date
      from public.usage_snapshots u
      where u.workspace_id = p_workspace_id
        and u.snapshot_date >= p_since
      group by u.external_account_id, u.metric_key, date_trunc('month', u.snapshot_date::timestamp), u.currency, u.unit
    ) latest
    cross join lateral (
      select r.*
      from public.usage_snapshots r
      where r.external_account_id = latest.external_account_id
        and r.metric_key = latest.metric_key
        and r.snapshot_date = latest.snapshot_date
      limit 1
    ) s;
end;
$$;
