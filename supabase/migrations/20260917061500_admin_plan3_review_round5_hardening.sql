-- admin_plan3_review_round5_hardening
-- Additive Plan 3 hardening for final review round 5. Do not edit already-applied Plan 3 migrations.

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

  if v_value ~ '(^|[^a-z0-9])(password|verifier|salt|lookup|token)([[:space:][:punct:]]+(is|to|as|equals?))?([[:space:][:punct:]]{1,8})([^[:space:],;]{4,})' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function private.admin_text_contains_secret_v1(text)
  from public, anon, authenticated;

create or replace function public.list_admin_audit_actor_options_v1(
  p_business_id uuid,
  p_shop_ids uuid[]
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
    and (p_shop_ids is null or e.shop_id = any(p_shop_ids))
  order by be.display_name, e.actor_employee_id;
end;
$$;

revoke all on function public.list_admin_audit_actor_options_v1(uuid, uuid[])
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.list_admin_audit_actor_options_v1(uuid, uuid[])
      to service_role;
  end if;
end $$;
