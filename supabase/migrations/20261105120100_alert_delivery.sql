-- Alert delivery (#152 email, #153 Discord, Slack, and webhook channels). Grant model: see
-- 20261031090000_tenancy.sql.
--
-- - notification_preferences: one row per member per workspace, written by the member themself.
--   No row means "immediate" (decision on #152). Recipients are derived from owners and admins at
--   send time, never stored on a rule (#36).
-- - triggered_alerts gains the fields a message needs (provider, project, reset time) and
--   dispatched_at, set once the alert dispatch job has handled the alert. Each alert is sent once,
--   and triggered_alerts is already unique per rule per billing cycle, so each rule sends at most
--   one immediate message per cycle.
-- - notification_destinations: a channel per workspace. The webhook URL (and a generic webhook's
--   signing secret) is AES-256-GCM ciphertext in notification_destination_secrets, service role
--   only, sealed by the app like provider credentials (#35). Deleting a destination deletes it.
-- - notification_deliveries: what has been sent to whom, so a retried job never sends twice.

create type public.email_frequency as enum ('immediate', 'daily', 'weekly', 'off');
create type public.digest_frequency as enum ('off', 'daily', 'weekly');
create type public.destination_kind as enum ('discord', 'slack', 'webhook');
create type public.destination_status as enum ('active', 'needs_attention');

-- ── notification_preferences ────────────────────────────────────────────────────

create table public.notification_preferences (
  workspace_id uuid not null,
  user_id uuid not null,
  email_frequency public.email_frequency not null,
  updated_at timestamptz not null default now(),
  constraint notification_preferences_pkey primary key (workspace_id, user_id),
  -- Leaving the workspace removes the preference with the membership.
  constraint notification_preferences_member_fkey foreign key (workspace_id, user_id)
    references public.workspace_members (workspace_id, user_id) on delete cascade
);

create index notification_preferences_user_id_idx on public.notification_preferences (user_id);

create trigger notification_preferences_set_updated_at before update on public.notification_preferences
  for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
revoke all on table public.notification_preferences from anon, authenticated;

-- A member reads and writes only their own row. Only owners and admins receive alert email, so
-- only they may write one. The key columns are updatable because a PostgREST upsert sets every
-- column it inserts; the with check keeps the row the caller's own, in a workspace they administer.
grant select on table public.notification_preferences to authenticated;
grant insert (workspace_id, user_id, email_frequency) on table public.notification_preferences to authenticated;
grant update (workspace_id, user_id, email_frequency) on table public.notification_preferences to authenticated;

create policy notification_preferences_select on public.notification_preferences for select to authenticated
  using (user_id = (select auth.uid()) and public.has_workspace_role(workspace_id, 'viewer'));
create policy notification_preferences_insert on public.notification_preferences for insert to authenticated
  with check (user_id = (select auth.uid()) and public.has_workspace_role(workspace_id, 'admin'));
create policy notification_preferences_update on public.notification_preferences for update to authenticated
  using (user_id = (select auth.uid()) and public.has_workspace_role(workspace_id, 'admin'))
  with check (user_id = (select auth.uid()) and public.has_workspace_role(workspace_id, 'admin'));

-- ── triggered_alerts: message fields and dispatch state ─────────────────────────
-- Nullable: a workspace or several providers have no single provider or project, a reading may
-- have no reset time, and alerts recorded before this migration have no title (the message falls
-- back to "Alert"). Existing alerts count as dispatched, so deploying this never emails the
-- history; the table holds one row per rule per cycle, so the single update is small.

alter table public.triggered_alerts
  add column title text,
  add column provider public.provider_id,
  add column project_id uuid,
  add column resets_at timestamptz,
  add column dispatched_at timestamptz,
  add constraint triggered_alerts_project_fkey foreign key (workspace_id, project_id)
    references public.projects (workspace_id, id) on delete set null (project_id);

update public.triggered_alerts set dispatched_at = triggered_at where dispatched_at is null;

-- The scheduler's scan for alerts that still need sending (enqueue_alert_dispatches).
create index triggered_alerts_undispatched_idx on public.triggered_alerts (workspace_id) where dispatched_at is null;
create index triggered_alerts_workspace_project_idx on public.triggered_alerts (workspace_id, project_id);

-- ── notification_destinations ───────────────────────────────────────────────────

create table public.notification_destinations (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind public.destination_kind not null,
  name text not null constraint notification_destinations_name_length check (char_length(btrim(name)) between 1 and 80),
  -- The URL's host only, so members can tell destinations apart. The path holds the secret.
  url_host text not null constraint notification_destinations_url_host_length check (char_length(url_host) between 1 and 253),
  -- True: every alert rule. False: only the rules in alert_rule_destinations.
  all_rules boolean not null default true,
  digest public.digest_frequency not null default 'off',
  status public.destination_status not null default 'active',
  consecutive_failures int not null default 0
    constraint notification_destinations_consecutive_failures_nonnegative check (consecutive_failures >= 0),
  last_error_code text,
  last_error_reference text,
  last_delivered_at timestamptz,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_destinations_workspace_id_id_key unique (workspace_id, id)
);

create index notification_destinations_created_by_idx on public.notification_destinations (created_by);
create index notification_destinations_updated_by_idx on public.notification_destinations (updated_by);

create trigger notification_destinations_set_updated_at before update on public.notification_destinations
  for each row execute function public.set_updated_at();
create trigger notification_destinations_set_updated_by before update on public.notification_destinations
  for each row execute function public.set_updated_by();

-- ── notification_destination_secrets (service role only) ────────────────────────
-- Ciphertext of {"v":1,"url":...,"signingSecret"?:...}, associated data `workspaceId:destinationId`.

create table public.notification_destination_secrets (
  destination_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key_id text not null,
  iv bytea not null,
  ciphertext bytea not null,
  auth_tag bytea not null,
  updated_at timestamptz not null default now(),
  constraint notification_destination_secrets_destination_fkey foreign key (workspace_id, destination_id)
    references public.notification_destinations (workspace_id, id) on delete cascade
);

create index notification_destination_secrets_workspace_id_idx on public.notification_destination_secrets (workspace_id);

create trigger notification_destination_secrets_set_updated_at before update on public.notification_destination_secrets
  for each row execute function public.set_updated_at();

-- ── alert_rule_destinations ─────────────────────────────────────────────────────

create table public.alert_rule_destinations (
  workspace_id uuid not null,
  destination_id uuid not null,
  rule_id uuid not null,
  constraint alert_rule_destinations_pkey primary key (destination_id, rule_id),
  constraint alert_rule_destinations_destination_fkey foreign key (workspace_id, destination_id)
    references public.notification_destinations (workspace_id, id) on delete cascade,
  constraint alert_rule_destinations_rule_fkey foreign key (workspace_id, rule_id)
    references public.alert_rules (workspace_id, id) on delete cascade
);

create index alert_rule_destinations_workspace_rule_idx on public.alert_rule_destinations (workspace_id, rule_id);
create index alert_rule_destinations_workspace_destination_idx on public.alert_rule_destinations (workspace_id, destination_id);

-- ── notification_deliveries (service role only) ─────────────────────────────────
-- subject_key: `alert:<triggered alert id>` or `digest:<daily|weekly>:<YYYY-MM-DD>`.
-- target_key: `email:<user id>` or `destination:<destination id>`.
-- Alert rows live as long as their alert; digest rows are purged after 30 days (retention job).

create table public.notification_deliveries (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  subject_key text not null,
  target_key text not null,
  triggered_alert_id uuid references public.triggered_alerts (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  destination_id uuid,
  delivered_at timestamptz not null default now(),
  constraint notification_deliveries_workspace_subject_target_key unique (workspace_id, subject_key, target_key),
  constraint notification_deliveries_destination_fkey foreign key (workspace_id, destination_id)
    references public.notification_destinations (workspace_id, id) on delete cascade,
  constraint notification_deliveries_one_target check ((user_id is null) <> (destination_id is null))
);

create index notification_deliveries_triggered_alert_id_idx on public.notification_deliveries (triggered_alert_id);
create index notification_deliveries_user_id_idx on public.notification_deliveries (user_id);
create index notification_deliveries_workspace_destination_idx on public.notification_deliveries (workspace_id, destination_id);
-- Retention deletes digest rows older than 30 days.
create index notification_deliveries_digest_delivered_at_idx on public.notification_deliveries (delivered_at)
  where triggered_alert_id is null;

-- ── Row level security and grants ───────────────────────────────────────────────

alter table public.notification_destinations enable row level security;
alter table public.notification_destination_secrets enable row level security;
alter table public.alert_rule_destinations enable row level security;
alter table public.notification_deliveries enable row level security;

revoke all on table
  public.notification_destinations, public.notification_destination_secrets,
  public.alert_rule_destinations, public.notification_deliveries
from anon, authenticated;

-- notification_destination_secrets and notification_deliveries: RLS on, no policies, no grants.

-- Destinations are created by the server (create_notification_destination), because the row and
-- its sealed URL must be written together. Admins rename, choose what it receives, and delete.
-- Status and errors stay server-written.
grant select, delete on table public.notification_destinations to authenticated;
grant update (name, all_rules, digest) on table public.notification_destinations to authenticated;

create policy notification_destinations_select on public.notification_destinations for select to authenticated
  using (public.has_workspace_role(workspace_id, 'viewer'));
create policy notification_destinations_update on public.notification_destinations for update to authenticated
  using (public.has_workspace_role(workspace_id, 'admin'))
  with check (public.has_workspace_role(workspace_id, 'admin'));
create policy notification_destinations_delete on public.notification_destinations for delete to authenticated
  using (public.has_workspace_role(workspace_id, 'admin'));

grant select, delete on table public.alert_rule_destinations to authenticated;
grant insert (workspace_id, destination_id, rule_id) on table public.alert_rule_destinations to authenticated;

create policy alert_rule_destinations_select on public.alert_rule_destinations for select to authenticated
  using (public.has_workspace_role(workspace_id, 'viewer'));
create policy alert_rule_destinations_insert on public.alert_rule_destinations for insert to authenticated
  with check (public.has_workspace_role(workspace_id, 'admin'));
create policy alert_rule_destinations_delete on public.alert_rule_destinations for delete to authenticated
  using (public.has_workspace_role(workspace_id, 'admin'));

-- ── create_notification_destination ─────────────────────────────────────────────
-- Writes the destination, its sealed URL, and its rule links in one transaction. Service role only:
-- the caller has authorized the user as an admin of the workspace. The id comes from the app because
-- the ciphertext's associated data names it. Rule ids from another workspace fail the foreign key.

create function public.create_notification_destination(
  p_id uuid,
  p_workspace_id uuid,
  p_kind public.destination_kind,
  p_name text,
  p_url_host text,
  p_all_rules boolean,
  p_digest public.digest_frequency,
  p_rule_ids uuid[],
  p_key_id text,
  p_iv bytea,
  p_ciphertext bytea,
  p_auth_tag bytea,
  p_created_by uuid
)
  returns void
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
begin
  insert into public.notification_destinations (id, workspace_id, kind, name, url_host, all_rules, digest, created_by, updated_by)
  values (p_id, p_workspace_id, p_kind, p_name, p_url_host, p_all_rules, p_digest, p_created_by, p_created_by);

  insert into public.notification_destination_secrets (destination_id, workspace_id, key_id, iv, ciphertext, auth_tag)
  values (p_id, p_workspace_id, p_key_id, p_iv, p_ciphertext, p_auth_tag);

  insert into public.alert_rule_destinations (workspace_id, destination_id, rule_id)
  select p_workspace_id, p_id, rule_id from unnest(coalesce(p_rule_ids, '{}'::uuid[])) as rule_id
  on conflict do nothing;
end;
$$;

revoke execute on function public.create_notification_destination(
  uuid, uuid, public.destination_kind, text, text, boolean, public.digest_frequency, uuid[], text, bytea, bytea, bytea, uuid
) from public, anon, authenticated;
grant execute on function public.create_notification_destination(
  uuid, uuid, public.destination_kind, text, text, boolean, public.digest_frequency, uuid[], text, bytea, bytea, bytea, uuid
) to service_role;

-- ── notification_recipients ─────────────────────────────────────────────────────
-- Owners and admins with an email address, and their email preference ("immediate" when they never
-- chose). Service role only: it reads auth.users.

create function public.notification_recipients(p_workspace_id uuid)
  returns table (user_id uuid, email text, email_frequency public.email_frequency)
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select m.user_id, u.email::text, coalesce(p.email_frequency, 'immediate'::public.email_frequency)
  from public.workspace_members m
  join auth.users u on u.id = m.user_id
  left join public.notification_preferences p on p.workspace_id = m.workspace_id and p.user_id = m.user_id
  where m.workspace_id = p_workspace_id
    and m.role in ('owner', 'admin')
    and u.email is not null
    and u.email <> ''
  order by m.user_id
  limit 100;
$$;

revoke execute on function public.notification_recipients(uuid) from public, anon, authenticated;
grant execute on function public.notification_recipients(uuid) to service_role;

-- ── Job scheduling ──────────────────────────────────────────────────────────────
-- One open (queued or running) alert_dispatch job per workspace, like
-- sync_jobs_one_open_sync_per_connection. A running dispatch has read its alerts but records them
-- only as it sends, so a second dispatch claimed beside it would send the same alerts again. An
-- alert that fires while a dispatch runs keeps dispatched_at null and is queued by the first tick
-- after that dispatch finishes.

create unique index sync_jobs_one_open_alert_dispatch_per_workspace
  on public.sync_jobs (workspace_id)
  where kind = 'alert_dispatch' and status in ('queued', 'running');

-- Every tick: a dispatch for each workspace with an alert not yet dispatched. The scan is the
-- partial index triggered_alerts_undispatched_idx, empty when nothing is waiting.
create function public.enqueue_alert_dispatches()
  returns int
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_inserted int;
begin
  insert into public.sync_jobs (workspace_id, kind)
  select distinct a.workspace_id, 'alert_dispatch'::public.sync_job_kind
  from public.triggered_alerts a
  where a.dispatched_at is null
  on conflict (workspace_id) where kind = 'alert_dispatch' and status in ('queued', 'running') do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke execute on function public.enqueue_alert_dispatches() from public, anon, authenticated;
grant execute on function public.enqueue_alert_dispatches() to service_role;

-- Once per UTC day per workspace with a connection that is not revoked, for the previous day,
-- keyed `digest:<workspace_id>:<date>` like the daily summary. The job decides who wants it.
create function public.enqueue_digests(p_date date)
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
  select w.workspace_id, 'digest', 'digest:' || w.workspace_id || ':' || to_char(p_date, 'YYYY-MM-DD')
  from (
    select distinct c.workspace_id from public.connections c where c.status <> 'revoked'
  ) w
  on conflict (dedupe_key) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

revoke execute on function public.enqueue_digests(date) from public, anon, authenticated;
grant execute on function public.enqueue_digests(date) to service_role;

-- ── purge_notification_deliveries ───────────────────────────────────────────────
-- Digest delivery rows only (triggered_alert_id null); alert rows go with their alert.

create function public.purge_notification_deliveries(p_before timestamptz, p_limit int)
  returns int
  language plpgsql
  volatile
  security definer
  set search_path = ''
as $$
declare
  v_deleted int;
begin
  if p_before is null or p_limit is null or p_limit < 1 or p_limit > 10000 then
    raise exception 'p_before is required and p_limit must be between 1 and 10000' using errcode = 'invalid_parameter_value';
  end if;

  with doomed as (
    select d.id from public.notification_deliveries d
    where d.triggered_alert_id is null and d.delivered_at < p_before
    order by d.id
    limit p_limit
    for update skip locked
  )
  delete from public.notification_deliveries d using doomed where d.id = doomed.id;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_notification_deliveries(timestamptz, int) from public, anon, authenticated;
grant execute on function public.purge_notification_deliveries(timestamptz, int) to service_role;
