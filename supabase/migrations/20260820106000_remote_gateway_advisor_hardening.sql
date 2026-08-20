-- Close material Supabase advisor findings introduced by the authenticated Operations gateway.
-- Operational fact tables intentionally retain RLS with no client policy: deny-by-default is the
-- security boundary and trusted service-role RPCs remain the only write path.

alter function private.tux_plan_table_allowed(text)
  set search_path = pg_catalog, public, private;

alter function private.tux_guard_allows(jsonb, jsonb)
  set search_path = pg_catalog, public, private;

-- Cover the new nullable foreign keys used by enrollment cleanup/audit and configuration publishing.
create index device_enrollment_codes_completed_auth_user_idx
  on private.device_enrollment_codes(completed_auth_user_id)
  where completed_auth_user_id is not null;

create index device_enrollment_codes_completed_device_idx
  on private.device_enrollment_codes(completed_device_id)
  where completed_device_id is not null;

create index operations_configuration_snapshots_published_by_auth_user_idx
  on public.operations_configuration_snapshots(published_by_auth_user_id)
  where published_by_auth_user_id is not null;
