-- TUX Admin Plan 1 one-time first-OWNER bootstrap authority.
-- This is an immediate additive continuation of 20260910100000_admin_business_auth.sql.
-- The browser never calls this RPC; only the trusted service role may execute it.

create or replace function public.bootstrap_tux_admin_owner_v1(
  p_business_id uuid,
  p_display_name text,
  p_pin_lookup_hash text,
  p_pin_hash text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_employee_id uuid;
begin
  if p_business_id is null then
    raise exception 'TUX_ADMIN_BOOTSTRAP_BUSINESS_REQUIRED';
  end if;
  if p_display_name is null or btrim(p_display_name) = '' or char_length(btrim(p_display_name)) > 120 then
    raise exception 'TUX_ADMIN_BOOTSTRAP_NAME_INVALID';
  end if;
  if p_pin_lookup_hash is null or p_pin_lookup_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'TUX_ADMIN_BOOTSTRAP_LOOKUP_HASH_INVALID';
  end if;
  if p_pin_hash is null
     or p_pin_hash !~ '^pbkdf2-sha256\$[0-9]+\$[0-9a-f]{32,}\$[0-9a-f]{64}$' then
    raise exception 'TUX_ADMIN_BOOTSTRAP_PIN_HASH_INVALID';
  end if;

  -- Lock both the canonical business row and a stable advisory key so concurrent
  -- serverless/operator attempts cannot create two first owners.
  perform 1 from public.businesses where id = p_business_id for update;
  if not found then
    raise exception 'TUX_ADMIN_BOOTSTRAP_BUSINESS_NOT_FOUND';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended('tux-admin-owner-bootstrap:' || p_business_id::text, 0)
  );

  if exists (
    select 1
    from public.business_employees
    where business_id = p_business_id
      and role = 'OWNER'
      and active
  ) then
    raise exception 'TUX_ADMIN_OWNER_ALREADY_EXISTS';
  end if;

  if exists (
    select 1
    from public.business_employees
    where pin_lookup_hash = p_pin_lookup_hash
      and active
  ) then
    raise exception 'TUX_ADMIN_PIN_ALREADY_IN_USE';
  end if;

  insert into public.business_employees(
    business_id,
    display_name,
    role,
    pin_lookup_hash,
    pin_hash,
    active
  )
  values (
    p_business_id,
    btrim(p_display_name),
    'OWNER',
    p_pin_lookup_hash,
    p_pin_hash,
    true
  )
  returning id into v_employee_id;

  return v_employee_id;
end;
$$;

revoke all on function public.bootstrap_tux_admin_owner_v1(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.bootstrap_tux_admin_owner_v1(uuid, text, text, text)
  to service_role;
