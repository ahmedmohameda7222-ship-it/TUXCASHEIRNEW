-- admin_plan3_review_hardening
-- Additive Plan 3 hardening after production deployment of the approvals/audit foundation.
-- Preserve browser-deny boundaries while closing secret-key, business-wide authority,
-- concurrent command-id creation, and final-lease ambiguity gaps.

create or replace function private.admin_json_contains_secret_key_v1(p_value jsonb)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, private
as $$
declare
  v_key text;
  v_child jsonb;
  v_normalized_key text;
  v_collapsed_key text;
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      v_normalized_key := lower(
        replace(
          replace(
            regexp_replace(v_key, '([a-z0-9])([A-Z])', '\1_\2', 'g'),
            '-',
            '_'
          ),
          ' ',
          '_'
        )
      );
      v_collapsed_key := replace(v_normalized_key, '_', '');

      if v_normalized_key ~ '(^|_)(pin|password|passcode|verifier|salt|lookup|token)(_|$)'
         or v_collapsed_key in (
           'pinhash', 'pinlookuphash', 'pinverifier', 'pinsalt',
           'passwordhash', 'passwordverifier', 'claimtoken'
         ) then
        return true;
      end if;

      if private.admin_json_contains_secret_key_v1(v_child) then
        return true;
      end if;
    end loop;
  elsif jsonb_typeof(p_value) = 'array' then
    for v_child in select value from jsonb_array_elements(p_value)
    loop
      if private.admin_json_contains_secret_key_v1(v_child) then
        return true;
      end if;
    end loop;
  end if;

  return false;
end;
$$;

revoke all on function private.admin_json_contains_secret_key_v1(jsonb)
  from public, anon, authenticated;

