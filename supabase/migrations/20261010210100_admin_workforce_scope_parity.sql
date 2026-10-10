-- Forward-only semantic reconciliation for Plan 6 complete-target-scope security.
-- Do not replay or edit historical migrations. Live definitions lacked these
-- denial helpers and the reviewed RPC enforcement as of 2026-10-10.

create or replace function private.workforce_target_role_denial_v1(
  p_actor_employee_id uuid,
  p_target_employee_id uuid
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_actor public.business_employees%rowtype;
  v_target public.business_employees%rowtype;
begin
  select * into v_target
  from public.business_employees
  where id = p_target_employee_id;
  if not found then return 'employee_not_found'; end if;

  select * into v_actor
  from public.business_employees
  where id = p_actor_employee_id
    and business_id = v_target.business_id
    and active;
  if not found then return 'permission_forbidden'; end if;

  if v_target.role = 'OWNER' and v_actor.role <> 'OWNER' then
    return 'role_escalation_forbidden';
  end if;
  if v_target.role = 'ADMIN' and v_actor.role not in ('OWNER','ADMIN') then
    return 'role_escalation_forbidden';
  end if;
  if v_target.role = 'MANAGER' and v_actor.role = 'STAFF' then
    return 'role_escalation_forbidden';
  end if;
  return null;
end;
$$;

revoke all on function private.workforce_target_role_denial_v1(uuid, uuid) from public, anon, authenticated, service_role;

create or replace function private.workforce_global_target_denial_v1(
  p_actor_employee_id uuid,
  p_target_employee_id uuid,
  p_permission_key text
)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_target public.business_employees%rowtype;
  v_role_denial text;
  v_shop_id uuid;
  v_count integer := 0;
  v_auth record;
begin
  select * into v_target
  from public.business_employees
  where id = p_target_employee_id;
  if not found then return 'employee_not_found'; end if;

  v_role_denial := private.workforce_target_role_denial_v1(p_actor_employee_id, p_target_employee_id);
  if v_role_denial is not null then return v_role_denial; end if;

  for v_shop_id in
    select shop_id
    from public.employee_shop_assignments
    where business_id = v_target.business_id
      and employee_id = p_target_employee_id
    order by shop_id
  loop
    v_count := v_count + 1;
    select * into v_auth
    from public.resolve_admin_authorization_v1(p_actor_employee_id, v_shop_id, p_permission_key);
    if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_target.business_id then
      return coalesce(v_auth.denial_code, 'employee_scope_forbidden');
    end if;
  end loop;

  if v_count = 0 then return 'employee_shop_assignment_required'; end if;
  return null;
end;
$$;

revoke all on function private.workforce_global_target_denial_v1(uuid, uuid, text) from public, anon, authenticated, service_role;

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

revoke all on function public.assign_employee_to_shop_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.assign_employee_to_shop_v1(uuid, uuid, uuid, text)
  to service_role;

create or replace function public.set_employee_role_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_expected_profile_version bigint,
  p_role text,
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
begin
  if p_role not in ('OWNER','ADMIN','MANAGER','STAFF') or p_expected_profile_version is null
     or p_expected_profile_version <= 0 or p_shop_id is null or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee_role');
  end if;
  select * into v_employee from public.business_employees where id = p_employee_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;

  v_denial := private.workforce_global_target_denial_v1(p_actor_employee_id, p_employee_id, 'staff.manage');
  if v_denial is not null then return jsonb_build_object('ok', false, 'code', v_denial); end if;
  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_employee.business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required'); end if;

  select * into v_actor from public.business_employees
  where id = p_actor_employee_id and business_id = v_employee.business_id and active;
  if p_role = 'OWNER' and v_actor.role <> 'OWNER' then return jsonb_build_object('ok', false, 'code', 'role_escalation_forbidden'); end if;
  if p_role = 'ADMIN' and v_actor.role not in ('OWNER','ADMIN') then return jsonb_build_object('ok', false, 'code', 'role_escalation_forbidden'); end if;
  if p_role = 'MANAGER' and v_actor.role = 'STAFF' then return jsonb_build_object('ok', false, 'code', 'role_escalation_forbidden'); end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'expectedProfileVersion', p_expected_profile_version, 'role', p_role
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_employee.business_id, p_command_id, 'SET_EMPLOYEE_ROLE', v_fingerprint);
  if v_replay is not null then return v_replay; end if;
  if v_employee.profile_version <> p_expected_profile_version then return jsonb_build_object('ok', false, 'code', 'stale_employee'); end if;

  if v_employee.active and v_employee.role = 'OWNER' and p_role <> 'OWNER' then
    perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':owner-invariant', 0));
    if not exists (
      select 1 from public.business_employees e
      where e.business_id = v_employee.business_id and e.id <> p_employee_id and e.active and e.role = 'OWNER'
    ) then return jsonb_build_object('ok', false, 'code', 'last_owner_required'); end if;
  end if;

  update public.business_employees
  set role = p_role, profile_version = profile_version + 1, updated_at = now()
  where id = p_employee_id and business_id = v_employee.business_id;
  v_result := jsonb_build_object('ok', true, 'replayed', false, 'employeeId', p_employee_id, 'role', p_role, 'profileVersion', p_expected_profile_version + 1);
  perform private.store_workforce_command_receipt_v1(v_employee.business_id, p_command_id, 'SET_EMPLOYEE_ROLE', v_fingerprint, v_result);
  perform public.append_admin_audit_event_v1(
    v_employee.business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_ROLE_CHANGED',
    'BUSINESS_EMPLOYEE', p_employee_id::text,
    jsonb_build_object('role', v_employee.role), jsonb_build_object('role', p_role),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

revoke all on function public.set_employee_role_v1(uuid, uuid, uuid, bigint, text, text) from public, anon, authenticated;
grant execute on function public.set_employee_role_v1(uuid, uuid, uuid, bigint, text, text) to service_role;

create or replace function public.suspend_employee_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_expected_profile_version bigint,
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
  if p_actor_employee_id is null or p_employee_id is null or p_expected_profile_version is null
     or p_expected_profile_version <= 0 or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee_suspend');
  end if;

  select * into v_employee from public.business_employees where id = p_employee_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;

  v_denial := private.workforce_global_target_denial_v1(p_actor_employee_id, p_employee_id, 'staff.manage');
  if v_denial is not null then return jsonb_build_object('ok', false, 'code', v_denial); end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'expectedProfileVersion', p_expected_profile_version
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_employee.business_id, p_command_id, 'SUSPEND_EMPLOYEE', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  if v_employee.profile_version <> p_expected_profile_version then
    return jsonb_build_object('ok', false, 'code', 'stale_employee');
  end if;

  if v_employee.active and v_employee.role = 'OWNER' then
    perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':owner-invariant', 0));
    if not exists (
      select 1 from public.business_employees e
      where e.business_id = v_employee.business_id
        and e.id <> p_employee_id
        and e.active and e.role = 'OWNER'
    ) then
      return jsonb_build_object('ok', false, 'code', 'last_owner_required');
    end if;
  end if;

  -- Audit while a self-suspending actor is still active; the transaction keeps this atomic.
  perform public.append_admin_audit_event_v1(
    v_employee.business_id, null, p_actor_employee_id, 'EMPLOYEE_SUSPENDED',
    'BUSINESS_EMPLOYEE', p_employee_id::text,
    jsonb_build_object('active', v_employee.active, 'profileVersion', v_employee.profile_version),
    jsonb_build_object('active', false, 'profileVersion', p_expected_profile_version + 1),
    null, null, null, jsonb_build_object('source', 'workforce')
  );

  update public.business_employees
  set active = false, profile_version = profile_version + 1, updated_at = now()
  where id = p_employee_id and business_id = v_employee.business_id;

  update public.admin_sessions
  set revoked_at = coalesce(revoked_at, now()), last_seen_at = now()
  where business_id = v_employee.business_id
    and employee_id = p_employee_id
    and revoked_at is null;

  update public.workers w
  set active = false, updated_at = now()
  from public.employee_worker_links l
  where l.business_id = v_employee.business_id
    and l.employee_id = p_employee_id
    and l.worker_id = w.id
    and l.active
    and w.active;

  v_result := jsonb_build_object(
    'ok', true, 'replayed', false, 'employeeId', p_employee_id,
    'active', false, 'profileVersion', p_expected_profile_version + 1
  );
  perform private.store_workforce_command_receipt_v1(
    v_employee.business_id, p_command_id, 'SUSPEND_EMPLOYEE', v_fingerprint, v_result
  );
  return v_result;
