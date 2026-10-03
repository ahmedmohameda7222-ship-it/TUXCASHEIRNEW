-- TUX Admin Plan 6: exact-head review hardening follow-up.
-- Closes shop-scope pivot assignment, create-role hierarchy escalation,
-- and employee reactivation PIN collisions with active Operations workers.

create or replace function public.assign_employee_to_shop_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_auth record;
  v_business_id uuid;
  v_employee public.business_employees%rowtype;
  v_denial text;
  v_payload jsonb;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_actor_employee_id is null or p_employee_id is null or p_shop_id is null
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_assignment');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_business_id := v_auth.business_id;

  select * into v_employee
  from public.business_employees
  where id = p_employee_id
    and business_id = v_business_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  if not v_employee.active then return jsonb_build_object('ok', false, 'code', 'employee_inactive'); end if;

  -- Adding a shop must not be a scope-pivot: the actor must already control the
  -- target employee's complete existing shop scope before expanding it.
  v_denial := private.workforce_global_target_denial_v1(
    p_actor_employee_id,
    p_employee_id,
    'staff.manage'
  );
  if v_denial is not null then
    return jsonb_build_object('ok', false, 'code', v_denial);
  end if;

  v_payload := jsonb_build_object('employeeId', p_employee_id, 'shopId', p_shop_id);
  v_fingerprint := private.workforce_fingerprint_v1(v_payload);
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(
    v_business_id,
    p_command_id,
    'ASSIGN_EMPLOYEE_TO_SHOP',
    v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  if exists (
    select 1
    from public.employee_shop_assignments
    where employee_id = p_employee_id
      and shop_id = p_shop_id
  ) then
    v_result := jsonb_build_object(
      'ok', true,
      'replayed', true,
      'employeeId', p_employee_id,
      'shopId', p_shop_id
    );
    perform private.store_workforce_command_receipt_v1(
      v_business_id,
      p_command_id,
      'ASSIGN_EMPLOYEE_TO_SHOP',
      v_fingerprint,
      v_result
    );
    return v_result;
  end if;

  insert into public.employee_shop_assignments(business_id, employee_id, shop_id)
  values (v_business_id, p_employee_id, p_shop_id);

  perform public.append_admin_audit_event_v1(
    v_business_id,
    p_shop_id,
    p_actor_employee_id,
    'EMPLOYEE_SHOP_ASSIGNED',
    'BUSINESS_EMPLOYEE',
    p_employee_id::text,
    null,
    jsonb_build_object('employeeId', p_employee_id, 'shopId', p_shop_id),
    null,
    null,
    null,
    jsonb_build_object('source', 'workforce')
  );

  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'employeeId', p_employee_id,
    'shopId', p_shop_id
  );
  perform private.store_workforce_command_receipt_v1(
    v_business_id,
    p_command_id,
    'ASSIGN_EMPLOYEE_TO_SHOP',
    v_fingerprint,
    v_result
  );
  return v_result;
end;
$$;

