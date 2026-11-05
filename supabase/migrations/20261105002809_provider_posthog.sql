-- PostHog provider adapter (#115). Adds the provider id to the enum every provider column uses
-- (connections, oauth_states, activity_events, budgets, alert_rules). Additive only: existing rows
-- and policies are unchanged, and `if not exists` keeps a re-run harmless.
alter type public.provider_id add value if not exists 'posthog';
