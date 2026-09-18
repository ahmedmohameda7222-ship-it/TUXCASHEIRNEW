-- admin_plan3_review_round8_hardening
-- Additive Plan 3 hardening for final review round 8. Do not edit already-applied migrations.

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

  -- Support compact disclosures such as PIN4827/passcode1234 as well as narrative separators.
  if v_value ~ '(^|[^a-z0-9])(pin|passcode)([^0-9]{0,32})([0-9]([[:space:]-]?[0-9]){3,11})([^0-9]|$)' then
    return true;
  end if;

  if v_value ~ '(^|[^a-z0-9])(password|verifier|lookup|token)([^a-z0-9]|$)' then
    return true;
  end if;

  if v_value ~ '(^|[^a-z0-9])salt((([[:space:][:punct:]]+)(is|was|were|to|as|equals?)([[:space:][:punct:]]{1,8}))|([[:punct:]]{1,8}[[:space:]]*))([^[:space:],;]{4,})' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function private.admin_text_contains_secret_v1(text)
  from public, anon, authenticated;

create or replace function public.list_admin_audit_events_v2(
  p_business_id uuid,
  p_shop_ids uuid[],
  p_include_business_wide boolean,
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
    and (
      p_shop_ids is null
      or e.shop_id = any(p_shop_ids)
      or (coalesce(p_include_business_wide, false) and e.shop_id is null)
    )
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

create or replace function public.list_admin_audit_actor_options_v2(
  p_business_id uuid,
  p_shop_ids uuid[],
  p_include_business_wide boolean
)
returns table (
  employee_id uuid,
  display_name text
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if p_business_id is null then
    raise exception 'admin_audit_business_required';
  end if;

  return query
  select distinct
    e.actor_employee_id,
    be.display_name
  from public.admin_audit_events e
  join public.business_employees be
    on be.business_id = e.business_id
   and be.id = e.actor_employee_id
  where e.business_id = p_business_id
    and e.actor_employee_id is not null
    and (
      p_shop_ids is null
      or e.shop_id = any(p_shop_ids)
      or (coalesce(p_include_business_wide, false) and e.shop_id is null)
    )
  order by be.display_name, e.actor_employee_id;
end;
$$;

revoke all on function public.list_admin_audit_events_v2(
  uuid, uuid[], boolean, uuid, uuid, text, text, text, timestamptz, timestamptz, text, uuid, integer
) from public, anon, authenticated;
revoke all on function public.list_admin_audit_actor_options_v2(uuid, uuid[], boolean)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.list_admin_audit_events_v2(
      uuid, uuid[], boolean, uuid, uuid, text, text, text, timestamptz, timestamptz, text, uuid, integer
    ) to service_role;
    grant execute on function public.list_admin_audit_actor_options_v2(uuid, uuid[], boolean)
      to service_role;
  end if;
end $$;