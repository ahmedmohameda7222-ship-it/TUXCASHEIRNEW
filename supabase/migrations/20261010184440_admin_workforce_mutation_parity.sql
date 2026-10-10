-- Forward-only reviewed Workforce PIN and schedule/leave mutation scope parity.
-- Update only live RPCs whose global target scope still omitted hardening.

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
  where business_id = v_business_id
    and command_id = p_command_id
  for update;
  if found then
    if v_existing.employee_id <> p_employee_id
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
revoke all on function public.stage_employee_pin_change_v1(
  uuid, uuid, uuid[], text, text, bigint, text, timestamptz, uuid
) from public, anon, authenticated;
grant execute on function public.stage_employee_pin_change_v1(
  uuid, uuid, uuid[], text, text, bigint, text, timestamptz, uuid
) to service_role;

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
revoke all on function public.apply_employee_pin_change_v1(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.apply_employee_pin_change_v1(uuid, uuid)
  to service_role;

create or replace function public.copy_previous_week_shifts_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_target_week_start date,
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
  v_count integer;
  v_previous_start timestamptz;
  v_target_start timestamptz;
begin
  if p_target_week_start is null or extract(isodow from p_target_week_start) <> 1
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_copy_week');
  end if;
  select * into v_auth from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden')); end if;
  v_business_id := v_auth.business_id;
  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required'); end if;

  v_previous_start := ((p_target_week_start - 7)::timestamp at time zone 'Africa/Cairo');
  v_target_start := (p_target_week_start::timestamp at time zone 'Africa/Cairo');
  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'shopId', p_shop_id, 'targetWeekStart', p_target_week_start
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_business_id, p_command_id, 'COPY_PREVIOUS_WEEK_SHIFTS', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  insert into public.employee_shifts(
    business_id, employee_id, shop_id, starts_at, ends_at, planned_break_minutes,
    status, source_shift_id, created_by_employee_id, updated_by_employee_id, create_command_id
  )
  select
    s.business_id, s.employee_id, s.shop_id,
    ((s.starts_at at time zone 'Africa/Cairo') + interval '7 days') at time zone 'Africa/Cairo',
    ((s.ends_at at time zone 'Africa/Cairo') + interval '7 days') at time zone 'Africa/Cairo',
    s.planned_break_minutes, 'SCHEDULED', s.id,
    p_actor_employee_id, p_actor_employee_id, p_command_id || ':' || s.id::text
  from public.employee_shifts s
  where s.business_id = v_business_id and s.employee_id = p_employee_id and s.shop_id = p_shop_id
    and s.status <> 'CANCELLED' and s.starts_at >= v_previous_start and s.starts_at < v_target_start
  on conflict (source_shift_id, starts_at) where source_shift_id is not null do nothing;

  get diagnostics v_count = row_count;
  v_result := jsonb_build_object('ok', true, 'replayed', false, 'copiedCount', v_count, 'targetWeekStart', p_target_week_start);
  perform private.store_workforce_command_receipt_v1(v_business_id, p_command_id, 'COPY_PREVIOUS_WEEK_SHIFTS', v_fingerprint, v_result);
  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_SHIFTS_COPIED',
    'BUSINESS_EMPLOYEE', p_employee_id::text, null,
    jsonb_build_object('targetWeekStart', p_target_week_start, 'copiedCount', v_count),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;
revoke all on function public.copy_previous_week_shifts_v1(uuid, uuid, uuid, date, text) from public, anon, authenticated;
grant execute on function public.copy_previous_week_shifts_v1(uuid, uuid, uuid, date, text) to service_role;

create or replace function public.create_leave_request_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_leave_type text,
  p_starts_on date,
  p_ends_on date,
  p_note text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_auth record;
  v_actor public.business_employees%rowtype;
  v_target public.business_employees%rowtype;
  v_business_id uuid;
  v_existing public.leave_requests%rowtype;
  v_id uuid;
  v_fingerprint text;
begin
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then return jsonb_build_object('ok', false, 'code', 'invalid_leave_range'); end if;
  if p_leave_type not in ('VACATION','SICK','UNPAID','OTHER') or nullif(btrim(p_command_id), '') is null then return jsonb_build_object('ok', false, 'code', 'invalid_leave_request'); end if;

  select * into v_target from public.business_employees where id = p_employee_id;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  v_business_id := v_target.business_id;

  if p_shop_id is null then
    select * into v_actor from public.business_employees where id = p_actor_employee_id and business_id = v_business_id and active;
    if not found or v_actor.role not in ('OWNER','ADMIN') then return jsonb_build_object('ok', false, 'code', 'business_scope_forbidden'); end if;
    select * into v_auth from public.resolve_admin_authorization_v1(p_actor_employee_id, null, 'staff.manage');
    if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_business_id then return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden')); end if;
    if not exists (select 1 from public.employee_shop_assignments where business_id = v_business_id and employee_id = p_employee_id) then return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required'); end if;
  else
    select * into v_auth from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
    if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_business_id then return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden')); end if;
    if not exists (select 1 from public.employee_shop_assignments where business_id = v_business_id and employee_id = p_employee_id and shop_id = p_shop_id) then return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required'); end if;
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'shopId', p_shop_id, 'leaveType', p_leave_type,
    'startsOn', p_starts_on, 'endsOn', p_ends_on, 'note', p_note
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':leave:' || p_command_id, 0));
  select * into v_existing from public.leave_requests where business_id = v_business_id and request_command_id = p_command_id;
  if found then
    if private.workforce_fingerprint_v1(jsonb_build_object(
      'employeeId', v_existing.employee_id, 'shopId', v_existing.shop_id, 'leaveType', v_existing.leave_type,
      'startsOn', v_existing.starts_on, 'endsOn', v_existing.ends_on, 'note', v_existing.note
    )) <> v_fingerprint then return jsonb_build_object('ok', false, 'code', 'leave_command_conflict'); end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'leaveRequestId', v_existing.id, 'status', v_existing.status, 'version', v_existing.version);
  end if;

  insert into public.leave_requests(
    business_id, employee_id, shop_id, leave_type, starts_on, ends_on, note, requester_employee_id, request_command_id
  ) values (
    v_business_id, p_employee_id, p_shop_id, p_leave_type, p_starts_on, p_ends_on,
    nullif(btrim(p_note), ''), p_actor_employee_id, p_command_id
  ) returning id into v_id;
  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id, 'LEAVE_REQUEST_CREATED', 'LEAVE_REQUEST', v_id::text, null,
    jsonb_build_object('employeeId', p_employee_id, 'leaveType', p_leave_type, 'startsOn', p_starts_on, 'endsOn', p_ends_on),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'leaveRequestId', v_id, 'status', 'PENDING', 'version', 1);
