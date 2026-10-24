-- A Business Day is shared by distinct workers on separate Operations devices.
-- The old index incorrectly enforced one OPEN worker globally per Business Day,
-- making independent worker sign-out impossible even with valid device membership.
-- The local browser still has exactly one Current Operator and maintains its
-- own single-session command coordinator. Canonical server visibility spans devices.
drop index if exists public.worker_sessions_one_open_per_business_day_idx;
create index if not exists worker_sessions_open_workers_by_day_idx
  on public.worker_sessions(business_day_id, worker_id)
  where ended_at is null;
