-- TUX V2 PR #119: forward-only security parity of two verified deployed drifts.
-- Old hardening SQL is NOT replayed; only these exact function definitions are
-- restored to the vetted approved Plan 6 behavior. No data or table changes.
-- create_employee_v1: privileged role creation must use employee.role approvals.
-- workforce_worker_state_fingerprint_v1: include linked inactive workers so a
-- suspended Operations identity cannot evade credential-version fencing.
-- Tested against complete isolated PostgreSQL migration chain before deployment.

create or replace function private.workforce_worker_state_fingerprint_v1(
  p_employee_id uuid,
  p_target_shop_ids uuid[]
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, private, extensions
as $$
  select encode(
    extensions.digest(
      convert_to(
        coalesce(
          string_agg(
            concat_ws(
              ':',
              w.shop_id::text,
              w.id::text,
              w.active::text,
              w.pin_hash,
              coalesce(w.pin_lookup_hash, ''),
              w.credential_version::text,
              coalesce(l.employee_id::text, '')
            ),
            '|' order by w.shop_id, w.id
          ),
          ''
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.workers w
  left join public.employee_worker_links l
    on l.worker_id = w.id
   and l.active
  where w.shop_id = any(p_target_shop_ids)
    and (w.active or l.employee_id = p_employee_id)
$$;

revoke all on function private.workforce_worker_state_fingerprint_v1(
  uuid,uuid[]
) from public,anon,authenticated;

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

  -- Elevated roles are mutations of privilege and must flow through the
  -- approval-routed employee.role command. New identities start as STAFF.
  if p_role <> 'STAFF' then
    return jsonb_build_object('ok', false, 'code', 'initial_role_requires_promotion');
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

revoke all on function public.create_employee_v1(
  uuid,uuid,text,text,date,text,text,text
) from public,anon,authenticated;
grant execute on function public.create_employee_v1(
  uuid,uuid,text,text,date,text,text,text
) to service_role;
