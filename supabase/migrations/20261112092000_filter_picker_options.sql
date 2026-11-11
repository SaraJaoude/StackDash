-- Filter picker options (#319): the timeline's event type filter, the alert rule form's allowance
-- and currency pickers, and the anomaly mute picker each worked out their choices from the newest
-- 1,000 raw rows (PostgREST's row cap), so a value seen only before those rows was never offered:
-- on the demo data that is anything older than about 4 days of events or 10 days of snapshots.
-- These functions read every value the workspace holds, in work bounded by the number of distinct
-- values rather than by rows.
--
-- Security definer with one membership check up front, like activity_event_counts: a non-member
-- gets no rows, and no row level security policy runs per row (#283). Every row read is still
-- scoped to p_workspace_id.

-- ── Timeline event types ────────────────────────────────────────────────────────
-- From the activity_event_daily_counts rollup (#201), which holds one row per day, type, provider,
-- and account rather than one per event, and is never out of step with activity_events. Empty
-- exactly when the workspace has no events.

create function public.timeline_type_ids(p_workspace_id uuid)
returns table (type_id text)
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
    select distinct c.type_id
    from public.activity_event_daily_counts c
    where c.workspace_id = p_workspace_id;
end;
$$;

revoke execute on function public.timeline_type_ids(uuid) from public, anon, authenticated, service_role;
grant execute on function public.timeline_type_ids(uuid) to authenticated;

-- ── Snapshot series ─────────────────────────────────────────────────────────────
-- The newest row of every series (external account and metric) of a workspace. A loose index scan
-- of usage_snapshots_account_metric_date_key (external_account_id, metric_key, snapshot_date): per
-- account of the workspace, each step finds the next metric key with one index probe, and the
-- newest row of each series is one backward probe. Work grows with accounts and series, not with
-- days of history. Internal: only the security definer functions below call it, as the owner.
--
-- The accounts are the workspace's, and usage_snapshots_external_account_fkey ties every snapshot
-- to its account's workspace, so the probes need no workspace_id predicate. Leaving it out matters:
-- a SQL function's statements run with generic plans, and with it the planner reads every row of a
-- series through a bitmap scan to sort them (10,006 buffers for the demo workspace's 105 series)
-- instead of one backward index probe each (827 buffers).

create function public.usage_snapshot_series_heads(p_workspace_id uuid)
returns setof public.usage_snapshots
language sql
stable
set search_path = ''
as $$
  with recursive series as (
    select a.id as account_id,
      (select min(s.metric_key) from public.usage_snapshots s where s.external_account_id = a.id) as metric_key
    from public.external_accounts a
    where a.workspace_id = p_workspace_id
    union all
    select r.account_id,
      (select min(s.metric_key) from public.usage_snapshots s
       where s.external_account_id = r.account_id and s.metric_key > r.metric_key)
    from series r
    where r.metric_key is not null
  )
  select h.*
  from series r
  cross join lateral (
    select s.*
    from public.usage_snapshots s
    where s.external_account_id = r.account_id
      and s.metric_key = r.metric_key
    order by s.snapshot_date desc
    limit 1
  ) h
  where r.metric_key is not null;
$$;

revoke execute on function public.usage_snapshot_series_heads(uuid) from public, anon, authenticated, service_role;

-- ── Allowance picker ────────────────────────────────────────────────────────────
-- One row per metric key among the series whose newest row is one of p_kinds: the label of the
-- newest of those rows, and every connection reporting the metric.

create function public.snapshot_metric_options(p_workspace_id uuid, p_kinds public.metric_kind[])
returns table (metric_key text, label text, connection_ids uuid[])
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
    select h.metric_key,
      (array_agg(h.label order by h.snapshot_date desc, h.id))[1],
      array_agg(distinct h.connection_id order by h.connection_id)
    from public.usage_snapshot_series_heads(p_workspace_id) h
    where h.kind = any (p_kinds)
    group by h.metric_key;
end;
$$;

revoke execute on function public.snapshot_metric_options(uuid, public.metric_kind[]) from public, anon, authenticated, service_role;
grant execute on function public.snapshot_metric_options(uuid, public.metric_kind[]) to authenticated;

-- ── Currency picker ─────────────────────────────────────────────────────────────
-- The currencies of every series' newest row: what the workspace reports money in.

create function public.snapshot_currencies(p_workspace_id uuid)
returns table (currency text)
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
    select distinct h.currency::text
    from public.usage_snapshot_series_heads(p_workspace_id) h
    where h.currency is not null;
end;
$$;

revoke execute on function public.snapshot_currencies(uuid) from public, anon, authenticated, service_role;
grant execute on function public.snapshot_currencies(uuid) to authenticated;

-- ── Anomaly mute picker ─────────────────────────────────────────────────────────
-- Which metrics anomaly detection checks is decided per snapshot date over all of an account's
-- rows of that date (checkedRows in src/lib/alerts/anomaly.ts drops a breakdown beside its total
-- and a day inside its month), so the newest row of a series alone cannot say. This returns every
-- row of p_kinds an account has on each date that is the newest date of one of its series of
-- p_kinds: each series' newest date with the rows checkedRows weighs it against. In practice most
-- series report on the same day, so the rows are about one per series. The provider comes from the
-- connection, inside this one membership check.

create function public.snapshot_series_day_rows(p_workspace_id uuid, p_kinds public.metric_kind[])
returns table (
  id uuid,
  provider public.provider_id,
  connection_id uuid,
  external_account_id uuid,
  metric_key text,
  kind public.metric_kind,
  label text,
  snapshot_date date,
  value double precision,
  unit text,
  amount_minor bigint,
  currency text,
  period_start timestamptz,
  period_end timestamptz,
  point_at timestamptz,
  resets_at timestamptz,
  retrieved_at timestamptz,
  provenance_source text,
  pricing_source text
)
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
    with days as (
      select distinct h.external_account_id as account_id, h.snapshot_date as day
      from public.usage_snapshot_series_heads(p_workspace_id) h
      where h.kind = any (p_kinds)
    )
    select s.id, c.provider, s.connection_id, s.external_account_id, s.metric_key, s.kind, s.label, s.snapshot_date,
      s.value, s.unit, s.amount_minor, s.currency::text, s.period_start, s.period_end, s.point_at, s.resets_at,
      s.retrieved_at, s.provenance_source, s.pricing_source
    from days d
    join public.usage_snapshots s
      on s.workspace_id = p_workspace_id and s.external_account_id = d.account_id and s.snapshot_date = d.day
    join public.connections c on c.workspace_id = s.workspace_id and c.id = s.connection_id
    where s.kind = any (p_kinds);
end;
$$;

revoke execute on function public.snapshot_series_day_rows(uuid, public.metric_kind[]) from public, anon, authenticated, service_role;
grant execute on function public.snapshot_series_day_rows(uuid, public.metric_kind[]) to authenticated;
