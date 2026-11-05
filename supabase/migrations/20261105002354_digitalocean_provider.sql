-- DigitalOcean adapter (issue #116): a new value for public.provider_id, so connections,
-- activity events, and alert rules can name DigitalOcean. Nothing else changes: the adapter reuses
-- the connection, credential, snapshot, and event tables and their existing row level security.
--
-- `add value` cannot run inside a transaction that also uses the new value, so this migration
-- does nothing else.
alter type public.provider_id add value if not exists 'digitalocean';
