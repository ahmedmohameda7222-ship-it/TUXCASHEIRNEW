-- admin_plan3_review_round11_hardening
-- Additive Plan 3 hardening for structured credential keys and cursor-aware audit reads.

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
         or v_normalized_key in (
           'api_key', 'client_secret', 'access_key', 'secret_key', 'private_key'
         )
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

create or replace function public.list_admin_audit_events_v3(
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
  p_before_created_at timestamptz,
  p_before_id uuid,
  p_limit integer default 101
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
  if p_limit is null or p_limit < 1 or p_limit > 101 then
    raise exception 'admin_audit_limit_invalid';
  end if;
  if (p_before_created_at is null) <> (p_before_id is null) then
    raise exception 'admin_audit_cursor_invalid';
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
    and (
      p_before_created_at is null
      or e.created_at < p_before_created_at
      or (e.created_at = p_before_created_at and e.id < p_before_id)
    )
  order by e.created_at desc, e.id desc
  limit p_limit;
end;
$$;

revoke all on function public.list_admin_audit_events_v3(
  uuid, uuid[], boolean, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, uuid, timestamptz, uuid, integer
) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.list_admin_audit_events_v3(
      uuid, uuid[], boolean, uuid, uuid, text, text, text, timestamptz, timestamptz,
      text, uuid, timestamptz, uuid, integer
    ) to service_role;
  end if;
end $$;
