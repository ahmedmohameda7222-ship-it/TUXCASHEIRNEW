-- admin_plan3_review_round2_hardening
-- Additive Plan 3 hardening for review round 2. Do not edit already-applied Plan 3 migrations.

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

  if v_value ~ '(^|[^a-z0-9])(pin|passcode)([^a-z0-9]{1,8})([0-9][0-9[:space:]-]{3,11}[0-9])([^0-9]|$)' then
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

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'admin_approval_requests_secret_safe_reason_ck'
  ) then
    alter table public.admin_approval_requests
      add constraint admin_approval_requests_secret_safe_reason_ck
      check (
        not private.admin_text_contains_secret_v1(reason)
        and not private.admin_text_contains_secret_v1(decision_reason)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'admin_audit_events_secret_safe_reason_ck'
  ) then
    alter table public.admin_audit_events
      add constraint admin_audit_events_secret_safe_reason_ck
      check (not private.admin_text_contains_secret_v1(reason));
  end if;
end $$;

alter function public.append_admin_audit_event_v1(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, jsonb
) rename to append_admin_audit_event_pre_round2_v1;
alter function public.append_admin_audit_event_pre_round2_v1(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, jsonb
) set schema private;

revoke all on function private.append_admin_audit_event_pre_round2_v1(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, jsonb
) from public, anon, authenticated, service_role;

create function public.append_admin_audit_event_v1(
  p_business_id uuid,
  p_shop_id uuid,
  p_actor_employee_id uuid,
  p_action_type text,
  p_entity_type text,
  p_entity_id text,
  p_before_value jsonb,
  p_after_value jsonb,
  p_reason text,
  p_approval_request_id uuid,
  p_session_id uuid,
  p_context_metadata jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_approval_shop_id uuid;
begin
  if private.admin_text_contains_secret_v1(p_reason) then
    raise exception 'admin_audit_secret_reason_forbidden';
  end if;

  if p_approval_request_id is not null then
    select r.shop_id into v_approval_shop_id
    from public.admin_approval_requests r
    where r.id = p_approval_request_id
      and r.business_id = p_business_id;

    if not found then
      raise exception 'admin_audit_approval_invalid';
    end if;

    if v_approval_shop_id is distinct from p_shop_id then
      raise exception 'admin_audit_approval_shop_mismatch';
    end if;
  end if;

  return private.append_admin_audit_event_pre_round2_v1(
    p_business_id,
    p_shop_id,
    p_actor_employee_id,
    p_action_type,
    p_entity_type,
    p_entity_id,
    p_before_value,
    p_after_value,
    p_reason,
    p_approval_request_id,
    p_session_id,
    p_context_metadata
  );
end;
$$;

alter function public.create_admin_approval_request_v1(
  uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text
) rename to create_admin_approval_request_pre_round2_v1;
alter function public.create_admin_approval_request_pre_round2_v1(
  uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text
) set schema private;

revoke all on function private.create_admin_approval_request_pre_round2_v1(
  uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text
) from public, anon, authenticated, service_role;

create function public.create_admin_approval_request_v1(
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
begin
  if private.admin_text_contains_secret_v1(p_reason) then
    return jsonb_build_object('ok', false, 'code', 'secret_reason_forbidden');
  end if;

  return private.create_admin_approval_request_pre_round2_v1(
    p_business_id,
    p_shop_id,
    p_requester_employee_id,
    p_requester_session_id,
    p_rule_id,
    p_action_type,
    p_command_id,
    p_command_payload,
    p_reason
  );
end;
$$;

alter function public.decide_admin_approval_request_v1(
  uuid, uuid, uuid, text, text
) rename to decide_admin_approval_request_pre_round2_v1;
alter function public.decide_admin_approval_request_pre_round2_v1(
  uuid, uuid, uuid, text, text
) set schema private;

revoke all on function private.decide_admin_approval_request_pre_round2_v1(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated, service_role;

create function public.decide_admin_approval_request_v1(
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
begin
  if private.admin_text_contains_secret_v1(p_reason) then
    return jsonb_build_object('ok', false, 'code', 'secret_reason_forbidden');
  end if;

  return private.decide_admin_approval_request_pre_round2_v1(
    p_request_id,
    p_approver_employee_id,
    p_approver_session_id,
    p_decision,
    p_reason
  );
end;
$$;

create or replace function public.list_admin_audit_events_v1(
  p_business_id uuid,
  p_shop_ids uuid[],
  p_shop_id uuid,
  p_actor_employee_id uuid,
  p_action_type text,
  p_entity_type text,
  p_entity_id text,
  p_from timestamptz,
  p_to timestamptz,
  p_approval_status text,
  p_event_id uuid,
  p_limit integer default 100
)
returns table (
  id uuid,
  business_id uuid,
  shop_id uuid,
  actor_kind text,
  actor_employee_id uuid,
  actor_role text,
  requester_employee_id uuid,
  approver_employee_id uuid,
  action_type text,
  entity_type text,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reason text,
  approval_request_id uuid,
  approval_status text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_business_id is null then
    raise exception 'admin_audit_business_required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'admin_audit_limit_invalid';
  end if;
  if p_approval_status is not null
     and upper(btrim(p_approval_status)) not in (
       'PENDING', 'APPROVED', 'REJECTED', 'EXECUTING', 'EXECUTED', 'FAILED'
     ) then
    raise exception 'admin_audit_approval_status_invalid';
  end if;

  return query
  select
    e.id,
    e.business_id,
    e.shop_id,
    e.actor_kind,
    e.actor_employee_id,
    e.actor_role,
    e.requester_employee_id,
    e.approver_employee_id,
    e.action_type,
    e.entity_type,
    e.entity_id,
    e.before_value,
    e.after_value,
    e.reason,
    e.approval_request_id,
    r.status as approval_status,
    e.created_at
  from public.admin_audit_events e
  left join public.admin_approval_requests r
    on r.id = e.approval_request_id
   and r.business_id = e.business_id
  where e.business_id = p_business_id
    and (p_shop_ids is null or e.shop_id = any(p_shop_ids))
    and (p_shop_id is null or e.shop_id = p_shop_id)
    and (p_actor_employee_id is null or e.actor_employee_id = p_actor_employee_id)
    and (p_action_type is null or e.action_type = p_action_type)
    and (p_entity_type is null or e.entity_type = p_entity_type)
    and (p_entity_id is null or e.entity_id = p_entity_id)
    and (p_from is null or e.created_at >= p_from)
    and (p_to is null or e.created_at <= p_to)
    and (p_event_id is null or e.id = p_event_id)
    and (
      p_approval_status is null
      or r.status = upper(btrim(p_approval_status))
    )
  order by e.created_at desc, e.id desc
  limit p_limit;
end;
$$;

revoke all on function public.append_admin_audit_event_v1(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.create_admin_approval_request_v1(
  uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text
) from public, anon, authenticated;
revoke all on function public.decide_admin_approval_request_v1(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.list_admin_audit_events_v1(
  uuid, uuid[], uuid, uuid, text, text, text, timestamptz, timestamptz, text, uuid, integer
) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.append_admin_audit_event_v1(
      uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, jsonb
    ) to service_role;
    grant execute on function public.create_admin_approval_request_v1(
      uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text
    ) to service_role;
    grant execute on function public.decide_admin_approval_request_v1(
      uuid, uuid, uuid, text, text
    ) to service_role;
    grant execute on function public.list_admin_audit_events_v1(
      uuid, uuid[], uuid, uuid, text, text, text, timestamptz, timestamptz, text, uuid, integer
    ) to service_role;
  end if;
end $$;