create or replace function public.create_employee_v1(
  p_actor_employee_id uuid,
  p_shop_id uuid,
  p_display_name text,
  p_phone text,
  p_hire_date date,
  p_notes text,
  p_role text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_auth record;
  v_business_id uuid;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
  v_id uuid;
begin
  if nullif(btrim(p_display_name), '') is null
     or p_role not in ('OWNER','ADMIN','MANAGER','STAFF')
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;

  if p_role = 'OWNER' and v_auth.employee_role <> 'OWNER' then
    return jsonb_build_object('ok', false, 'code', 'role_escalation_forbidden');
  end if;
  if p_role = 'ADMIN' and v_auth.employee_role not in ('OWNER','ADMIN') then
    return jsonb_build_object('ok', false, 'code', 'role_escalation_forbidden');
  end if;
  if p_role = 'MANAGER' and v_auth.employee_role not in ('OWNER','ADMIN','MANAGER') then
    return jsonb_build_object('ok', false, 'code', 'role_escalation_forbidden');
  end if;

  v_business_id := v_auth.business_id;
  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'shopId', p_shop_id,
    'displayName', btrim(p_display_name),
    'phone', nullif(btrim(p_phone), ''),
    'hireDate', p_hire_date,
    'notes', nullif(btrim(p_notes), ''),
    'role', p_role
  ));

  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(
    v_business_id,
    p_command_id,
    'CREATE_EMPLOYEE',
    v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  insert into public.business_employees(
    business_id,
    display_name,
    phone,
    hire_date,
    notes,
    role,
    active
  ) values (
    v_business_id,
    btrim(p_display_name),
    nullif(btrim(p_phone), ''),
    p_hire_date,
    nullif(btrim(p_notes), ''),
    p_role,
    true
  )
  returning id into v_id;

  insert into public.employee_shop_assignments(business_id, employee_id, shop_id)
  values (v_business_id, v_id, p_shop_id);

  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'employeeId', v_id,
    'profileVersion', 1
  );
  perform private.store_workforce_command_receipt_v1(
    v_business_id,
    p_command_id,
    'CREATE_EMPLOYEE',
    v_fingerprint,
    v_result
  );
  perform public.append_admin_audit_event_v1(
    v_business_id,
    p_shop_id,
    p_actor_employee_id,
    'EMPLOYEE_CREATED',
    'BUSINESS_EMPLOYEE',
    v_id::text,
    null,
    jsonb_build_object('displayName', btrim(p_display_name), 'role', p_role, 'active', true),
    null,
    null,
    null,
    jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.reactivate_employee_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_expected_profile_version bigint,
  p_shop_id uuid,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_employee public.business_employees%rowtype;
  v_denial text;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_expected_profile_version is null
     or p_expected_profile_version <= 0
     or p_shop_id is null
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee_reactivate');
  end if;

  select * into v_employee
  from public.business_employees
  where id = p_employee_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;

  v_denial := private.workforce_global_target_denial_v1(
    p_actor_employee_id,
    p_employee_id,
    'staff.manage'
  );
  if v_denial is not null then
    return jsonb_build_object('ok', false, 'code', v_denial);
  end if;

  if not exists (
    select 1
    from public.employee_shop_assignments
    where business_id = v_employee.business_id
      and employee_id = p_employee_id
      and shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required');
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id,
    'expectedProfileVersion', p_expected_profile_version,
    'shopId', p_shop_id
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(
    v_employee.business_id,
    p_command_id,
    'REACTIVATE_EMPLOYEE',
    v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  if v_employee.profile_version <> p_expected_profile_version then
    return jsonb_build_object('ok', false, 'code', 'stale_employee');
  end if;
  if v_employee.active then
    return jsonb_build_object(
      'ok', true,
      'replayed', true,
      'employeeId', p_employee_id,
      'active', true,
      'profileVersion', v_employee.profile_version
    );
  end if;

  if v_employee.pin_lookup_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('employee-pin:' || v_employee.pin_lookup_hash, 0));

    if exists (
      select 1
      from public.business_employees e
      where e.id <> p_employee_id
        and e.active
        and e.pin_lookup_hash = v_employee.pin_lookup_hash
    ) then
      return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
    end if;

    if exists (
      select 1
      from public.workers w
      join public.employee_shop_assignments a
        on a.business_id = v_employee.business_id
       and a.employee_id = p_employee_id
       and a.shop_id = w.shop_id
      left join public.employee_worker_links l
        on l.worker_id = w.id
       and l.active
      where w.active
        and w.pin_lookup_hash = v_employee.pin_lookup_hash
        and coalesce(l.employee_id, '00000000-0000-0000-0000-000000000000'::uuid) <> p_employee_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
    end if;
  end if;

  update public.business_employees
  set active = true,
      profile_version = profile_version + 1,
      updated_at = now()
  where id = p_employee_id
    and business_id = v_employee.business_id;

  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'employeeId', p_employee_id,
    'active', true,
    'profileVersion', p_expected_profile_version + 1,
    'operationsSetupRequired', true
  );
  perform private.store_workforce_command_receipt_v1(
    v_employee.business_id,
    p_command_id,
    'REACTIVATE_EMPLOYEE',
    v_fingerprint,
    v_result
  );
  perform public.append_admin_audit_event_v1(
    v_employee.business_id,
    p_shop_id,
    p_actor_employee_id,
    'EMPLOYEE_REACTIVATED',
    'BUSINESS_EMPLOYEE',
    p_employee_id::text,
    jsonb_build_object('active', false, 'profileVersion', v_employee.profile_version),
    jsonb_build_object(
      'active', true,
      'profileVersion', p_expected_profile_version + 1,
      'operationsSetupRequired', true
    ),
    null,
    null,
    null,
    jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

revoke all on function public.assign_employee_to_shop_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.create_employee_v1(uuid, uuid, text, text, date, text, text, text)
  from public, anon, authenticated;
revoke all on function public.reactivate_employee_v1(uuid, uuid, bigint, uuid, text)
  from public, anon, authenticated;

grant execute on function public.assign_employee_to_shop_v1(uuid, uuid, uuid, text)
  to service_role;
grant execute on function public.create_employee_v1(uuid, uuid, text, text, date, text, text, text)
  to service_role;
grant execute on function public.reactivate_employee_v1(uuid, uuid, bigint, uuid, text)
  to service_role;
