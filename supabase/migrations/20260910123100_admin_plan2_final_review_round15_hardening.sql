-- TUX Admin Plan 2 final review round 15 hardening.
-- Additive only:
-- 1) serialize same-shop SHOP_CONFIG execution in chronological order so retryable predecessors
--    cannot be overtaken by later accepted actions;
-- 2) reject nonexistent or ambiguous Africa/Cairo wall-clock activation times before creating
--    durable one-shot Catalog or SHOP_CONFIG schedules.

create or replace function private.resolve_admin_cairo_schedule_v1(
  p_local_scheduled_at timestamp without time zone
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, public, private
as $$
declare
  v_scheduled_for timestamptz;
begin
  if p_local_scheduled_at is null then
    return jsonb_build_object('ok', false, 'code', 'scheduled_time_required');
  end if;

  v_scheduled_for := p_local_scheduled_at at time zone 'Africa/Cairo';

  -- PostgreSQL normalizes a nonexistent wall-clock time through the DST gap. A strict round trip
  -- must therefore preserve the exact local timestamp before it may be accepted durably.
  if (v_scheduled_for at time zone 'Africa/Cairo') is distinct from p_local_scheduled_at then
    return jsonb_build_object(
      'ok', false,
      'code', 'scheduled_local_time_nonexistent',
      'localScheduledAt', p_local_scheduled_at,
      'timezone', 'Africa/Cairo'
    );
  end if;

  -- Cairo's DST transitions are one hour. If either adjacent UTC instant maps back to the same
  -- wall clock, the local timestamp is repeated and cannot be accepted without an explicit
  -- offset/disambiguation choice. Plan 2 intentionally rejects that ambiguous input.
  if ((v_scheduled_for - interval '1 hour') at time zone 'Africa/Cairo') = p_local_scheduled_at
     or ((v_scheduled_for + interval '1 hour') at time zone 'Africa/Cairo') = p_local_scheduled_at then
    return jsonb_build_object(
      'ok', false,
      'code', 'scheduled_local_time_ambiguous',
      'localScheduledAt', p_local_scheduled_at,
      'timezone', 'Africa/Cairo'
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'scheduledFor', v_scheduled_for,
    'localScheduledAt', p_local_scheduled_at,
    'timezone', 'Africa/Cairo'
  );
end;
$$;

revoke all on function private.resolve_admin_cairo_schedule_v1(timestamp without time zone)
  from public, anon, authenticated;

-- Preserve all established catalog scheduling authorization/reschedule behavior behind a strict
-- wall-clock validation wrapper instead of duplicating the mature scheduling implementation.
alter function public.schedule_catalog_draft_v1(
  uuid, uuid, bigint, bigint, timestamp without time zone
) rename to schedule_catalog_draft_v1_pre_round15;

alter function public.schedule_catalog_draft_v1_pre_round15(
  uuid, uuid, bigint, bigint, timestamp without time zone
) set schema private;

create function public.schedule_catalog_draft_v1(
  p_employee_id uuid,
  p_draft_id uuid,
  p_expected_draft_revision bigint,
  p_expected_base_publish_version bigint,
  p_local_scheduled_at timestamp without time zone
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_schedule_resolution jsonb;
begin
  v_schedule_resolution := private.resolve_admin_cairo_schedule_v1(p_local_scheduled_at);
  if coalesce((v_schedule_resolution ->> 'ok')::boolean, false) is not true then
    return v_schedule_resolution;
  end if;

  return private.schedule_catalog_draft_v1_pre_round15(
    p_employee_id,
    p_draft_id,
    p_expected_draft_revision,
    p_expected_base_publish_version,
    p_local_scheduled_at
  );
end;
$$;

revoke all on function public.schedule_catalog_draft_v1(
  uuid, uuid, bigint, bigint, timestamp without time zone
) from public, anon, authenticated;

-- Apply the same strict Cairo wall-clock boundary to both approved SHOP_CONFIG schedule types.
alter function private.schedule_admin_shop_config_v1(
  uuid, uuid, text, jsonb, boolean, bigint, timestamp without time zone
) rename to schedule_admin_shop_config_v1_pre_round15;

create function private.schedule_admin_shop_config_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_operation text,
  p_settings_payload jsonb,
  p_online_orders_paused boolean,
  p_expected_settings_version bigint,
  p_local_scheduled_at timestamp without time zone
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_schedule_resolution jsonb;
begin
  v_schedule_resolution := private.resolve_admin_cairo_schedule_v1(p_local_scheduled_at);
  if coalesce((v_schedule_resolution ->> 'ok')::boolean, false) is not true then
    return v_schedule_resolution;
  end if;

  return private.schedule_admin_shop_config_v1_pre_round15(
    p_employee_id,
    p_shop_id,
    p_operation,
    p_settings_payload,
    p_online_orders_paused,
    p_expected_settings_version,
    p_local_scheduled_at
  );
end;
$$;

revoke all on function private.schedule_admin_shop_config_v1(
  uuid, uuid, text, jsonb, boolean, bigint, timestamp without time zone
) from public, anon, authenticated;

-- Keep the established recurring-availability EXIT-before-ENTER dependency semantics, and add an
-- independent same-shop SHOP_CONFIG predecessor fence. A retryable predecessor remains unresolved
-- even when its retry is not due yet; APPLIED/CANCELLED/terminal FAILED predecessors are settled.
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
      and (
        s.change_kind <> 'SHOP_CONFIG'
        or not exists (
          select 1
          from public.scheduled_config_changes predecessor
          where predecessor.shop_id = s.shop_id
            and predecessor.change_kind = 'SHOP_CONFIG'
            and (
              predecessor.scheduled_for < s.scheduled_for
              or (
                predecessor.scheduled_for = s.scheduled_for
                and (
                  predecessor.created_at < s.created_at
                  or (
                    predecessor.created_at = s.created_at
                    and predecessor.id < s.id
                  )
                )
              )
            )
            and predecessor.status in ('PENDING', 'CLAIMED', 'FAILED')
            and (
              predecessor.status <> 'FAILED'
              or predecessor.terminal_failure = false
            )
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

-- The legacy implementations are internal implementation details only. Keep browser roles locked out
-- and expose only the validated public Catalog wrapper plus the existing public SHOP_CONFIG wrappers.
revoke all on function private.schedule_catalog_draft_v1_pre_round15(
  uuid, uuid, bigint, bigint, timestamp without time zone
) from public, anon, authenticated;
revoke all on function private.schedule_admin_shop_config_v1_pre_round15(
  uuid, uuid, text, jsonb, boolean, bigint, timestamp without time zone
) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    execute 'revoke execute on function private.schedule_catalog_draft_v1_pre_round15(uuid, uuid, bigint, bigint, timestamp without time zone) from service_role';
    grant execute on function public.schedule_catalog_draft_v1(
      uuid, uuid, bigint, bigint, timestamp without time zone
    ) to service_role;
    grant execute on function public.claim_due_admin_config_changes_v1(
      timestamptz, integer, integer
    ) to service_role;
  end if;
end $$;
