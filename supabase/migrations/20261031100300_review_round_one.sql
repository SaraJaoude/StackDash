-- Review round one on the MVP branch (PR #126).
--
-- 1. connection_credentials.access_expires_at is dropped. Nothing ever read it: the sync job
--    decides whether to refresh from the expiry inside the decrypted credential, so a plaintext
--    copy of the token expiry was dead state that could drift from the sealed one.
-- 2. oauth_states.redirect_after is dropped. The callback never read it: it resolves the
--    workspace from workspace_id (it must, to check membership again), slugs are immutable, and
--    a new connection's page is only known after the code exchange, so the return paths are
--    built from the workspace row and the connection id. The column's check constraint goes
--    with it.
-- 3. purge_oauth_states deletes expired states. consume deletes a state only when the callback
--    arrives, so an abandoned flow (closed tab, GitHub's approval pending path) left its row,
--    with a sealed PKCE verifier bound to a user, forever. The retention job calls it.

alter table public.connection_credentials drop column access_expires_at;

alter table public.oauth_states drop column redirect_after;

-- Same batch shape as the purge functions in 20261031100000_sync_engine.sql: at most p_limit rows
-- per call, returns how many it deleted, and the retention job calls it until a call comes back
-- short. A state expired at p_before is expired (the callback refuses expires_at <= now), so it
-- goes too. oauth_states_expires_at_idx serves the scan.
create function public.purge_oauth_states(p_before timestamptz, p_limit int)
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
    select o.state from public.oauth_states o
    where o.expires_at <= p_before
    order by o.expires_at, o.state
    limit p_limit
    for update skip locked
  )
  delete from public.oauth_states o using doomed where o.state = doomed.state;

  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke execute on function public.purge_oauth_states(timestamptz, int) from public, anon, authenticated;
grant execute on function public.purge_oauth_states(timestamptz, int) to service_role;
