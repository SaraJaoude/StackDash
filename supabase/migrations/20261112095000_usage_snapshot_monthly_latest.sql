-- The dashboard's monthly trend (#317): each account's latest snapshot per metric, currency or
-- unit, and UTC month, from p_since onward, so the trend's read is bounded by months, not by
-- snapshots.
--
-- * The monthly trend keeps one row per account and month (the latest of the month: the sum and
--   the expected accounts in buildTrends, src/lib/dashboard/trends.ts, read nothing else), so
--   every other row of the month changes nothing it shows. Reading every daily row instead hit the
--   10,000 row cap of the snapshot read after about 10,000 / (accounts times metrics) days, newest
--   first, and the oldest months showed as unavailable with only a log line to say why.
-- * Currency and unit are part of the key because the trend never mixes them in a series: a metric
--   whose currency changed within a month keeps its latest row in each currency, as before.
-- * The month is the UTC calendar month of snapshot_date. The date is cast to timestamp so
--   date_trunc never consults the session time zone.
-- * The unique key (external_account_id, metric_key, snapshot_date) makes the latest row of a
--   month the one with the greatest snapshot_date, so the order is total.
-- * security definer with one membership check up front, as activity_event_counts
--   (20261105120600_activity_event_counts.sql) does and for the same reason: a non-member reads
--   nothing, and the usage_snapshots select policy does not run has_workspace_role once per
--   scanned row. The workspace filter keeps the read on usage_snapshots_workspace_date_idx. Rows
--   come back whole (setof usage_snapshots), so the Data API selects columns as on the table.
-- * Measured with explain (analyze, buffers) as a member, quoted on #317.

create function public.usage_snapshot_monthly_latest(p_workspace_id uuid, p_since date)
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
    select distinct on (s.external_account_id, s.metric_key, date_trunc('month', s.snapshot_date::timestamp), s.currency, s.unit) s.*
    from public.usage_snapshots s
    where s.workspace_id = p_workspace_id
      and s.snapshot_date >= p_since
    order by s.external_account_id, s.metric_key, date_trunc('month', s.snapshot_date::timestamp), s.currency, s.unit,
      s.snapshot_date desc;
end;
$$;

-- Supabase's default privileges grant execute on every new public function to anon,
-- authenticated, and service_role, so all three are revoked before authenticated gets it back. The
-- service key has no auth.uid() and would read nothing anyway; no job reads the trend.
revoke execute on function public.usage_snapshot_monthly_latest(uuid, date) from public, anon, authenticated, service_role;
grant execute on function public.usage_snapshot_monthly_latest(uuid, date) to authenticated;
