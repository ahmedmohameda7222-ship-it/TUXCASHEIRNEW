-- TUX Admin Plan 2 durable catalog scheduler lease boundary.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.
-- The lease prevents duplicate execution while allowing a crashed worker claim to be reclaimed.

alter table public.scheduled_config_changes
  add column if not exists result_json jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'scheduled_config_changes_result_terminal_ck'
      and conrelid = 'public.scheduled_config_changes'::regclass
  ) then
    alter table public.scheduled_config_changes
      add constraint scheduled_config_changes_result_terminal_ck
      check (result_json is null or status = 'APPLIED');
  end if;
end $$;

create or replace function public.claim_due_admin_config_changes_v1(
  p_now timestamptz default now(),
  p_limit integer default 25,
  p_lease_seconds integer default 300
)
returns table (
  id uuid,
  business_id uuid,
  shop_id uuid,
  created_by_employee_id uuid,
  change_kind text,
  payload_json jsonb,
  scheduled_for timestamptz,
  target_base_publish_version bigint,
  idempotency_key text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_now is null then
    raise exception 'TUX_ADMIN_SCHEDULER_NOW_REQUIRED';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'TUX_ADMIN_SCHEDULER_LIMIT_INVALID';
  end if;
  if p_lease_seconds is null or p_lease_seconds < 30 or p_lease_seconds > 3600 then
    raise exception 'TUX_ADMIN_SCHEDULER_LEASE_INVALID';
  end if;

  return query
  with candidates as (
    select s.id
    from public.scheduled_config_changes s
    where s.change_kind in ('CATALOG_PUBLISH', 'PRODUCT_AVAILABILITY')
      and s.scheduled_for <= p_now
      and (
        s.status in ('PENDING', 'FAILED')
        or (
          s.status = 'CLAIMED'
          and s.claimed_at is not null
          and s.claimed_at <= p_now - make_interval(secs => p_lease_seconds)
        )
      )
    order by s.scheduled_for, s.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.scheduled_config_changes s
    set status = 'CLAIMED',
        claimed_at = p_now,
        attempt_count = s.attempt_count + 1,
        updated_at = p_now
    from candidates c
    where s.id = c.id
    returning
      s.id,
      s.business_id,
      s.shop_id,
      s.created_by_employee_id,
      s.change_kind,
      s.payload_json,
      s.scheduled_for,
      s.target_base_publish_version,
      s.idempotency_key,
      s.attempt_count
  )
  select
    c.id,
    c.business_id,
    c.shop_id,
    c.created_by_employee_id,
    c.change_kind,
    c.payload_json,
    c.scheduled_for,
    c.target_base_publish_version,
    c.idempotency_key,
    c.attempt_count
  from claimed c
  order by c.scheduled_for, c.id;
end;
$$;

create or replace function public.mark_admin_config_change_applied_v1(
  p_id uuid,
  p_idempotency_key text,
  p_attempt_count integer,
  p_result jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if p_id is null
     or nullif(btrim(p_idempotency_key), '') is null
     or p_attempt_count is null
     or p_attempt_count < 1 then
    return false;
  end if;

  update public.scheduled_config_changes s
  set status = 'APPLIED',
      applied_at = now(),
      claimed_at = null,
      last_error = null,
      result_json = p_result,
      updated_at = now()
  where s.id = p_id
    and s.idempotency_key = p_idempotency_key
    and s.status = 'CLAIMED'
    and s.attempt_count = p_attempt_count;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

create or replace function public.mark_admin_config_change_failed_v1(
  p_id uuid,
  p_idempotency_key text,
  p_attempt_count integer,
  p_error text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
begin
  if p_id is null
     or nullif(btrim(p_idempotency_key), '') is null
     or p_attempt_count is null
     or p_attempt_count < 1 then
    return false;
  end if;

  update public.scheduled_config_changes s
  set status = 'FAILED',
      claimed_at = null,
      applied_at = null,
      result_json = null,
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'catalog_scheduler_execution_failed'), 2000),
      updated_at = now()
  where s.id = p_id
    and s.idempotency_key = p_idempotency_key
    and s.status = 'CLAIMED'
    and s.attempt_count = p_attempt_count;

  get diagnostics v_updated = row_count;
  return v_updated = 1;
end;
$$;

revoke all on function public.claim_due_admin_config_changes_v1(timestamptz, integer, integer)
  from public, anon, authenticated;
revoke all on function public.mark_admin_config_change_applied_v1(uuid, text, integer, jsonb)
  from public, anon, authenticated;
revoke all on function public.mark_admin_config_change_failed_v1(uuid, text, integer, text)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.claim_due_admin_config_changes_v1(timestamptz, integer, integer)
      to service_role;
    grant execute on function public.mark_admin_config_change_applied_v1(uuid, text, integer, jsonb)
      to service_role;
    grant execute on function public.mark_admin_config_change_failed_v1(uuid, text, integer, text)
      to service_role;
  end if;
end $$;