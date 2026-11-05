-- Integrations (#27, #33, #35): projects, provider connections, encrypted credentials, OAuth
-- state, and the provider accounts a connection can see. Grant model: see 20261031090000_tenancy.sql.
--
-- References between tenant rows are composite (workspace_id, x_id) foreign keys, so the database
-- refuses a row that points at another workspace's project or connection even if a caller learns
-- its UUID. Each referenced table carries a (workspace_id, id) unique key for that purpose.

create type public.provider_id as enum ('vercel', 'github', 'resend', 'stripe', 'supabase', 'fake');
create type public.connection_status as enum ('pending', 'active', 'needs_attention', 'revoked', 'failed');

-- ── projects ────────────────────────────────────────────────────────────────────

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null constraint projects_name_length check (char_length(btrim(name)) between 1 and 80),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_workspace_id_id_key unique (workspace_id, id)
);

create unique index projects_workspace_name_key on public.projects (workspace_id, lower(name));
create index projects_created_by_idx on public.projects (created_by);
create index projects_updated_by_idx on public.projects (updated_by);

create trigger projects_set_updated_at before update on public.projects
  for each row execute function public.set_updated_at();
create trigger projects_set_updated_by before update on public.projects
  for each row execute function public.set_updated_by();

-- ── connections ─────────────────────────────────────────────────────────────────

create table public.connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.provider_id not null,
  status public.connection_status not null default 'pending',
  display_name text not null constraint connections_display_name_not_blank check (btrim(display_name) <> ''),
  -- The provider account or organization that granted access, as the provider names it.
  authorized_account_label text,
  external_installation_id text,
  granted_scopes text[] not null default '{}',
  missing_scopes text[] not null default '{}',
  poll_interval_seconds int not null constraint connections_poll_interval_min check (poll_interval_seconds >= 60),
  next_sync_at timestamptz,
  last_synced_at timestamptz,
  -- Manual "sync now" cooldown.
  last_sync_requested_at timestamptz,
  consecutive_failures int not null default 0 constraint connections_consecutive_failures_nonnegative check (consecutive_failures >= 0),
  last_error_code text,
  last_error_reference text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint connections_workspace_id_id_key unique (workspace_id, id)
);

-- The scheduler's due-connection scan: status = 'active' and next_sync_at <= now().
create index connections_status_next_sync_at_idx on public.connections (status, next_sync_at);
create index connections_workspace_provider_idx on public.connections (workspace_id, provider);
create index connections_created_by_idx on public.connections (created_by);
create index connections_updated_by_idx on public.connections (updated_by);

create trigger connections_set_updated_at before update on public.connections
  for each row execute function public.set_updated_at();
create trigger connections_set_updated_by before update on public.connections
  for each row execute function public.set_updated_by();

-- ── connection_credentials (service role only) ──────────────────────────────────
-- AES-256-GCM ciphertext written by the app (#35). The plaintext and key never reach the database.

create table public.connection_credentials (
  connection_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  key_id text not null,
  iv bytea not null,
  ciphertext bytea not null,
  auth_tag bytea not null,
  access_expires_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint connection_credentials_connection_fkey foreign key (workspace_id, connection_id)
    references public.connections (workspace_id, id) on delete cascade
);

create index connection_credentials_workspace_id_idx on public.connection_credentials (workspace_id);

create trigger connection_credentials_set_updated_at before update on public.connection_credentials
  for each row execute function public.set_updated_at();

-- ── oauth_states (service role only) ────────────────────────────────────────────
-- One row per in-flight provider OAuth flow; deleted when the callback consumes it.

create table public.oauth_states (
  state text primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  provider public.provider_id not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  code_verifier_iv bytea,
  code_verifier_ciphertext bytea,
  code_verifier_tag bytea,
  key_id text,
  -- Validated against an allow list by the app before it is stored; kept relative here too.
  redirect_after text not null constraint oauth_states_redirect_after_relative
    check (redirect_after like '/%' and redirect_after not like '//%' and redirect_after not like '/\\%'),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  -- The PKCE verifier is either fully stored or absent (providers without PKCE).
  constraint oauth_states_code_verifier_complete check (
    (code_verifier_iv is null and code_verifier_ciphertext is null and code_verifier_tag is null and key_id is null)
    or (code_verifier_iv is not null and code_verifier_ciphertext is not null and code_verifier_tag is not null and key_id is not null)
  )
);

create index oauth_states_workspace_id_idx on public.oauth_states (workspace_id);
create index oauth_states_user_id_idx on public.oauth_states (user_id);
create index oauth_states_expires_at_idx on public.oauth_states (expires_at);

-- ── external_accounts ───────────────────────────────────────────────────────────

create table public.external_accounts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  connection_id uuid not null,
  external_id text not null,
  display_name text not null,
  -- Provider vocabulary, for example team, organization, user, account, project, repository.
  kind text not null,
  project_id uuid,
  included boolean not null default true,
  sync_cursor text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint external_accounts_connection_external_id_key unique (connection_id, external_id),
  constraint external_accounts_workspace_id_id_key unique (workspace_id, id),
  constraint external_accounts_connection_fkey foreign key (workspace_id, connection_id)
    references public.connections (workspace_id, id) on delete cascade,
  -- Column list: deleting a project clears only project_id, never workspace_id.
  constraint external_accounts_project_fkey foreign key (workspace_id, project_id)
    references public.projects (workspace_id, id) on delete set null (project_id)
);

create index external_accounts_workspace_connection_idx on public.external_accounts (workspace_id, connection_id);
create index external_accounts_workspace_project_idx on public.external_accounts (workspace_id, project_id);

create trigger external_accounts_set_updated_at before update on public.external_accounts
  for each row execute function public.set_updated_at();

-- ── Row level security and grants ───────────────────────────────────────────────

alter table public.projects enable row level security;
alter table public.connections enable row level security;
alter table public.connection_credentials enable row level security;
alter table public.oauth_states enable row level security;
alter table public.external_accounts enable row level security;

revoke all on table
  public.projects, public.connections, public.connection_credentials,
  public.oauth_states, public.external_accounts
from anon, authenticated;

-- connection_credentials and oauth_states: RLS on, no policies, no grants. Service role only.

-- projects: read as viewer, write as admin.
grant select, delete on table public.projects to authenticated;
grant insert (workspace_id, name) on table public.projects to authenticated;
grant update (name) on table public.projects to authenticated;

-- connections: rows are created and synced by the server; admins may rename, request a sync, and
-- disconnect. Status, scopes, errors, and schedule stay server-written.
grant select, delete on table public.connections to authenticated;
grant insert (workspace_id, provider, display_name, poll_interval_seconds) on table public.connections to authenticated;
grant update (display_name, last_sync_requested_at) on table public.connections to authenticated;

-- external_accounts: rows are added only when a connection is made or reconnected
-- (completeConnection); sync reads the included ones and updates only sync_cursor; admins choose
-- which are included and map them to projects.
grant select on table public.external_accounts to authenticated;
grant update (included, project_id) on table public.external_accounts to authenticated;

do $$
declare
  target text;
begin
  foreach target in array array['projects', 'connections', 'external_accounts']
  loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.has_workspace_role(workspace_id, %L))',
      target || '_select', target, 'viewer');
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.has_workspace_role(workspace_id, %L))',
      target || '_insert', target, 'admin');
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.has_workspace_role(workspace_id, %L)) with check (public.has_workspace_role(workspace_id, %L))',
      target || '_update', target, 'admin', 'admin');
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.has_workspace_role(workspace_id, %L))',
      target || '_delete', target, 'admin');
  end loop;
end $$;
