-- Flow context for provider OAuth (#40), kept server-side so `state` stays an opaque random token.
--
-- pending_installation_id: GitHub connects in two browser steps. The first (app install) returns an
--   untrusted installation id; the second (user authorization) state row remembers it so the code
--   exchange can verify the authorizing user can access that installation.
-- reconnect_connection_id: the connection a reconnect replaces. Composite reference, so a state row
--   can only point at a connection in its own workspace, and it disappears with that connection.
--
-- oauth_states stays service role only: RLS on, no policies, grants revoked (20261031090100).

alter table public.oauth_states
  add column pending_installation_id text
    constraint oauth_states_pending_installation_id_digits check (pending_installation_id ~ '^[0-9]{1,20}$'),
  add column reconnect_connection_id uuid,
  add constraint oauth_states_reconnect_connection_fkey foreign key (workspace_id, reconnect_connection_id)
    references public.connections (workspace_id, id) on delete cascade;

create index oauth_states_reconnect_connection_idx on public.oauth_states (workspace_id, reconnect_connection_id);

revoke all on table public.oauth_states from anon, authenticated;
