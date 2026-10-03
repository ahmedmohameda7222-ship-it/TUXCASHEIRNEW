-- TUX Admin Plan 6: explicit Operations identity reactivation and lifecycle coherence.
-- Forward-only hardening. Do not silently restore Operations access when an Admin employee is reactivated.

create or replace function private.workforce_operations_setup_required_v1(
  p_business_id uuid,
  p_employee_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  select exists (
    select 1
    from public.employee_shop_assignments a
    where a.business_id = p_business_id
      and a.employee_id = p_employee_id
      and not exists (
        select 1
        from public.employee_worker_links l
        join public.workers w
          on w.id = l.worker_id
         and w.shop_id = a.shop_id
        where l.business_id = a.business_id
          and l.employee_id = a.employee_id
          and l.shop_id = a.shop_id
          and l.active
          and w.active
      )
  )
$$;

revoke all on function private.workforce_operations_setup_required_v1(uuid, uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_employee_worker_state_fingerprint_v1(
  p_actor_employee_id uuid,
  p_business_id uuid,
  p_employee_id uuid,
  p_target_shop_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_employee public.business_employees%rowtype;
  v_normalized_shops uuid[];
  v_current_shops uuid[];
  v_denial text;
begin
  if p_actor_employee_id is null
     or p_business_id is null
     or p_employee_id is null
     or p_target_shop_ids is null
     or cardinality(p_target_shop_ids) = 0 then
    return jsonb_build_object('ok', false, 'code', 'invalid_worker_state_fingerprint_request');
  end if;

  select array_agg(distinct shop_id order by shop_id)
  into v_normalized_shops
  from unnest(p_target_shop_ids) as requested(shop_id)
  where shop_id is not null;

  if v_normalized_shops is null or cardinality(v_normalized_shops) = 0 then
    return jsonb_build_object('ok', false, 'code', 'target_shops_required');
  end if;

  select * into v_employee
  from public.business_employees
  where id = p_employee_id
    and business_id = p_business_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'employee_not_found');
  end if;
  if not v_employee.active then
    return jsonb_build_object('ok', false, 'code', 'employee_inactive');
  end if;

  v_denial := private.workforce_global_target_denial_v1(
    p_actor_employee_id,
    p_employee_id,
    'staff.manage'
  );
  if v_denial is not null then
    return jsonb_build_object('ok', false, 'code', v_denial);
  end if;

  select array_agg(shop_id order by shop_id)
  into v_current_shops
  from public.employee_shop_assignments
  where business_id = p_business_id
    and employee_id = p_employee_id;

  if v_current_shops is null then
    return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required');
  end if;
  if v_current_shops <> v_normalized_shops then
    return jsonb_build_object('ok', false, 'code', 'credential_scope_changed');
  end if;

  return jsonb_build_object(
    'ok', true,
    'fingerprint', private.workforce_worker_state_fingerprint_v1(p_employee_id, v_current_shops)
  );
end;
$$;

revoke all on function public.get_employee_worker_state_fingerprint_v1(uuid, uuid, uuid, uuid[])
  from public, anon, authenticated;
grant execute on function public.get_employee_worker_state_fingerprint_v1(uuid, uuid, uuid, uuid[])
  to service_role;

create or replace function public.reactivate_employee_worker_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_worker_id uuid,
  p_expected_employee_credential_version bigint,
  p_expected_worker_credential_version bigint,
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
  v_worker public.workers%rowtype;
  v_denial text;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
  v_new_worker_credential_version bigint;
begin
  if p_actor_employee_id is null
     or p_employee_id is null
     or p_shop_id is null
     or p_worker_id is null
     or p_expected_employee_credential_version is null
     or p_expected_employee_credential_version <= 0
     or p_expected_worker_credential_version is null
     or p_expected_worker_credential_version <= 0
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee_worker_reactivate');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object(
      'ok', false,
      'code', coalesce(v_auth.denial_code, 'permission_forbidden')
    );
  end if;
  v_business_id := v_auth.business_id;

  select * into v_employee
  from public.business_employees
  where id = p_employee_id
    and business_id = v_business_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'employee_not_found');
  end if;

  v_denial := private.workforce_global_target_denial_v1(
    p_actor_employee_id,
    p_employee_id,
    'staff.manage'
  );
  if v_denial is not null then
    return jsonb_build_object('ok', false, 'code', v_denial);
  end if;
  if not v_employee.active then
    return jsonb_build_object('ok', false, 'code', 'employee_inactive');
  end if;
  if not exists (
    select 1
    from public.employee_shop_assignments
    where business_id = v_business_id
      and employee_id = p_employee_id
      and shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required');
  end if;

  select * into v_worker
  from public.workers
  where id = p_worker_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'worker_not_found');
  end if;
  if v_worker.shop_id <> p_shop_id then
    return jsonb_build_object('ok', false, 'code', 'worker_shop_mismatch');
  end if;

  if not exists (
    select 1
    from public.employee_worker_links l
    where l.business_id = v_business_id
      and l.employee_id = p_employee_id
      and l.shop_id = p_shop_id
      and l.worker_id = p_worker_id
      and l.active
  ) then
    return jsonb_build_object('ok', false, 'code', 'worker_link_mismatch');
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id,
    'shopId', p_shop_id,
    'workerId', p_worker_id,
    'expectedEmployeeCredentialVersion', p_expected_employee_credential_version,
    'expectedWorkerCredentialVersion', p_expected_worker_credential_version
  ));
  perform pg_advisory_xact_lock(
    hashtextextended(v_business_id::text || ':workforce:' || p_command_id, 0)
  );
  v_replay := private.workforce_command_replay_v1(
    v_business_id,
    p_command_id,
    'REACTIVATE_EMPLOYEE_WORKER',
    v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  if v_employee.credential_version <> p_expected_employee_credential_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_employee_credential',
      'currentVersion', v_employee.credential_version
    );
  end if;
  if v_worker.credential_version <> p_expected_worker_credential_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_worker_credential',
      'currentVersion', v_worker.credential_version
    );
  end if;

  if v_employee.pin_hash is null or v_employee.pin_lookup_hash is null then
    return jsonb_build_object('ok', false, 'code', 'employee_credential_setup_required');
  end if;

  if v_worker.active then
    v_result := jsonb_build_object(
      'ok', true,
      'replayed', true,
      'employeeId', p_employee_id,
      'workerId', p_worker_id,
      'shopId', p_shop_id,
      'employeeCredentialVersion', v_employee.credential_version,
      'workerCredentialVersion', v_worker.credential_version,
      'workerActive', true,
      'operationsSetupRequired', private.workforce_operations_setup_required_v1(
        v_business_id,
        p_employee_id
      )
    );
    perform private.store_workforce_command_receipt_v1(
      v_business_id,
      p_command_id,
      'REACTIVATE_EMPLOYEE_WORKER',
      v_fingerprint,
      v_result
    );
    return v_result;
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      v_business_id::text || ':worker-pin:' || p_shop_id::text || ':' || v_employee.pin_lookup_hash,
      0
    )
  );
  if exists (
    select 1
    from public.workers w
    where w.shop_id = p_shop_id
      and w.id <> p_worker_id
      and w.active
      and w.pin_lookup_hash = v_employee.pin_lookup_hash
  ) then
    return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
  end if;

  v_new_worker_credential_version := v_worker.credential_version + 1;
  update public.workers
  set pin_hash = v_employee.pin_hash,
      pin_lookup_hash = v_employee.pin_lookup_hash,
      credential_version = v_new_worker_credential_version,
      active = true,
      updated_at = now()
  where id = p_worker_id
    and shop_id = p_shop_id;

  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'employeeId', p_employee_id,
    'workerId', p_worker_id,
    'shopId', p_shop_id,
    'employeeCredentialVersion', v_employee.credential_version,
    'workerCredentialVersion', v_new_worker_credential_version,
    'workerActive', true,
    'operationsSetupRequired', private.workforce_operations_setup_required_v1(
      v_business_id,
      p_employee_id
    )
  );
  perform private.store_workforce_command_receipt_v1(
    v_business_id,
    p_command_id,
    'REACTIVATE_EMPLOYEE_WORKER',
    v_fingerprint,
    v_result
  );
  perform public.append_admin_audit_event_v1(
    v_business_id,
    p_shop_id,
    p_actor_employee_id,
    'EMPLOYEE_WORKER_REACTIVATED',
    'WORKER',
    p_worker_id::text,
    jsonb_build_object(
      'employeeId', p_employee_id,
      'workerId', p_worker_id,
      'shopId', p_shop_id,
      'active', false,
      'employeeCredentialVersion', v_employee.credential_version,
      'workerCredentialVersion', v_worker.credential_version
    ),
    jsonb_build_object(
      'employeeId', p_employee_id,
      'workerId', p_worker_id,
      'shopId', p_shop_id,
      'active', true,
      'employeeCredentialVersion', v_employee.credential_version,
      'workerCredentialVersion', v_new_worker_credential_version
    ),
    null,
    null,
    null,
    jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

revoke all on function public.reactivate_employee_worker_v1(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) from public, anon, authenticated;
grant execute on function public.reactivate_employee_worker_v1(
  uuid, uuid, uuid, uuid, bigint, bigint, text
) to service_role;

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
  v_operations_setup_required boolean;
begin
  if p_actor_employee_id is null
     or p_employee_id is null
     or p_expected_profile_version is null
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
  perform pg_advisory_xact_lock(
    hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0)
  );
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
    v_operations_setup_required := private.workforce_operations_setup_required_v1(
      v_employee.business_id,
      p_employee_id
    );
    v_result := jsonb_build_object(
      'ok', true,
      'replayed', true,
      'employeeId', p_employee_id,
      'active', true,
      'profileVersion', v_employee.profile_version,
      'operationsSetupRequired', v_operations_setup_required
    );
    perform private.store_workforce_command_receipt_v1(
      v_employee.business_id,
      p_command_id,
      'REACTIVATE_EMPLOYEE',
      v_fingerprint,
      v_result
    );
    return v_result;
  end if;

  if v_employee.pin_lookup_hash is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(
        v_employee.business_id::text || ':employee-pin:' || v_employee.pin_lookup_hash,
        0
      )
    );

    if exists (
      select 1
      from public.business_employees e
      where e.business_id = v_employee.business_id
        and e.id <> p_employee_id
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

  v_operations_setup_required := private.workforce_operations_setup_required_v1(
    v_employee.business_id,
    p_employee_id
  );
  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'employeeId', p_employee_id,
    'active', true,
    'profileVersion', p_expected_profile_version + 1,
    'operationsSetupRequired', v_operations_setup_required
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
      'operationsSetupRequired', v_operations_setup_required
    ),
    null,
    null,
    null,
    jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

