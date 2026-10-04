-- TUX Admin Plan 6: keep employee PIN uniqueness inside the owning business.
-- Worker PIN collisions remain shop-scoped because Operations workers are shop identities.

create or replace function public.stage_employee_pin_change_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_target_shop_ids uuid[],
  p_pin_verifier_hash text,
  p_pin_lookup_hash text,
  p_expected_credential_version bigint,
  p_worker_state_fingerprint text,
  p_expires_at timestamptz,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_employee public.business_employees%rowtype;
  v_business_id uuid;
  v_normalized_shops uuid[];
  v_current_shops uuid[];
  v_current_worker_fingerprint text;
  v_existing private.admin_employee_pin_change_commands%rowtype;
  v_ref uuid;
  v_denial text;
begin
  if p_actor_employee_id is null or p_employee_id is null
     or p_target_shop_ids is null or cardinality(p_target_shop_ids) = 0
     or p_pin_verifier_hash is null
     or p_pin_verifier_hash !~ '^pbkdf2-sha256\$[0-9]+\$[0-9a-f]+\$[0-9a-f]+$'
     or p_pin_lookup_hash is null or p_pin_lookup_hash !~ '^[0-9a-f]{64}$'
     or p_expected_credential_version is null or p_expected_credential_version <= 0
     or p_expires_at is null or p_expires_at <= now()
     or p_command_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_credential_command');
  end if;

  select array_agg(distinct s order by s) into v_normalized_shops
  from unnest(p_target_shop_ids) s
  where s is not null;
  if v_normalized_shops is null or cardinality(v_normalized_shops) = 0 then
    return jsonb_build_object('ok', false, 'code', 'target_shops_required');
  end if;

  select * into v_employee
  from public.business_employees
  where id = p_employee_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  v_business_id := v_employee.business_id;

  v_denial := private.workforce_global_target_denial_v1(p_actor_employee_id, p_employee_id, 'staff.manage');
  if v_denial is not null then return jsonb_build_object('ok', false, 'code', v_denial); end if;

  select array_agg(shop_id order by shop_id) into v_current_shops
  from public.employee_shop_assignments
  where business_id = v_business_id and employee_id = p_employee_id;
  if v_current_shops is null then
    return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required');
  end if;
  if v_current_shops <> v_normalized_shops then
    return jsonb_build_object('ok', false, 'code', 'credential_scope_changed');
  end if;

  if v_employee.credential_version <> p_expected_credential_version then
    return jsonb_build_object('ok', false, 'code', 'stale_credential');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_business_id::text || ':employee-pin:' || p_pin_lookup_hash, 0)
  );
  if exists (
    select 1 from public.business_employees e
    where e.business_id = v_business_id
      and e.id <> p_employee_id
      and e.active
      and e.pin_lookup_hash = p_pin_lookup_hash
  ) then
    return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
  end if;
  if exists (
    select 1 from public.workers w
    where w.shop_id = any(v_current_shops)
      and w.active
      and w.pin_lookup_hash = p_pin_lookup_hash
      and not exists (
        select 1 from public.employee_worker_links l
        where l.worker_id = w.id
          and l.employee_id = p_employee_id
          and l.business_id = v_business_id
          and l.active
      )
  ) then
    return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
  end if;

  v_current_worker_fingerprint :=
    private.workforce_worker_state_fingerprint_v1(p_employee_id, v_current_shops);
  if p_worker_state_fingerprint is not null
     and p_worker_state_fingerprint <> v_current_worker_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'worker_credential_state_changed');
  end if;

  select * into v_existing
  from private.admin_employee_pin_change_commands
  where command_id = p_command_id
  for update;
  if found then
    if v_existing.business_id <> v_business_id
       or v_existing.employee_id <> p_employee_id
       or v_existing.target_shop_ids <> v_current_shops
       or v_existing.pin_verifier_hash <> p_pin_verifier_hash
       or v_existing.pin_lookup_hash <> p_pin_lookup_hash
       or v_existing.expected_credential_version <> p_expected_credential_version then
      return jsonb_build_object('ok', false, 'code', 'credential_command_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'replayed', true,
      'commandRef', v_existing.command_ref,
      'expectedCredentialVersion', v_existing.expected_credential_version
    );
  end if;

  insert into private.admin_employee_pin_change_commands(
    command_id, business_id, employee_id, target_shop_ids,
    pin_verifier_hash, pin_lookup_hash, expected_credential_version,
    worker_state_fingerprint, staged_by_employee_id, expires_at
  ) values (
    p_command_id, v_business_id, p_employee_id, v_current_shops,
    p_pin_verifier_hash, p_pin_lookup_hash, p_expected_credential_version,
    v_current_worker_fingerprint, p_actor_employee_id, p_expires_at
  ) returning command_ref into v_ref;

  perform public.append_admin_audit_event_v1(
    v_business_id, null, p_actor_employee_id, 'EMPLOYEE_PIN_CHANGE_STAGED',
    'BUSINESS_EMPLOYEE', p_employee_id::text, null,
    jsonb_build_object(
      'employeeId', p_employee_id,
      'targetShopIds', v_current_shops,
      'expectedCredentialVersion', p_expected_credential_version,
      'credentialCommandRef', v_ref
    ),
    null, null, null, jsonb_build_object('source', 'workforce')
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'commandRef', v_ref,
    'expectedCredentialVersion', p_expected_credential_version
  );