end;
$$;
revoke all on function public.create_leave_request_v1(uuid, uuid, uuid, text, date, date, text, text) from public, anon, authenticated;
grant execute on function public.create_leave_request_v1(uuid, uuid, uuid, text, date, date, text, text) to service_role;

create or replace function public.decide_leave_request_v1(
  p_actor_employee_id uuid,
  p_leave_request_id uuid,
  p_expected_version bigint,
  p_decision text,
  p_reason text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_request public.leave_requests%rowtype;
  v_actor public.business_employees%rowtype;
  v_auth record;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_request from public.leave_requests where id = p_leave_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'leave_request_not_found'); end if;
  if p_decision not in ('APPROVED','REJECTED') or p_expected_version is null or p_expected_version <= 0 or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_leave_decision');
  end if;

  if v_request.shop_id is null then
    select * into v_actor from public.business_employees where id = p_actor_employee_id and business_id = v_request.business_id and active;
    if not found or v_actor.role not in ('OWNER','ADMIN') then return jsonb_build_object('ok', false, 'code', 'business_scope_forbidden'); end if;
    select * into v_auth from public.resolve_admin_authorization_v1(p_actor_employee_id, null, 'staff.manage');
  else
    select * into v_auth from public.resolve_admin_authorization_v1(p_actor_employee_id, v_request.shop_id, 'staff.manage');
  end if;
  if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_request.business_id then return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden')); end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'leaveRequestId', p_leave_request_id, 'expectedVersion', p_expected_version, 'decision', p_decision, 'reason', p_reason
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_request.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_request.business_id, p_command_id, 'DECIDE_LEAVE_REQUEST', v_fingerprint);
  if v_replay is not null then return v_replay; end if;
  if v_request.status <> 'PENDING' then return jsonb_build_object('ok', false, 'code', 'leave_already_decided'); end if;
  if v_request.version <> p_expected_version then return jsonb_build_object('ok', false, 'code', 'stale_leave_request'); end if;

  update public.leave_requests
  set status = p_decision, decided_by_employee_id = p_actor_employee_id, decision_reason = nullif(btrim(p_reason), ''),
      decided_at = now(), decision_command_id = p_command_id, version = version + 1, updated_at = now()
  where id = p_leave_request_id;
  v_result := jsonb_build_object('ok', true, 'replayed', false, 'leaveRequestId', p_leave_request_id, 'status', p_decision, 'version', p_expected_version + 1);
  perform private.store_workforce_command_receipt_v1(v_request.business_id, p_command_id, 'DECIDE_LEAVE_REQUEST', v_fingerprint, v_result);
  perform public.append_admin_audit_event_v1(
    v_request.business_id, v_request.shop_id, p_actor_employee_id, 'LEAVE_REQUEST_DECIDED', 'LEAVE_REQUEST', p_leave_request_id::text,
    jsonb_build_object('status', v_request.status, 'version', v_request.version), jsonb_build_object('status', p_decision, 'version', p_expected_version + 1),
    nullif(btrim(p_reason), ''), null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;
revoke all on function public.decide_leave_request_v1(uuid, uuid, bigint, text, text, text) from public, anon, authenticated;
grant execute on function public.decide_leave_request_v1(uuid, uuid, bigint, text, text, text) to service_role;
