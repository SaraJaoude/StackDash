-- GitLab adapter (issue #112): add `gitlab` to the provider ids so connections, external accounts,
-- usage snapshots, activity events, and alert rules can name it. The adapter itself lives in
-- src/lib/adapters/gitlab; no table, policy, or grant changes with it.
--
-- `add value` cannot run inside a transaction block that later uses the new value, and nothing here
-- does; `if not exists` keeps a re-run harmless.
alter type public.provider_id add value if not exists 'gitlab';
