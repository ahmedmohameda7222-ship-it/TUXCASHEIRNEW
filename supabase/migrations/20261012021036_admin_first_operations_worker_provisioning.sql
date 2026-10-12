-- Approved Plan 6 correction: create and link a first Operations worker using
-- the employee's already-established canonical PIN verifier. No plaintext PINs.
-- Expand-only: no existing worker, credential, or historical row is rewritten.
create or replace function public.provision_employee_operations_worker_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_command_id text
) returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_auth record;
  v_actor public.business_employees%rowtype;
  v_employee public.business_employees%rowtype;
  v_shop public.shops%rowtype;
  v_existing public.employee_worker_links%rowtype;
  v_business_id uuid;
  v_denial text;
  v_payload jsonb;
  v_fingerprint text;
  v_replay jsonb;
  v_worker_id uuid;
  v_result jsonb;
begin
  if p_actor_employee_id is null or p_employee_id is null or p_shop_id is null
     or nullif(btrim(p_command_id), '') is null or length(p_command_id) > 160 then
    return jsonb_build_object('ok', false, 'code', 'invalid_worker_provisioning');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_business_id := v_auth.business_id;

  select * into v_actor from public.business_employees
  where id = p_actor_employee_id and business_id = v_business_id and active
  for share;
  if not found or v_actor.role not in ('OWNER', 'ADMIN') then
    return jsonb_build_object('ok', false, 'code', 'permission_forbidden');
  end if;

  select s.* into v_shop
  from public.shops s
  join public.business_shops bs on bs.shop_id = s.id
  where s.id = p_shop_id and bs.business_id = v_business_id
  for share of s;
  if not found then return jsonb_build_object('ok', false, 'code', 'shop_outside_business'); end if;

  select * into v_employee from public.business_employees
  where id = p_employee_id and business_id = v_business_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  if not v_employee.active then return jsonb_build_object('ok', false, 'code', 'employee_inactive'); end if;

  v_denial := private.workforce_target_role_denial_v1(p_actor_employee_id, p_employee_id);
  if v_denial is not null then
    return jsonb_build_object('ok', false, 'code', v_denial);
  end if;

  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required');
  end if;

  -- Serialize both repeated command IDs and different commands targeting
  -- the same employee/shop before checking whether a worker already exists.
  perform pg_advisory_xact_lock(hashtextextended(
    v_business_id::text || ':workforce:' || p_command_id, 0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    v_business_id::text || ':worker-provision:' || p_employee_id::text || ':' || p_shop_id::text, 0
  ));
  v_payload := jsonb_build_object('employeeId', p_employee_id, 'shopId', p_shop_id);
  v_fingerprint := private.workforce_fingerprint_v1(v_payload);
  v_replay := private.workforce_command_replay_v1(
    v_business_id, p_command_id, 'PROVISION_OPERATIONS_WORKER', v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  if not v_shop.active or v_shop.lifecycle_state <> 'ACTIVE' then
    return jsonb_build_object('ok', false, 'code', 'shop_not_active');
  end if;

  select * into v_existing
  from public.employee_worker_links
  where business_id = v_business_id and employee_id = p_employee_id and shop_id = p_shop_id
  for update;
  if found then
    return jsonb_build_object(
      'ok', false,
      'code', case when v_existing.active then 'employee_shop_already_linked'
                   else 'worker_reactivation_required' end
    );
  end if;

  if nullif(btrim(v_employee.pin_hash), '') is null
     or v_employee.pin_lookup_hash is null
     or v_employee.pin_lookup_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'code', 'employee_pin_setup_required');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'worker-pin:' || p_shop_id::text || ':' || v_employee.pin_lookup_hash, 0
  ));
  -- A legacy active worker without a PIN lookup hash cannot be proven
  -- non-colliding without a plaintext PIN. Require remediation, not a guess.
  if exists (
    select 1 from public.workers
    where shop_id = p_shop_id and active and pin_lookup_hash is null
  ) then
    return jsonb_build_object('ok', false, 'code', 'worker_pin_collision_unverifiable');
  end if;
  if exists (
    select 1 from public.workers
    where shop_id = p_shop_id and active and pin_lookup_hash = v_employee.pin_lookup_hash
  ) then
    return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
  end if;

  v_worker_id := gen_random_uuid();
  insert into public.workers(id, shop_id, display_name, pin_hash, pin_lookup_hash, active)
  values (
    v_worker_id, p_shop_id, v_employee.display_name,
    v_employee.pin_hash, v_employee.pin_lookup_hash, true
  );

  insert into public.employee_worker_links(
    business_id, employee_id, shop_id, worker_id, linked_by_employee_id, link_command_id
  ) values (
    v_business_id, p_employee_id, p_shop_id, v_worker_id, p_actor_employee_id, p_command_id
  );

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id,
    'OPERATIONS_WORKER_PROVISIONED', 'BUSINESS_EMPLOYEE',
    p_employee_id::text, null,
    jsonb_build_object('employeeId', p_employee_id, 'workerId', v_worker_id, 'shopId', p_shop_id),
    null, null, null,
    jsonb_build_object('source', 'workforce', 'commandId', p_command_id)
  );
  v_result := jsonb_build_object(
    'ok', true, 'workerId', v_worker_id, 'shopId', p_shop_id, 'replayed', false
  );
  perform private.store_workforce_command_receipt_v1(
    v_business_id, p_command_id, 'PROVISION_OPERATIONS_WORKER', v_fingerprint, v_result
  );
  return v_result;
end;
$function$;

revoke all on function public.provision_employee_operations_worker_v1(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.provision_employee_operations_worker_v1(uuid,uuid,uuid,text)
  to service_role;