revoke all on function public.reactivate_employee_v1(uuid, uuid, bigint, uuid, text)
  from public, anon, authenticated;
grant execute on function public.reactivate_employee_v1(uuid, uuid, bigint, uuid, text)
  to service_role;

create or replace function public.set_employee_permission_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_expected_profile_version bigint,
  p_permission_key text,
  p_effect text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_employee public.business_employees%rowtype;
  v_actor public.business_employees%rowtype;
  v_denial text;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
  v_previous_effect text;
begin
  if p_actor_employee_id is null
     or p_employee_id is null
     or p_expected_profile_version is null
     or p_expected_profile_version <= 0
     or p_effect not in ('ALLOW','DENY','INHERIT')
     or nullif(btrim(p_permission_key), '') is null
     or p_shop_id is null
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee_permission');
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

  select * into v_actor
  from public.business_employees
  where id = p_actor_employee_id
    and business_id = v_employee.business_id
    and active;
  if v_actor.role not in ('OWNER','ADMIN') then
    return jsonb_build_object('ok', false, 'code', 'permission_escalation_forbidden');
  end if;
  if p_actor_employee_id = p_employee_id and v_actor.role <> 'OWNER' then
    return jsonb_build_object('ok', false, 'code', 'self_permission_change_forbidden');
  end if;
  if v_employee.role = 'OWNER' and v_actor.role <> 'OWNER' then
    return jsonb_build_object('ok', false, 'code', 'permission_escalation_forbidden');
  end if;
  if not exists (
    select 1
    from public.admin_permissions
    where permission_key = p_permission_key
  ) then
    return jsonb_build_object('ok', false, 'code', 'permission_key_invalid');
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id,
    'expectedProfileVersion', p_expected_profile_version,
    'permissionKey', p_permission_key,
    'effect', p_effect
  ));
  perform pg_advisory_xact_lock(
    hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0)
  );
  v_replay := private.workforce_command_replay_v1(
    v_employee.business_id,
    p_command_id,
    'SET_EMPLOYEE_PERMISSION',
    v_fingerprint
  );
  if v_replay is not null then return v_replay; end if;

  if v_employee.profile_version <> p_expected_profile_version then
    return jsonb_build_object(
      'ok', false,
      'code', 'stale_employee',
      'currentVersion', v_employee.profile_version
    );
  end if;

  select effect into v_previous_effect
  from public.admin_employee_permissions
  where business_id = v_employee.business_id
    and employee_id = p_employee_id
    and permission_key = p_permission_key;

  if p_effect = 'INHERIT' then
    delete from public.admin_employee_permissions
    where business_id = v_employee.business_id
      and employee_id = p_employee_id
      and permission_key = p_permission_key;
  else
    insert into public.admin_employee_permissions(
      business_id,
      employee_id,
      permission_key,
      effect
    ) values (
      v_employee.business_id,
      p_employee_id,
      p_permission_key,
      p_effect
    )
    on conflict (employee_id, permission_key)
    do update set effect = excluded.effect, updated_at = now();
  end if;

  update public.business_employees
  set profile_version = profile_version + 1,
      updated_at = now()
  where id = p_employee_id
    and business_id = v_employee.business_id;

  v_result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'employeeId', p_employee_id,
    'permissionKey', p_permission_key,
    'effect', p_effect,
    'profileVersion', p_expected_profile_version + 1
  );
  perform private.store_workforce_command_receipt_v1(
    v_employee.business_id,
    p_command_id,
    'SET_EMPLOYEE_PERMISSION',
    v_fingerprint,
    v_result
  );
  perform public.append_admin_audit_event_v1(
    v_employee.business_id,
    p_shop_id,
    p_actor_employee_id,
    'EMPLOYEE_PERMISSION_CHANGED',
    'BUSINESS_EMPLOYEE',
    p_employee_id::text,
    case
      when v_previous_effect is null then null
      else jsonb_build_object('permissionKey', p_permission_key, 'effect', v_previous_effect)
    end,
    jsonb_build_object(
      'permissionKey', p_permission_key,
      'effect', p_effect,
      'profileVersion', p_expected_profile_version + 1
    ),
    null,
    null,
    null,
    jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

revoke all on function public.set_employee_permission_v1(uuid, uuid, uuid, bigint, text, text, text)
  from public, anon, authenticated;
grant execute on function public.set_employee_permission_v1(uuid, uuid, uuid, bigint, text, text, text)
  to service_role;