create or replace function public.create_admin_approval_request_v1(
  p_business_id uuid,
  p_shop_id uuid,
  p_requester_employee_id uuid,
  p_requester_session_id uuid,
  p_rule_id uuid,
  p_action_type text,
  p_command_id uuid,
  p_command_payload jsonb,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_rule public.admin_approval_rules%rowtype;
  v_auth record;
  v_existing public.admin_approval_requests%rowtype;
  v_request_id uuid;
begin
  if p_business_id is null
     or p_requester_employee_id is null
     or p_rule_id is null
     or p_command_id is null
     or nullif(btrim(p_action_type), '') is null
     or p_command_payload is null
     or jsonb_typeof(p_command_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_approval_request');
  end if;

  if private.admin_json_contains_secret_key_v1(p_command_payload) then
    return jsonb_build_object('ok', false, 'code', 'secret_payload_forbidden');
  end if;

  select * into v_rule
  from public.admin_approval_rules r
  where r.id = p_rule_id
    and r.business_id = p_business_id
    and r.active
  for update;

  if not found
     or v_rule.action_type <> btrim(p_action_type)
     or (v_rule.shop_id is not null and v_rule.shop_id is distinct from p_shop_id) then
    return jsonb_build_object('ok', false, 'code', 'approval_rule_missing_or_mismatched');
  end if;

  if p_shop_id is null and not exists (
    select 1
    from public.business_employees e
    where e.id = p_requester_employee_id
      and e.business_id = p_business_id
      and e.active
      and e.role in ('OWNER', 'ADMIN')
  ) then
    return jsonb_build_object('ok', false, 'code', 'approval_shop_scope_forbidden');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(
    p_requester_employee_id,
    p_shop_id,
    v_rule.requester_permission
  );

  if not coalesce(v_auth.authorized, false)
     or v_auth.business_id is distinct from p_business_id then
    return jsonb_build_object(
      'ok', false,
      'code', coalesce(v_auth.denial_code, 'requester_not_authorized')
    );
  end if;

  if p_requester_session_id is not null and not exists (
    select 1 from public.admin_sessions s
    where s.id = p_requester_session_id
      and s.business_id = p_business_id
      and s.employee_id = p_requester_employee_id
      and s.revoked_at is null
      and s.expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'code', 'requester_session_invalid');
  end if;

  insert into public.admin_approval_requests(
    business_id,
    shop_id,
    approval_rule_id,
    requester_employee_id,
    requester_session_id,
    action_type,
    command_id,
    command_payload,
    threshold_context,
    reason,
    required_approver_permission,
    requires_second_person,
    status,
    expires_at
  ) values (
    p_business_id,
    p_shop_id,
    p_rule_id,
    p_requester_employee_id,
    p_requester_session_id,
    btrim(p_action_type),
    p_command_id,
    p_command_payload,
    v_rule.threshold_context,
    nullif(btrim(p_reason), ''),
    v_rule.approver_permission,
    v_rule.requires_second_person,
    'PENDING',
    now() + make_interval(secs => v_rule.expires_after_seconds)
  )
  on conflict (business_id, command_id) do nothing
  returning id into v_request_id;

  if v_request_id is null then
    select * into v_existing
    from public.admin_approval_requests r
    where r.business_id = p_business_id
      and r.command_id = p_command_id;

    if not found then
      raise exception 'approval_command_id_conflict_without_winner';
    end if;

    if v_existing.shop_id is not distinct from p_shop_id
       and v_existing.approval_rule_id = p_rule_id
       and v_existing.requester_employee_id = p_requester_employee_id
       and v_existing.action_type = btrim(p_action_type)
       and v_existing.command_payload = p_command_payload then
      return jsonb_build_object(
        'ok', true,
        'requestId', v_existing.id,
        'status', v_existing.status,
        'idempotentReplay', true
      );
    end if;

    return jsonb_build_object('ok', false, 'code', 'command_id_conflict');
  end if;

  perform public.append_admin_audit_event_v1(
    p_business_id,
    p_shop_id,
    p_requester_employee_id,
    'APPROVAL_REQUESTED',
    'APPROVAL_REQUEST',
    v_request_id::text,
    null,
    jsonb_build_object(
      'status', 'PENDING',
      'actionType', btrim(p_action_type),
      'commandId', p_command_id
    ),
    p_reason,
    v_request_id,
    p_requester_session_id,
    jsonb_build_object('source', 'admin_bff')
  );

  return jsonb_build_object(
    'ok', true,
    'requestId', v_request_id,
    'status', 'PENDING',
    'idempotentReplay', false
  );
end;
$$;

create or replace function public.decide_admin_approval_request_v1(
  p_request_id uuid,
  p_approver_employee_id uuid,
  p_approver_session_id uuid,
  p_decision text,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_request public.admin_approval_requests%rowtype;
  v_auth record;
  v_decision text;
begin
  v_decision := upper(coalesce(btrim(p_decision), ''));

  if p_request_id is null
     or p_approver_employee_id is null
     or v_decision not in ('APPROVE', 'REJECT') then
    return jsonb_build_object('ok', false, 'code', 'invalid_approval_decision');
  end if;

  select * into v_request
  from public.admin_approval_requests r
  where r.id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'approval_request_not_found');
  end if;

  if v_request.status <> 'PENDING' then
    return jsonb_build_object(
      'ok', false,
      'code', 'approval_already_decided',
      'status', v_request.status
    );
  end if;

  if v_request.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'approval_expired');
  end if;

  if p_approver_employee_id = v_request.requester_employee_id then
    return jsonb_build_object('ok', false, 'code', 'self_approval_forbidden');
  end if;

  if v_request.shop_id is null and not exists (
    select 1
    from public.business_employees e
    where e.id = p_approver_employee_id
      and e.business_id = v_request.business_id
      and e.active
      and e.role in ('OWNER', 'ADMIN')
  ) then
    return jsonb_build_object('ok', false, 'code', 'approval_shop_scope_forbidden');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(
    p_approver_employee_id,
    v_request.shop_id,
    v_request.required_approver_permission
  );

  if not coalesce(v_auth.authorized, false)
     or v_auth.business_id is distinct from v_request.business_id then
    return jsonb_build_object(
      'ok', false,
      'code', coalesce(v_auth.denial_code, 'approver_not_authorized')
    );
  end if;

  if p_approver_session_id is not null and not exists (
    select 1 from public.admin_sessions s
    where s.id = p_approver_session_id
      and s.business_id = v_request.business_id
      and s.employee_id = p_approver_employee_id
      and s.revoked_at is null
      and s.expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'code', 'approver_session_invalid');
  end if;

  if v_decision = 'REJECT' then
    update public.admin_approval_requests
    set status = 'REJECTED',
        approver_employee_id = p_approver_employee_id,
        approver_session_id = p_approver_session_id,
        decision_reason = nullif(btrim(p_reason), ''),
        decided_at = now(),
        updated_at = now()
    where id = p_request_id;
  else
    update public.admin_approval_requests
    set status = 'APPROVED',
        approver_employee_id = p_approver_employee_id,
        approver_session_id = p_approver_session_id,
        decision_reason = nullif(btrim(p_reason), ''),
        decided_at = now(),
        updated_at = now()
    where id = p_request_id;

    insert into public.admin_approval_execution_jobs(
      approval_request_id,
      business_id,
      command_id,
      state,
      attempt_count,
      created_at,
      updated_at
    ) values (
      p_request_id,
      v_request.business_id,
      v_request.command_id,
      'READY',
      0,
      now(),
      now()
    )
    on conflict (command_id) do nothing;

    if not exists (
      select 1
      from public.admin_approval_execution_jobs j
      where j.approval_request_id = p_request_id
        and j.business_id = v_request.business_id
        and j.command_id = v_request.command_id
    ) then
      raise exception 'approval_execution_job_conflict';
    end if;
  end if;

  perform public.append_admin_audit_event_v1(
    v_request.business_id,
    v_request.shop_id,
    p_approver_employee_id,
    case when v_decision = 'APPROVE'
      then 'APPROVAL_APPROVED'
      else 'APPROVAL_REJECTED'
    end,
    'APPROVAL_REQUEST',
    p_request_id::text,
    jsonb_build_object('status', 'PENDING'),
    jsonb_build_object(
      'status', case when v_decision = 'APPROVE' then 'APPROVED' else 'REJECTED' end,
      'commandId', v_request.command_id
    ),
    p_reason,
    p_request_id,
    p_approver_session_id,
    jsonb_build_object('source', 'admin_bff')
  );

  return jsonb_build_object(
    'ok', true,
    'requestId', p_request_id,
    'status', case when v_decision = 'APPROVE' then 'APPROVED' else 'REJECTED' end,
    'executionQueued', v_decision = 'APPROVE'
  );
end;
$$;

create or replace function public.claim_admin_approval_execution_v1(
  p_worker_id text,
  p_now timestamptz default now(),
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns table (
  approval_request_id uuid,
  business_id uuid,
  shop_id uuid,
  requester_employee_id uuid,
  approver_employee_id uuid,
  action_type text,
  command_id uuid,
  command_payload jsonb,
  claim_token text,
  attempt_count integer,
  lease_expires_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if nullif(btrim(p_worker_id), '') is null then
    raise exception 'approval_executor_worker_required';
  end if;
  if p_now is null then
    raise exception 'approval_executor_now_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'approval_executor_limit_invalid';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 900 then
    raise exception 'approval_executor_lease_invalid';
  end if;

  return query
  with candidates as (
    select
      j.approval_request_id,
      j.state as previous_state,
      j.attempt_count as previous_attempt_count,
      gen_random_uuid()::text as issued_claim_token
    from public.admin_approval_execution_jobs j
    join public.admin_approval_requests r
      on r.id = j.approval_request_id
     and r.business_id = j.business_id
    where r.status in ('APPROVED', 'EXECUTING')
      and (
        (
          j.state = 'READY'
          and j.attempt_count < 5
        )
        or (
          j.state = 'RETRYABLE'
          and j.attempt_count < 5
          and j.next_attempt_at is not null
          and j.next_attempt_at <= p_now
        )
        or (
          j.state = 'CLAIMED'
          and j.attempt_count between 1 and 5
          and j.lease_expires_at is not null
          and j.lease_expires_at <= p_now
        )
      )
    order by
      case
        when j.state = 'RETRYABLE' then j.next_attempt_at
        when j.state = 'CLAIMED' then j.lease_expires_at
        else j.created_at
      end,
      j.approval_request_id
    for update skip locked
    limit p_limit
  ),
  claimed as (
    update public.admin_approval_execution_jobs j
    set state = 'CLAIMED',
        claim_token_hash = encode(
          extensions.digest(c.issued_claim_token, 'sha256'),
          'hex'
        ),
        claimed_by = left(btrim(p_worker_id), 200),
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        attempt_count = case
          when c.previous_state = 'CLAIMED' and c.previous_attempt_count >= 5
            then c.previous_attempt_count
          else c.previous_attempt_count + 1
        end,
        next_attempt_at = null,
        last_error_code = null,
        updated_at = p_now
    from candidates c
    where j.approval_request_id = c.approval_request_id
    returning
      j.approval_request_id,
      j.business_id,
      j.command_id,
      j.attempt_count,
      j.lease_expires_at,
      c.issued_claim_token
  ),
  marked as (
    update public.admin_approval_requests r
    set status = 'EXECUTING',
        updated_at = p_now
    from claimed c
    where r.id = c.approval_request_id
      and r.status in ('APPROVED', 'EXECUTING')
    returning r.id
  )
  select
    c.approval_request_id,
    c.business_id,
    r.shop_id,
    r.requester_employee_id,
    r.approver_employee_id,
    r.action_type,
    c.command_id,
    r.command_payload,
    c.issued_claim_token,
    c.attempt_count,
    c.lease_expires_at
  from claimed c
  join marked m on m.id = c.approval_request_id
  join public.admin_approval_requests r on r.id = c.approval_request_id
  order by c.approval_request_id;
end;
$$;

revoke all on function public.create_admin_approval_request_v1(
  uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text
) from public, anon, authenticated;
revoke all on function public.decide_admin_approval_request_v1(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.claim_admin_approval_execution_v1(
  text, timestamptz, integer, integer
) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.create_admin_approval_request_v1(
      uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text
    ) to service_role;
    grant execute on function public.decide_admin_approval_request_v1(
      uuid, uuid, uuid, text, text
    ) to service_role;
    grant execute on function public.claim_admin_approval_execution_v1(
      text, timestamptz, integer, integer
    ) to service_role;
  end if;
end $$;
