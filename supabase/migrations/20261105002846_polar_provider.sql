-- Polar adapter (issue #114).
--
-- 1. provider_id gains 'polar'.
-- 2. metric_kind gains 'recurring_revenue' for Polar's MRR and ARR. They are run rates at a point in
--    time, not money earned in a period, so they get their own kind: the dashboard sums 'revenue'
--    rows and spend rows by kind, and a new kind can never be added into either. Decision recorded
--    on #114.
--
-- A new enum value cannot be used in the transaction that adds it, so the check constraint that
-- names 'recurring_revenue' is replaced in the next migration, 20261105002847_recurring_revenue_shape.sql.

alter type public.provider_id add value if not exists 'polar';

alter type public.metric_kind add value if not exists 'recurring_revenue';
