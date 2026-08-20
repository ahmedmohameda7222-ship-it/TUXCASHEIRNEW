-- Keep device enrollment retry-safe without duplicating the stable conflict-identity
-- row serialization already established by 20260820103500_remote_mutation_row_lock.sql.

create or replace function public.release_tux_device_enrollment(p_enrollment_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  update private.device_enrollment_codes enrollment
     set claimed_at = null
   where enrollment.id = p_enrollment_id
     and enrollment.claimed_at is not null
     and enrollment.completed_at is null
     and enrollment.expires_at > now();
  return found;
end;
$$;

revoke all on function public.release_tux_device_enrollment(uuid)
  from public, anon, authenticated;
grant execute on function public.release_tux_device_enrollment(uuid)
  to service_role;