end;
$$;

revoke all on function public.suspend_employee_v1(uuid, uuid, bigint, text) from public, anon, authenticated;
grant execute on function public.suspend_employee_v1(uuid, uuid, bigint, text) to service_role;

create or replace function public.update_employee_profile_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_expected_profile_version bigint,
  p_display_name text,
  p_phone text,
  p_hire_date date,
  p_notes text,
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
  select * into v_employee from public.business_employees where id = p_employee_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  if p_expected_profile_version is null or p_expected_profile_version <= 0
     or p_shop_id is null or nullif(btrim(p_display_name), '') is null or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee');
  end if;

  v_denial := private.workforce_global_target_denial_v1(p_actor_employee_id, p_employee_id, 'staff.manage');
  if v_denial is not null then return jsonb_build_object('ok', false, 'code', v_denial); end if;
  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_employee.business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required'); end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'expectedProfileVersion', p_expected_profile_version,
    'displayName', btrim(p_display_name), 'phone', nullif(btrim(p_phone), ''),
    'hireDate', p_hire_date, 'notes', nullif(btrim(p_notes), '')
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_employee.business_id, p_command_id, 'UPDATE_EMPLOYEE_PROFILE', v_fingerprint);
  if v_replay is not null then return v_replay; end if;
  if v_employee.profile_version <> p_expected_profile_version then return jsonb_build_object('ok', false, 'code', 'stale_employee'); end if;

  update public.business_employees
  set display_name = btrim(p_display_name), phone = nullif(btrim(p_phone), ''),
      hire_date = p_hire_date, notes = nullif(btrim(p_notes), ''),
      profile_version = profile_version + 1, updated_at = now()
  where id = p_employee_id and business_id = v_employee.business_id;

  v_result := jsonb_build_object('ok', true, 'replayed', false, 'employeeId', p_employee_id, 'profileVersion', p_expected_profile_version + 1);
  perform private.store_workforce_command_receipt_v1(v_employee.business_id, p_command_id, 'UPDATE_EMPLOYEE_PROFILE', v_fingerprint, v_result);
  perform public.append_admin_audit_event_v1(
    v_employee.business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_PROFILE_UPDATED',
    'BUSINESS_EMPLOYEE', p_employee_id::text,
    jsonb_build_object('displayName', v_employee.display_name, 'phone', v_employee.phone, 'hireDate', v_employee.hire_date, 'notes', v_employee.notes),
    jsonb_build_object('displayName', btrim(p_display_name), 'phone', nullif(btrim(p_phone), ''), 'hireDate', p_hire_date, 'notes', nullif(btrim(p_notes), '')),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

revoke all on function public.update_employee_profile_v1(uuid, uuid, uuid, bigint, text, text, date, text, text) from public, anon, authenticated;
grant execute on function public.update_employee_profile_v1(uuid, uuid, uuid, bigint, text, text, date, text, text) to service_role;

create or replace function public.set_employee_compensation_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_compensation_type text,
  p_rate_minor bigint,
  p_effective_from date,
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
  v_version bigint;
  v_id uuid;
begin
  if p_compensation_type not in ('HOURLY','MONTHLY') or p_rate_minor is null or p_rate_minor < 0
     or p_effective_from is null or p_shop_id is null or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_compensation');
  end if;
  select * into v_employee from public.business_employees where id = p_employee_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;

  v_denial := private.workforce_global_target_denial_v1(p_actor_employee_id, p_employee_id, 'staff.manage');
  if v_denial is not null then return jsonb_build_object('ok', false, 'code', v_denial); end if;
  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_employee.business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required'); end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'compensationType', p_compensation_type,
    'rateMinor', p_rate_minor, 'effectiveFrom', p_effective_from
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_employee.business_id, p_command_id, 'SET_EMPLOYEE_COMPENSATION', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.employee_compensation where employee_id = p_employee_id;
  insert into public.employee_compensation(
    business_id, employee_id, compensation_type, rate_minor, effective_from,
    version, created_by_employee_id
  ) values (
    v_employee.business_id, p_employee_id, p_compensation_type, p_rate_minor,
    p_effective_from, v_version, p_actor_employee_id
  ) returning id into v_id;

  v_result := jsonb_build_object('ok', true, 'replayed', false, 'compensationId', v_id, 'version', v_version);
  perform private.store_workforce_command_receipt_v1(v_employee.business_id, p_command_id, 'SET_EMPLOYEE_COMPENSATION', v_fingerprint, v_result);
  perform public.append_admin_audit_event_v1(
    v_employee.business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_COMPENSATION_CHANGED',
    'BUSINESS_EMPLOYEE', p_employee_id::text, null,
    jsonb_build_object('compensationType', p_compensation_type, 'rateMinor', p_rate_minor, 'effectiveFrom', p_effective_from, 'version', v_version),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

revoke all on function public.set_employee_compensation_v1(uuid, uuid, uuid, text, bigint, date, text) from public, anon, authenticated;
grant execute on function public.set_employee_compensation_v1(uuid, uuid, uuid, text, bigint, date, text) to service_role;

create or replace function public.link_employee_worker_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_worker_id uuid,
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
  v_existing public.employee_worker_links%rowtype;
  v_denial text;
  v_payload jsonb;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_actor_employee_id is null or p_employee_id is null or p_shop_id is null
     or p_worker_id is null or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_worker_link');
  end if;
  select * into v_auth from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden')); end if;
  v_business_id := v_auth.business_id;
  select * into v_employee from public.business_employees where id = p_employee_id and business_id = v_business_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  if not v_employee.active then return jsonb_build_object('ok', false, 'code', 'employee_inactive'); end if;
  v_denial := private.workforce_target_role_denial_v1(p_actor_employee_id, p_employee_id);
  if v_denial is not null then return jsonb_build_object('ok', false, 'code', v_denial); end if;
  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required'); end if;

  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'worker_not_found'); end if;
  if v_worker.shop_id <> p_shop_id then return jsonb_build_object('ok', false, 'code', 'worker_shop_mismatch'); end if;
  if not v_worker.active then return jsonb_build_object('ok', false, 'code', 'worker_inactive'); end if;

  v_payload := jsonb_build_object('employeeId', p_employee_id, 'shopId', p_shop_id, 'workerId', p_worker_id);
  v_fingerprint := private.workforce_fingerprint_v1(v_payload);
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_business_id, p_command_id, 'LINK_EMPLOYEE_WORKER', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  select * into v_existing from public.employee_worker_links where worker_id = p_worker_id;
  if found then
    if v_existing.employee_id = p_employee_id and v_existing.shop_id = p_shop_id then
      v_result := jsonb_build_object('ok', true, 'replayed', true, 'linkId', v_existing.id);
      perform private.store_workforce_command_receipt_v1(v_business_id, p_command_id, 'LINK_EMPLOYEE_WORKER', v_fingerprint, v_result);
      return v_result;
    end if;
    return jsonb_build_object('ok', false, 'code', 'worker_already_linked');
  end if;
  if exists (select 1 from public.employee_worker_links where employee_id = p_employee_id and shop_id = p_shop_id and active) then
    return jsonb_build_object('ok', false, 'code', 'employee_shop_already_linked');
  end if;

  if v_employee.pin_hash is not null and v_employee.pin_lookup_hash is not null then
    perform pg_advisory_xact_lock(hashtextextended('worker-pin:' || p_shop_id::text || ':' || v_employee.pin_lookup_hash, 0));
    if exists (
      select 1 from public.workers w
      where w.shop_id = p_shop_id and w.id <> p_worker_id and w.active
        and w.pin_lookup_hash = v_employee.pin_lookup_hash
    ) then return jsonb_build_object('ok', false, 'code', 'pin_already_in_use'); end if;
    update public.workers
    set pin_hash = v_employee.pin_hash,
        pin_lookup_hash = v_employee.pin_lookup_hash,
        credential_version = credential_version + 1,
        updated_at = now()
    where id = p_worker_id;
  end if;

  insert into public.employee_worker_links(
    business_id, employee_id, shop_id, worker_id, linked_by_employee_id, link_command_id
  ) values (v_business_id, p_employee_id, p_shop_id, p_worker_id, p_actor_employee_id, p_command_id)
  returning id into v_existing.id;
  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_WORKER_LINKED',
    'BUSINESS_EMPLOYEE', p_employee_id::text, null,
    jsonb_build_object('employeeId', p_employee_id, 'shopId', p_shop_id, 'workerId', p_worker_id, 'credentialSynchronized', v_employee.pin_hash is not null and v_employee.pin_lookup_hash is not null),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  v_result := jsonb_build_object('ok', true, 'replayed', false, 'linkId', v_existing.id);
  perform private.store_workforce_command_receipt_v1(v_business_id, p_command_id, 'LINK_EMPLOYEE_WORKER', v_fingerprint, v_result);
  return v_result;
end;
$$;

revoke all on function public.link_employee_worker_v1(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.link_employee_worker_v1(uuid, uuid, uuid, uuid, text) to service_role;
