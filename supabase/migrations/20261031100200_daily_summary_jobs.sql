-- Daily summary jobs (#64), and removal of the unused `daily_snapshot_rollover` job kind.

-- ── Drop sync_job_kind 'daily_snapshot_rollover' ─────────────────────────────────
-- Nothing produces it: snapshots already upsert one row per account, metric, and UTC day on every
-- sync, so there is no rollover step. Postgres cannot drop an enum value, so the type is rebuilt.
-- The index predicate and check constraint that compare `kind` with a literal are dropped first
-- and recreated against the new type, because they were parsed against the old one.

delete from public.sync_jobs where kind::text = 'daily_snapshot_rollover';

drop index public.sync_jobs_one_open_sync_per_connection;
alter table public.sync_jobs drop constraint sync_jobs_sync_has_connection;

alter type public.sync_job_kind rename to sync_job_kind_old;
create type public.sync_job_kind as enum ('sync', 'daily_summary', 'retention');
alter table public.sync_jobs
  alter column kind type public.sync_job_kind using kind::text::public.sync_job_kind;
drop type public.sync_job_kind_old;

alter table public.sync_jobs
  add constraint sync_jobs_sync_has_connection check (kind <> 'sync' or connection_id is not null);

-- See 20261031100000_sync_engine.sql: one open sync per connection, which also serializes token
-- refreshes so a rotating refresh token is never used twice.
create unique index sync_jobs_one_open_sync_per_connection
  on public.sync_jobs (connection_id)
  where kind = 'sync' and status in ('queued', 'running');

-- ── enqueue_daily_summaries ─────────────────────────────────────────────────────
-- One daily_summary job per workspace that has at least one connection that is not revoked,
-- keyed `daily_summary:<workspace_id>:<summarized date>`, so every tick of the day may call it and
-- each workspace still gets one job. Returns how many were queued.

create function public.enqueue_daily_summaries(p_date date)
  returns int
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_inserted int;
begin
  if p_date is null then
    raise exception 'p_date is required' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.sync_jobs (workspace_id, kind, dedupe_key)
  select w.workspace_id, 'daily_summary', 'daily_summary:' || w.workspace_id || ':' || to_char(p_date, 'YYYY-MM-DD')
  from (
    select distinct c.workspace_id from public.connections c where c.status <> 'revoked'
  ) w
  on conflict (dedupe_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke execute on function public.enqueue_daily_summaries(date) from public, anon, authenticated;
grant execute on function public.enqueue_daily_summaries(date) to service_role;
