-- Railway adapter (issue #113): connections, accounts, metrics, and events for Railway carry
-- provider_id 'railway'. Adding an enum value is forward only and touches no rows; existing
-- policies and grants on the tables that use provider_id apply to the new value unchanged.
alter type public.provider_id add value if not exists 'railway';
