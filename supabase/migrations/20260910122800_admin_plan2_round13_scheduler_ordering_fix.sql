-- TUX Admin Plan 2 round 13 scheduler ordering fix.
-- Preserve the latest recurring-availability dependency semantics while extending claims to SHOP_CONFIG.

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
    select
      s.id,
      case
        when s.change_kind = 'PRODUCT_AVAILABILITY'
          and s.payload_json ->> 'transition' = 'EXIT' then 0
        when s.change_kind = 'PRODUCT_AVAILABILITY'
          and s.payload_json ->> 'transition' = 'ENTER' then 1
        else 0
      end as transition_priority
    from public.scheduled_config_changes s
    where s.change_kind in ('CATALOG_PUBLISH', 'PRODUCT_AVAILABILITY', 'SHOP_CONFIG')
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
      and (
        s.change_kind <> 'PRODUCT_AVAILABILITY'
        or s.payload_json ->> 'transition' <> 'ENTER'
        or not exists (
          select 1
          from public.scheduled_config_changes predecessor
          where predecessor.shop_id = s.shop_id
            and predecessor.change_kind = 'PRODUCT_AVAILABILITY'
            and predecessor.scheduled_for <= s.scheduled_for
            and predecessor.payload_json ->> 'transition' = 'EXIT'
            and predecessor.payload_json ->> 'masterProductId' = s.payload_json ->> 'masterProductId'
            and predecessor.status not in ('APPLIED', 'CANCELLED')
        )
      )
    order by
      case when s.status = 'FAILED' then s.next_attempt_at else s.scheduled_for end,
      s.scheduled_for,
      transition_priority,
      s.id
    for update of s skip locked
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
  order by
    c.scheduled_for,
    case
      when c.change_kind = 'PRODUCT_AVAILABILITY'
        and c.payload_json ->> 'transition' = 'EXIT' then 0
      when c.change_kind = 'PRODUCT_AVAILABILITY'
        and c.payload_json ->> 'transition' = 'ENTER' then 1
      else 0
    end,
    c.id;
end;
$$;

revoke all on function public.claim_due_admin_config_changes_v1(timestamptz, integer, integer)
  from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.claim_due_admin_config_changes_v1(timestamptz, integer, integer)
      to service_role;
  end if;
end $$;
