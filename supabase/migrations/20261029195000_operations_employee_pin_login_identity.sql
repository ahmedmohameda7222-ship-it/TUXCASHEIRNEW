-- Staff assignment and the employee PIN authorize Operations login.
-- A worker row remains an internal POS compatibility identity, never a setup step.
-- This function is trusted only after the Edge function verifies the supplied PIN.
create or replace function public.ensure_employee_operations_worker_login_v1(
  p_employee_id uuid,
  p_shop_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_employee public.business_employees%rowtype;
  v_link public.employee_worker_links%rowtype;
  v_worker public.workers%rowtype;
  v_worker_id uuid;
begin
  if p_employee_id is null or p_shop_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_login_scope');
  end if;

  select e.* into v_employee
  from public.business_employees e
  join public.employee_shop_assignments a
    on a.employee_id = e.id and a.business_id = e.business_id
  join public.business_shops bs
    on bs.business_id = e.business_id and bs.shop_id = a.shop_id
  join public.shops s on s.id = a.shop_id
  where e.id = p_employee_id and a.shop_id = p_shop_id
    and e.active and s.active and s.lifecycle_state = 'ACTIVE'
    and e.pin_hash is not null and e.pin_lookup_hash is not null
  for share of e;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'employee_login_denied');
  end if;

  -- Same serialization key as Admin worker provisioning.
  perform pg_advisory_xact_lock(hashtextextended(
    v_employee.business_id::text || ':worker-provision:' ||
      p_employee_id::text || ':' || p_shop_id::text, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'worker-pin:' || p_shop_id::text || ':' || v_employee.pin_lookup_hash, 0
  ));

  select * into v_link
  from public.employee_worker_links
  where business_id = v_employee.business_id
    and employee_id = p_employee_id and shop_id = p_shop_id
  for update;

  if found then
    if not v_link.active then
      return jsonb_build_object('ok', false, 'code', 'worker_access_suspended');
    end if;
    select * into v_worker from public.workers
    where id = v_link.worker_id and shop_id = p_shop_id for update;
    if not found or not v_worker.active then
      return jsonb_build_object('ok', false, 'code', 'worker_access_suspended');
    end if;
    -- PIN reset is authoritative in business_employees. Do not restore
    -- a suspended worker or issue an identity for a different shop.
    if v_worker.pin_hash is distinct from v_employee.pin_hash
       or v_worker.pin_lookup_hash is distinct from v_employee.pin_lookup_hash then
      if exists (
        select 1 from public.workers w
        where w.shop_id = p_shop_id and w.active
          and w.id <> v_worker.id
          and w.pin_lookup_hash = v_employee.pin_lookup_hash
      ) then
        return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
      end if;
      update public.workers
      set pin_hash = v_employee.pin_hash,
          pin_lookup_hash = v_employee.pin_lookup_hash,
          credential_version = credential_version + 1
      where id = v_worker.id;
    end if;
    return jsonb_build_object('ok', true, 'workerId', v_worker.id);
  end if;

  if exists (
    select 1 from public.workers w
    where w.shop_id = p_shop_id and w.active
      and w.pin_lookup_hash = v_employee.pin_lookup_hash
  ) then
    return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
  end if;

  v_worker_id := gen_random_uuid();
  insert into public.workers (id, shop_id, display_name, pin_hash, pin_lookup_hash, active)
  values (v_worker_id, p_shop_id, v_employee.display_name,
    v_employee.pin_hash, v_employee.pin_lookup_hash, true);
  insert into public.employee_worker_links (
    business_id, employee_id, shop_id, worker_id,
    linked_by_employee_id, link_command_id
  ) values (
    v_employee.business_id, p_employee_id, p_shop_id,
    v_worker_id, p_employee_id,
    'AUTO_EMPLOYEE_PIN_LOGIN:' || v_worker_id::text
  );
  return jsonb_build_object('ok', true, 'workerId', v_worker_id);
end;
$$;

revoke all on function public.ensure_employee_operations_worker_login_v1(uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.ensure_employee_operations_worker_login_v1(uuid,uuid)
  to service_role;
