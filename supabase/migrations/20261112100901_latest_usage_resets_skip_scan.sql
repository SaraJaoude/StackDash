-- latest_usage_resets (20261031100000_sync_engine.sql) reads one row per metric of the account
-- instead of every row of its history (#346). Same arguments, result, and privileges; no later
-- migration redefined it.
--
-- * distinct on (metric_key) ... order by metric_key, snapshot_date desc read every snapshot of the
--   account and sorted them, on every sync of every account, so the read grew with history (up to
--   the 13 months retention keeps). Over 7,320 rows (20 metrics, 366 days) the planner chose a
--   sequential scan of the table: 6.3 ms and 1,712 buffers for the query, 5.2 to 5.5 ms a call
--   over five calls (3.5 to 4.0 ms and 380 to 517 buffers a call in two later sessions).
-- * Now a loose index scan on the unique key (external_account_id, metric_key, snapshot_date): a
--   recursive step finds the next metric key with one index probe (the first key above the last
--   one), and each key's newest row is one backward probe. Reads are two probes per metric,
--   whatever the history: 0.32 ms and 172 buffers for the query on the same rows, 0.24 to 0.42 ms
--   and 171 to 173 buffers a call. Measured with explain (analyze, buffers), quoted on #346.
-- * The workspace is checked once against the account (the external_accounts primary key) instead
--   of on every row. Every snapshot of an account belongs to the account's workspace: the foreign
--   key (workspace_id, external_account_id) references external_accounts (workspace_id, id), and the
--   account id is unique. An account of another workspace reads nothing, as before, without
--   scanning its history.

create or replace function public.latest_usage_resets(p_workspace_id uuid, p_external_account_id uuid)
  returns table (metric_key text, resets_at timestamptz)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  with recursive metric_keys (metric_key) as (
    (
      select s.metric_key
      from public.usage_snapshots s
      where s.external_account_id = p_external_account_id
        and exists (
          select 1 from public.external_accounts a
          where a.workspace_id = p_workspace_id and a.id = p_external_account_id
        )
      order by s.metric_key
      limit 1
    )
    union all
    select (
      select s.metric_key
      from public.usage_snapshots s
      where s.external_account_id = p_external_account_id and s.metric_key > k.metric_key
      order by s.metric_key
      limit 1
    )
    from metric_keys k
    where k.metric_key is not null
  )
  select k.metric_key, latest.resets_at
  from metric_keys k
  cross join lateral (
    select s.resets_at
    from public.usage_snapshots s
    where s.external_account_id = p_external_account_id and s.metric_key = k.metric_key
    order by s.snapshot_date desc
    limit 1
  ) latest
  where k.metric_key is not null
$$;
