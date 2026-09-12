-- TUX Admin Plan 2 Codex hardening: bounded retries, terminal failures, and starvation-safe claims.
-- Repository migration only. Do not apply to a remote project during Plans 1-9.

alter table public.scheduled_config_changes
  add column if not exists next_attempt_at timestamptz,
  add column if not exists terminal_failure boolean not null default false;

-- Existing FAILED rows were previously immediately retryable. Preserve compatibility while moving
-- them onto the bounded retry policy instead of silently terminalizing historical work.
update public.scheduled_config_changes
set next_attempt_at = coalesce(next_attempt_at, updated_at, scheduled_for, now())
where status = 'FAILED'
  and terminal_failure = false
  and attempt_count < 5;

update public.scheduled_config_changes
set terminal_failure = true,
    next_attempt_at = null
where status = 'FAILED'
  and attempt_count >= 5;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'scheduled_config_changes_terminal_failure_ck'
      and conrelid = 'public.scheduled_config_changes'::regclass
  ) then
    alter table public.scheduled_config_changes
      add constraint scheduled_config_changes_terminal_failure_ck
      check (not terminal_failure or status = 'FAILED');
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'scheduled_config_changes_retry_state_ck'
      and conrelid = 'public.scheduled_config_changes'::regclass
  ) then
    alter table public.scheduled_config_changes
      add constraint scheduled_config_changes_retry_state_ck
      check (
        status <> 'FAILED'
        or terminal_failure
        or (attempt_count < 5 and next_attempt_at is not null)
      );
  end if;
end $$;

create index if not exists scheduled_config_changes_retry_due_idx
  on public.scheduled_config_changes(next_attempt_at, scheduled_for, id)
  where status = 'FAILED' and terminal_failure = false and attempt_count < 5;

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

  -- A worker that disappeared on its final allowed attempt must not leave a permanently CLAIMED row.
  update public.scheduled_config_changes s
  set status = 'FAILED',
      claimed_at = null,
      terminal_failure = true,
      next_attempt_at = null,
      last_error = coalesce(s.last_error, 'catalog_scheduler_retry_limit_exhausted'),
      updated_at = p_now
  where s.status = 'CLAIMED'
    and s.attempt_count >= 5
    and s.claimed_at is not null
    and s.claimed_at <= p_now - make_interval(secs => p_lease_seconds);

  return query
  with candidates as (
    select s.id
    from public.scheduled_config_changes s
    where s.change_kind in ('CATALOG_PUBLISH', 'PRODUCT_AVAILABILITY')
      and s.scheduled_for <= p_now
      and s.attempt_count < 5
      and (
        s.status = 'PENDING'
        or (
          s.status = 'FAILED'
          and s.terminal_failure = false
          and s.next_attempt_at is not null
          and s.next_attempt_at <= p_now
        )
        or (
          s.status = 'CLAIMED'
          and s.claimed_at is not null
          and s.claimed_at <= p_now - make_interval(secs => p_lease_seconds)
        )
      )
    order by
      case when s.status = 'FAILED' then s.next_attempt_at else s.scheduled_for end,
      s.scheduled_for,
      s.id
    for update skip locked
    limit p_limit
  ), claimed as (
    update public.scheduled_config_changes s
    set status = 'CLAIMED',
        claimed_at = p_now,
        next_attempt_at = null,
        terminal_failure = false,
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
      next_attempt_at = null,
      terminal_failure = false,
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

-- Remove the pre-hardening overload so trusted callers cannot accidentally bypass retry disposition.
drop function if exists public.mark_admin_config_change_failed_v1(uuid, text, integer, text);

create or replace function public.mark_admin_config_change_failed_v1(
  p_id uuid,
  p_idempotency_key text,
  p_attempt_count integer,
  p_error text,
  p_retryable boolean,
  p_now timestamptz
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_updated integer;
  v_will_retry boolean;
  v_backoff_seconds integer;
begin
  if p_id is null
     or nullif(btrim(p_idempotency_key), '') is null
     or p_attempt_count is null
     or p_attempt_count < 1
     or p_retryable is null
     or p_now is null then
    return false;
  end if;

  v_will_retry := p_retryable and p_attempt_count < 5;
  v_backoff_seconds := least(900, (30 * power(2, greatest(p_attempt_count - 1, 0)))::integer);

  update public.scheduled_config_changes s
  set status = 'FAILED',
      claimed_at = null,
      applied_at = null,
      result_json = null,
      terminal_failure = not v_will_retry,
      next_attempt_at = case
        when v_will_retry then p_now + make_interval(secs => v_backoff_seconds)
        else null
      end,
      last_error = left(coalesce(nullif(btrim(p_error), ''), 'catalog_scheduler_execution_failed'), 2000),
      updated_at = p_now
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
revoke all on function public.mark_admin_config_change_failed_v1(uuid, text, integer, text, boolean, timestamptz)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.claim_due_admin_config_changes_v1(timestamptz, integer, integer)
      to service_role;
    grant execute on function public.mark_admin_config_change_applied_v1(uuid, text, integer, jsonb)
      to service_role;
    grant execute on function public.mark_admin_config_change_failed_v1(uuid, text, integer, text, boolean, timestamptz)
      to service_role;
  end if;
end $$;
