-- Alert delivery (#152, #153): two new job kinds. Added in a migration of their own because a new
-- enum value cannot be used in the transaction that adds it, and the next migration uses both in
-- an index predicate and in functions.
--
-- alert_dispatch: sends the triggered alerts no message has gone out for yet, by email and to the
--   workspace's channels, coalesced into one message per recipient.
-- digest: the daily (and on Mondays, weekly) digest email and channel post for one workspace.

alter type public.sync_job_kind add value if not exists 'alert_dispatch';
alter type public.sync_job_kind add value if not exists 'digest';