end;
$$;

create or replace function public.apply_employee_pin_change_v1(
  p_actor_employee_id uuid,
  p_command_ref uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_command private.admin_employee_pin_change_commands%rowtype;
  v_employee public.business_employees%rowtype;
  v_current_shops uuid[];
  v_current_worker_fingerprint text;
  v_new_version bigint;
  v_denial text;
begin
  if p_actor_employee_id is null or p_command_ref is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_credential_command');
  end if;

  select * into v_command
  from private.admin_employee_pin_change_commands
  where command_ref = p_command_ref
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'credential_command_not_found'); end if;

  if v_command.consumed_at is not null then
    select * into v_employee
    from public.business_employees
    where id = v_command.employee_id and business_id = v_command.business_id;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'employeeId', v_command.employee_id,
      'credentialVersion', v_employee.credential_version
    );
  end if;
  if v_command.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'credential_command_expired');
  end if;

  select * into v_employee
  from public.business_employees
  where id = v_command.employee_id
    and business_id = v_command.business_id
  for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;

  v_denial := private.workforce_global_target_denial_v1(p_actor_employee_id, v_command.employee_id, 'staff.manage');
  if v_denial is not null then return jsonb_build_object('ok', false, 'code', v_denial); end if;

  select array_agg(shop_id order by shop_id) into v_current_shops
  from public.employee_shop_assignments
  where business_id = v_command.business_id and employee_id = v_command.employee_id;
  if v_current_shops is null or v_current_shops <> v_command.target_shop_ids then
    return jsonb_build_object('ok', false, 'code', 'credential_scope_changed');
  end if;

  if v_employee.credential_version <> v_command.expected_credential_version then
    return jsonb_build_object('ok', false, 'code', 'stale_credential');
  end if;

  v_current_worker_fingerprint :=
    private.workforce_worker_state_fingerprint_v1(v_command.employee_id, v_current_shops);
  if v_current_worker_fingerprint <> v_command.worker_state_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'worker_credential_state_changed');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_command.business_id::text || ':employee-pin:' || v_command.pin_lookup_hash, 0)
  );
  if exists (
    select 1 from public.business_employees e
    where e.business_id = v_command.business_id
      and e.id <> v_command.employee_id
      and e.active
      and e.pin_lookup_hash = v_command.pin_lookup_hash
  ) then
    return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
  end if;
  if exists (
    select 1 from public.workers w
    where w.shop_id = any(v_current_shops)
      and w.active
      and w.pin_lookup_hash = v_command.pin_lookup_hash
      and not exists (
        select 1 from public.employee_worker_links l
        where l.worker_id = w.id
          and l.employee_id = v_command.employee_id
          and l.business_id = v_command.business_id
          and l.active
      )
  ) then
    return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
  end if;

  v_new_version := v_employee.credential_version + 1;
  update public.workers w
  set pin_hash = v_command.pin_verifier_hash,
      pin_lookup_hash = v_command.pin_lookup_hash,
      credential_version = credential_version + 1,
      updated_at = now()
  from public.employee_worker_links l
  where l.worker_id = w.id
    and l.employee_id = v_command.employee_id
    and l.business_id = v_command.business_id
    and l.shop_id = any(v_current_shops)
    and l.active;

  update public.business_employees
  set pin_hash = v_command.pin_verifier_hash,
      pin_lookup_hash = v_command.pin_lookup_hash,
      credential_version = v_new_version,
      updated_at = now()
  where id = v_command.employee_id
    and business_id = v_command.business_id;

  update private.admin_employee_pin_change_commands
  set consumed_at = now()
  where command_ref = p_command_ref;

  perform public.append_admin_audit_event_v1(
    v_command.business_id, null, p_actor_employee_id, 'EMPLOYEE_PIN_CHANGED',
    'BUSINESS_EMPLOYEE', v_command.employee_id::text,
    jsonb_build_object('credentialVersion', v_command.expected_credential_version),
    jsonb_build_object(
      'credentialVersion', v_new_version,
      'targetShopIds', v_current_shops,
      'credentialCommandRef', p_command_ref
    ),
    null, null, null, jsonb_build_object('source', 'workforce')
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false,
    'employeeId', v_command.employee_id, 'credentialVersion', v_new_version
  );
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
    perform pg_advisory_xact_lock(
      hashtextextended(v_employee.business_id::text || ':employee-pin:' || v_employee.pin_lookup_hash, 0)
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

revoke all on function public.stage_employee_pin_change_v1(uuid, uuid, uuid[], text, text, bigint, text, timestamptz, uuid)
  from public, anon, authenticated;
revoke all on function public.apply_employee_pin_change_v1(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reactivate_employee_v1(uuid, uuid, bigint, uuid, text)
  from public, anon, authenticated;

grant execute on function public.stage_employee_pin_change_v1(uuid, uuid, uuid[], text, text, bigint, text, timestamptz, uuid)
  to service_role;
grant execute on function public.apply_employee_pin_change_v1(uuid, uuid)
  to service_role;
grant execute on function public.reactivate_employee_v1(uuid, uuid, bigint, uuid, text)
  to service_role;
