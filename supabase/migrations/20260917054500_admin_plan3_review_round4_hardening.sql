-- admin_plan3_review_round4_hardening
-- Additive Plan 3 hardening for final review findings. Do not edit already-applied Plan 3 migrations.

create or replace function private.admin_text_contains_secret_v1(p_value text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, private
as $$
declare
  v_value text;
begin
  if p_value is null or btrim(p_value) = '' then
    return false;
  end if;

  v_value := lower(regexp_replace(p_value, '([a-z0-9])([A-Z])', '\1 \2', 'g'));

  if v_value ~ '(^|[^a-z0-9])(pin|passcode)([[:space:][:punct:]]+(is|to|as|equals?))?([[:space:][:punct:]]{1,8})([0-9]([[:space:]-]?[0-9]){3,11})([^0-9]|$)' then
    return true;
  end if;

  if v_value ~ '(^|[^a-z0-9])(password|verifier|salt|lookup|token)([^a-z0-9]{1,8})([^[:space:],;]{4,})' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function private.admin_text_contains_secret_v1(text)
  from public, anon, authenticated;

alter table public.admin_approval_requests
  drop constraint if exists admin_approval_requests_distinct_approver_ck;

alter table public.admin_approval_requests
  add constraint admin_approval_requests_distinct_approver_ck
  check (
    not requires_second_person
    or approver_employee_id is null
    or approver_employee_id <> requester_employee_id
  );

create or replace function private.decide_admin_approval_request_pre_round2_v1(
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

  if v_request.requires_second_person
     and p_approver_employee_id = v_request.requester_employee_id then
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

revoke all on function private.decide_admin_approval_request_pre_round2_v1(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;
