-- Sentry adapter (issue #117): error volume by outcome, new, regressed, and resolved issues, and
-- releases per Sentry project (src/lib/adapters/sentry, docs/providers/sentry.md).
--
-- Adds the provider id only. Connections, external accounts, snapshots, and events already key on
-- public.provider_id, and their RLS policies do not name providers, so nothing else changes.
-- `if not exists` keeps the migration re-runnable; a new enum value cannot be used in the same
-- transaction that adds it, and nothing here does.
alter type public.provider_id add value if not exists 'sentry';
