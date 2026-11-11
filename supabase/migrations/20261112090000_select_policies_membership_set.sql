-- Select policies check membership once per statement, not once per row (#283).
--
-- Every select policy called public.has_workspace_role(workspace_id, min_role) on each row.
-- That function is security definer, so Postgres never inlines it, and a policy is evaluated
-- before any user qual that is not leakproof: a timeline severity filter or title search on a
-- 24,000 event workspace paid one membership lookup per event and took 150 to 480 ms.
--
-- * current_user_workspace_ids(min_role) returns the caller's workspace ids at that role or
--   above. The policies read it as `workspace_id = any (array(select ...))`: an uncorrelated
--   array subquery, so the planner runs it once per statement as an InitPlan and each row costs
--   one comparison against a short array.
-- * Semantics are unchanged: the same workspace_members rows at the same rank, for auth.uid()
--   only, read at query time, so a role change still applies on the next statement. No caller
--   (anon, or a token with no sub) gets no ids, and `x = any ('{}')` is false, as
--   has_workspace_role was. A null workspace_id matches nothing.
-- * Security definer for the same reason as has_workspace_role: workspace_members' own select
--   policy calls it, so it must read the table without recursing into that policy. It only ever
--   answers for the caller.
-- * Only select policies change. Insert, update, and delete policies touch the rows one statement
--   writes, not every row a read scans, and keep has_workspace_role.

create function public.current_user_workspace_ids(p_min_role public.workspace_role)
  returns setof uuid
  language sql
  stable
  security definer
  set search_path = ''
as $$
  select m.workspace_id
  from public.workspace_members m
  where m.user_id = auth.uid()
    and public.workspace_role_rank(m.role) >= public.workspace_role_rank(p_min_role)
$$;

revoke execute on function public.current_user_workspace_ids(public.workspace_role) from public, anon, authenticated;
grant execute on function public.current_user_workspace_ids(public.workspace_role) to authenticated;

alter policy workspaces_select on public.workspaces
  using (id = any (array(select public.current_user_workspace_ids('viewer'))));

alter policy workspace_members_select on public.workspace_members
  using (workspace_id = any (array(select public.current_user_workspace_ids('viewer'))));

alter policy sync_jobs_select on public.sync_jobs
  using (workspace_id is not null and workspace_id = any (array(select public.current_user_workspace_ids('viewer'))));

alter policy notification_preferences_select on public.notification_preferences
  using (
    user_id = (select auth.uid())
    and workspace_id = any (array(select public.current_user_workspace_ids('viewer')))
  );

alter policy api_keys_select on public.api_keys
  using (workspace_id = any (array(select public.current_user_workspace_ids('admin'))));

do $$
declare
  target text;
begin
  foreach target in array array[
    'projects', 'connections', 'external_accounts', 'usage_snapshots', 'activity_events',
    'activity_event_daily_counts', 'budgets', 'alert_rules', 'triggered_alerts',
    'alert_rule_destinations', 'notification_destinations', 'anomaly_mutes', 'published_metrics',
    'published_metric_views', 'project_pages'
  ]
  loop
    execute format(
      'alter policy %I on public.%I using (workspace_id = any (array(select public.current_user_workspace_ids(%L))))',
      target || '_select', target, 'viewer');
  end loop;
end $$;
