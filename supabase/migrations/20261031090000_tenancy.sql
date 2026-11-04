-- Tenancy (#27, #33, #38, #104): roles, profiles, workspaces, memberships, the one authorization
-- helper every policy calls, the one function that creates workspaces, and the sign-up trigger.
--
-- Grant model used by every migration in this repository:
--   * Supabase's default privileges give anon and authenticated every privilege on new tables and
--     EXECUTE on new functions in public. Each table therefore starts with `revoke all ... from
--     anon, authenticated`, then grants authenticated SELECT plus only the columns the app writes
--     (BackTalk 0074). anon gets nothing: every page needs a signed-in user.
--   * Each function revokes EXECUTE from public, anon, and authenticated, then grants back only
--     what is needed (BackTalk 0074).
--   * Every security definer function pins `search_path = ''` and schema-qualifies every name.
--   * Policies are scoped `to authenticated` and call public.has_workspace_role, which reads the
--     role from workspace_members at query time, so a role change applies on the next request.

-- ── Enums ───────────────────────────────────────────────────────────────────────

create type public.workspace_role as enum ('owner', 'admin', 'viewer');

-- ── Shared trigger functions ────────────────────────────────────────────────────

create function public.set_updated_at()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- A signed-in user cannot claim someone else's edit. Service role writes have no auth.uid(), so
-- they keep whatever updated_by the server passed.
create function public.set_updated_by()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if auth.uid() is not null then
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.set_updated_by() from public, anon, authenticated;

-- ── Role ranking and the authorization helper ───────────────────────────────────

create function public.workspace_role_rank(p_role public.workspace_role)
  returns int
  language sql
  immutable
  set search_path = ''
as $$
  select case p_role
    when 'viewer' then 1
    when 'admin' then 2
    when 'owner' then 3
  end
$$;

revoke execute on function public.workspace_role_rank(public.workspace_role) from public, anon, authenticated;
grant execute on function public.workspace_role_rank(public.workspace_role) to authenticated, service_role;

-- Random, immutable URL identifier (#31). Never derived from the name, so a rename never breaks a
-- link and the slug reveals nothing. 10 base32 characters = 50 random bits; 256 is a multiple of
-- 32, so `byte % 32` is uniform.
create function public.generate_workspace_slug()
  returns text
  language sql
  volatile
  set search_path = ''
as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz234567', (get_byte(r.bytes, i) % 32) + 1, 1), '' order by i)
  from (select extensions.gen_random_bytes(10) as bytes) as r
  cross join generate_series(0, 9) as i
$$;

-- Column defaults run with the inserting role's privileges, so the service role needs EXECUTE to
-- insert a workspace directly (for example in tests); authenticated never inserts workspaces.
revoke execute on function public.generate_workspace_slug() from public, anon, authenticated;
grant execute on function public.generate_workspace_slug() to service_role;

-- ── Tables ──────────────────────────────────────────────────────────────────────

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null default public.generate_workspace_slug()
    constraint workspaces_slug_key unique
    constraint workspaces_slug_format check (slug ~ '^[a-z2-7]{10}$'),
  name text not null constraint workspaces_name_length check (char_length(btrim(name)) between 1 and 80),
  -- Display only. Nothing authorizes on it (#38): a personal workspace is an ordinary workspace.
  is_personal boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index workspaces_created_by_idx on public.workspaces (created_by);
-- At most one personal workspace per creator; also the arbiter that makes create_workspace
-- idempotent under concurrent sign-up.
create unique index workspaces_one_personal_per_creator_key
  on public.workspaces (created_by) where is_personal;

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role public.workspace_role not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_id_idx on public.workspace_members (user_id);

create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  last_workspace_id uuid references public.workspaces (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_last_workspace_id_idx on public.profiles (last_workspace_id);

create trigger workspaces_set_updated_at
  before update on public.workspaces
  for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Defined after workspace_members exists because SQL function bodies are checked at creation.
-- Security definer so policies on workspace_members can call it without recursing into their own
-- RLS. It only ever answers for the caller (auth.uid()), so it leaks nothing about workspaces the
-- caller does not belong to (BackTalk 0075).
create function public.has_workspace_role(p_workspace_id uuid, p_min_role public.workspace_role)
  returns boolean
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members m
    where m.workspace_id = p_workspace_id
      and m.user_id = auth.uid()
      and public.workspace_role_rank(m.role) >= public.workspace_role_rank(p_min_role)
  )
$$;

revoke execute on function public.has_workspace_role(uuid, public.workspace_role) from public, anon, authenticated;
grant execute on function public.has_workspace_role(uuid, public.workspace_role) to authenticated;

-- ── Slug immutability ───────────────────────────────────────────────────────────

create function public.prevent_workspace_slug_change()
  returns trigger
  language plpgsql
  set search_path = ''
as $$
begin
  if new.slug is distinct from old.slug then
    raise exception 'workspaces.slug is immutable'
      using errcode = 'check_violation', hint = 'Workspace URLs must not change; rename the workspace instead.';
  end if;
  return new;
end;
$$;

revoke execute on function public.prevent_workspace_slug_change() from public, anon, authenticated;

create trigger workspaces_slug_immutable
  before update of slug on public.workspaces
  for each row execute function public.prevent_workspace_slug_change();

-- ── Last-owner rule ─────────────────────────────────────────────────────────────
-- Deferred to commit so an ownership transfer (promote B, demote A) can run as two statements, and
-- so deleting a workspace (which cascades to its members) passes: by commit the workspace is gone.
-- Security definer so the check sees every membership row regardless of the caller's RLS.

create function public.enforce_workspace_has_owner()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  if exists (select 1 from public.workspaces w where w.id = old.workspace_id)
     and not exists (
       select 1 from public.workspace_members m
       where m.workspace_id = old.workspace_id and m.role = 'owner'
     )
  then
    raise exception 'workspace % must keep at least one owner', old.workspace_id
      using errcode = 'check_violation', hint = 'Make another member an owner first.';
  end if;
  return null;
end;
$$;

revoke execute on function public.enforce_workspace_has_owner() from public, anon, authenticated;

create constraint trigger workspace_members_keep_owner
  after update or delete on public.workspace_members
  deferrable initially deferred
  for each row execute function public.enforce_workspace_has_owner();

-- ── Workspace creation ──────────────────────────────────────────────────────────
-- The single path for creating a workspace (#38): sign-up now, "create workspace" later (#106).
-- Workspace and owner membership are written in the caller's transaction, so a user is never left
-- without a workspace. Personal workspaces are idempotent per user.

create function public.create_workspace(p_user_id uuid, p_name text, p_is_personal boolean)
  returns public.workspaces
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_workspace public.workspaces;
begin
  -- Not granted to authenticated in the MVP; if it ever is, a caller may only create for itself.
  if auth.uid() is not null and auth.uid() <> p_user_id then
    raise exception 'cannot create a workspace for another user' using errcode = 'insufficient_privilege';
  end if;
  if p_user_id is null or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'user % does not exist', p_user_id using errcode = 'foreign_key_violation';
  end if;

  if coalesce(p_is_personal, false) then
    insert into public.workspaces (name, is_personal, created_by)
    values (btrim(p_name), true, p_user_id)
    on conflict (created_by) where is_personal do nothing
    returning * into v_workspace;

    if v_workspace.id is null then
      select w.* into v_workspace
      from public.workspaces w
      where w.created_by = p_user_id and w.is_personal;
    end if;
  else
    insert into public.workspaces (name, is_personal, created_by)
    values (btrim(p_name), false, p_user_id)
    returning * into v_workspace;
  end if;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (v_workspace.id, p_user_id, 'owner')
  on conflict (workspace_id, user_id) do nothing;

  return v_workspace;
end;
$$;

revoke execute on function public.create_workspace(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.create_workspace(uuid, text, boolean) to service_role;

-- ── Sign-up trigger ─────────────────────────────────────────────────────────────

create function public.handle_auth_user_created()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_workspace public.workspaces;
begin
  insert into public.profiles (user_id, display_name, avatar_url)
  values (
    new.id,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'user_name', new.raw_user_meta_data ->> 'name')), ''),
    nullif(btrim(new.raw_user_meta_data ->> 'avatar_url'), '')
  )
  on conflict (user_id) do nothing;

  v_workspace := public.create_workspace(new.id, 'Personal', true);

  update public.profiles
  set last_workspace_id = v_workspace.id
  where user_id = new.id and last_workspace_id is null;

  return new;
end;
$$;

revoke execute on function public.handle_auth_user_created() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_auth_user_created();

-- Deleting a user cascades to their memberships, which would leave their personal workspace (and
-- any workspace only they belong to) without an owner and fail the last-owner rule. Nobody else can
-- see those workspaces, so they go with the user. A shared workspace where the user is the only
-- owner still blocks the deletion until ownership is transferred.
create function public.handle_auth_user_deleting()
  returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  delete from public.workspaces w
  where exists (
      select 1 from public.workspace_members m
      where m.workspace_id = w.id and m.user_id = old.id
    )
    and not exists (
      select 1 from public.workspace_members m
      where m.workspace_id = w.id and m.user_id <> old.id
    );
  return old;
end;
$$;

revoke execute on function public.handle_auth_user_deleting() from public, anon, authenticated;

create trigger on_auth_user_deleting
  before delete on auth.users
  for each row execute function public.handle_auth_user_deleting();

-- ── Row level security ──────────────────────────────────────────────────────────

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.profiles enable row level security;

revoke all on table public.workspaces, public.workspace_members, public.profiles from anon, authenticated;

-- workspaces: read as any member; rename as admin; delete as owner; insert only via create_workspace.
grant select, delete on table public.workspaces to authenticated;
grant update (name) on table public.workspaces to authenticated;

create policy workspaces_select on public.workspaces for select to authenticated
  using (public.has_workspace_role(id, 'viewer'));
create policy workspaces_update on public.workspaces for update to authenticated
  using (public.has_workspace_role(id, 'admin'))
  with check (public.has_workspace_role(id, 'admin'));
create policy workspaces_delete on public.workspaces for delete to authenticated
  using (public.has_workspace_role(id, 'owner'));

-- workspace_members: owners manage every row; admins manage non-owner rows and can never grant
-- owner. Using clauses guard the existing row, check clauses guard the new one.
grant select, delete on table public.workspace_members to authenticated;
grant insert (workspace_id, user_id, role) on table public.workspace_members to authenticated;
grant update (role) on table public.workspace_members to authenticated;

create policy workspace_members_select on public.workspace_members for select to authenticated
  using (public.has_workspace_role(workspace_id, 'viewer'));
create policy workspace_members_insert on public.workspace_members for insert to authenticated
  with check (
    public.has_workspace_role(workspace_id, 'owner')
    or (public.has_workspace_role(workspace_id, 'admin') and role <> 'owner')
  );
create policy workspace_members_update on public.workspace_members for update to authenticated
  using (
    public.has_workspace_role(workspace_id, 'owner')
    or (public.has_workspace_role(workspace_id, 'admin') and role <> 'owner')
  )
  with check (
    public.has_workspace_role(workspace_id, 'owner')
    or (public.has_workspace_role(workspace_id, 'admin') and role <> 'owner')
  );
create policy workspace_members_delete on public.workspace_members for delete to authenticated
  using (
    public.has_workspace_role(workspace_id, 'owner')
    or (public.has_workspace_role(workspace_id, 'admin') and role <> 'owner')
  );

-- profiles: own row only. last_workspace_id may only point at a workspace the user belongs to.
grant select on table public.profiles to authenticated;
grant update (display_name, avatar_url, last_workspace_id) on table public.profiles to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated
  using (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (last_workspace_id is null or public.has_workspace_role(last_workspace_id, 'viewer'))
  );
