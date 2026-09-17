-- admin_plan3_review_round6_hardening
-- Additive Plan 3 hardening for final review round 6. Do not edit already-applied migrations.
-- Preserve ambiguous fifth-attempt executions for idempotent reconciliation and strengthen
-- free-text credential detection without treating ordinary restaurant salt references as secrets.

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

  -- PIN/passcode values have a constrained 4-12 digit shape, so allow a bounded natural-language
  -- gap instead of enumerating connector words. This catches forms such as "PIN was 4827".
  if v_value ~ '(^|[^a-z0-9])(pin|passcode)([^0-9]{1,32})([0-9]([[:space:]-]?[0-9]){3,11})([^0-9]|$)' then
    return true;
  end if;

  -- Preserve direct password/verifier/lookup/token forms while covering common narrative connectors.
  if v_value ~ '(^|[^a-z0-9])(password|verifier|lookup|token)([[:space:][:punct:]]+(is|was|were|to|as|equals?))?([[:space:][:punct:]]{1,8})([^[:space:],;]{4,})' then
    return true;
  end if;

  -- "salt" is common restaurant vocabulary. Require either an explicit connector or punctuation
  -- before treating the following token as credential material, so "Salt inventory count adjusted"
  -- remains a legitimate audit reason while "salt was abcdef" and "salt: abcdef" fail closed.
  if v_value ~ '(^|[^a-z0-9])salt((([[:space:][:punct:]]+)(is|was|were|to|as|equals?)([[:space:][:punct:]]{1,8}))|([[:punct:]]{1,8}[[:space:]]*))([^[:space:],;]{4,})' then
    return true;
  end if;

  return false;
end;
$$;

revoke all on function private.admin_text_contains_secret_v1(text)
  from public, anon, authenticated;

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
          and j.attempt_count between 1 and 5
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
          when c.previous_state in ('CLAIMED', 'RETRYABLE')
               and c.previous_attempt_count >= 5
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

create or replace function public.complete_admin_approval_execution_v1(
  p_approval_request_id uuid,
  p_claim_token text,
  p_outcome text,
  p_error_code text,
  p_result_metadata jsonb,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_job public.admin_approval_execution_jobs%rowtype;
  v_request public.admin_approval_requests%rowtype;
  v_outcome text;
  v_backoff_seconds integer;
begin
  v_outcome := upper(coalesce(btrim(p_outcome), ''));

  if p_approval_request_id is null
     or nullif(btrim(p_claim_token), '') is null
     or v_outcome not in ('EXECUTED', 'RETRYABLE', 'FAILED')
     or p_now is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_execution_completion');
  end if;

  if private.admin_json_contains_secret_key_v1(coalesce(p_result_metadata, '{}'::jsonb)) then
    return jsonb_build_object('ok', false, 'code', 'secret_result_metadata_forbidden');
  end if;

  if p_result_metadata is not null and jsonb_typeof(p_result_metadata) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_result_metadata');
  end if;

  select * into v_job
  from public.admin_approval_execution_jobs j
  where j.approval_request_id = p_approval_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'execution_job_not_found');
  end if;

  if v_job.state = 'EXECUTED' and v_outcome = 'EXECUTED' then
    if v_job.completed_claim_token_hash = encode(
      extensions.digest(p_claim_token, 'sha256'),
      'hex'
    ) then
      return jsonb_build_object(
        'ok', true,
        'status', 'EXECUTED',
        'idempotentReplay', true
      );
    end if;
    return jsonb_build_object('ok', false, 'code', 'stale_or_invalid_claim');
  end if;

  if v_job.state <> 'CLAIMED' then
    return jsonb_build_object('ok', false, 'code', 'execution_not_claimed');
  end if;

  if v_job.claim_token_hash <> encode(
    extensions.digest(p_claim_token, 'sha256'),
    'hex'
  ) then
    return jsonb_build_object('ok', false, 'code', 'stale_or_invalid_claim');
  end if;

  select * into v_request
  from public.admin_approval_requests r
  where r.id = p_approval_request_id
  for update;

  if not found or v_request.status <> 'EXECUTING' then
    raise exception 'approval_execution_request_state_invalid';
  end if;

  if v_outcome = 'EXECUTED' then
    update public.admin_approval_execution_jobs
    set state = 'EXECUTED',
        claim_token_hash = null,
        claimed_by = null,
        lease_expires_at = null,
        next_attempt_at = null,
        last_error_code = null,
        completed_claim_token_hash = v_job.claim_token_hash,
        result_metadata = coalesce(p_result_metadata, '{}'::jsonb),
        updated_at = p_now,
        completed_at = p_now
    where approval_request_id = p_approval_request_id;

    update public.admin_approval_requests
    set status = 'EXECUTED',
        executed_at = p_now,
        failed_at = null,
        updated_at = p_now
    where id = p_approval_request_id;

    perform public.append_admin_audit_event_v1(
      v_request.business_id,
      v_request.shop_id,
      null,
      'APPROVAL_COMMAND_EXECUTED',
      'APPROVAL_REQUEST',
      p_approval_request_id::text,
      jsonb_build_object('status', 'EXECUTING'),
      jsonb_build_object(
        'status', 'EXECUTED',
        'commandId', v_request.command_id,
        'result', coalesce(p_result_metadata, '{}'::jsonb)
      ),
      v_request.decision_reason,
      p_approval_request_id,
      null,
      jsonb_build_object('source', 'admin_approval_executor')
    );

    return jsonb_build_object(
      'ok', true,
      'status', 'EXECUTED',
      'idempotentReplay', false
    );
  end if;

  v_backoff_seconds := least(
    900,
    (30 * power(2, greatest(v_job.attempt_count - 1, 0)))::integer
  );

  -- A non-terminal handler error is ambiguous: the business effect may already have committed.
  -- Keep RETRYABLE eligible for idempotent command_id reconciliation even at attempt 5 rather than
  -- asserting FAILED solely because the bounded normal-attempt counter has reached its cap.
  if v_outcome = 'RETRYABLE' then
    update public.admin_approval_execution_jobs
    set state = 'RETRYABLE',
        claim_token_hash = null,
        claimed_by = null,
        lease_expires_at = null,
        next_attempt_at = p_now + make_interval(secs => v_backoff_seconds),
        completed_claim_token_hash = null,
        last_error_code = left(
          coalesce(nullif(btrim(p_error_code), ''), 'approval_execution_retryable_failure'),
          200
        ),
        result_metadata = null,
        updated_at = p_now,
        completed_at = null
    where approval_request_id = p_approval_request_id;

    update public.admin_approval_requests
    set status = 'APPROVED',
        failed_at = null,
        updated_at = p_now
    where id = p_approval_request_id;

    return jsonb_build_object(
      'ok', true,
      'status', 'RETRYABLE',
      'nextAttemptAt', p_now + make_interval(secs => v_backoff_seconds)
    );
  end if;

  update public.admin_approval_execution_jobs
  set state = 'FAILED',
      claim_token_hash = null,
      claimed_by = null,
      lease_expires_at = null,
      next_attempt_at = null,
      completed_claim_token_hash = v_job.claim_token_hash,
      last_error_code = left(
        coalesce(nullif(btrim(p_error_code), ''), 'approval_execution_terminal_failure'),
        200
      ),
      result_metadata = null,
      updated_at = p_now,
      completed_at = p_now
  where approval_request_id = p_approval_request_id;

  update public.admin_approval_requests
  set status = 'FAILED',
      failed_at = p_now,
      updated_at = p_now
  where id = p_approval_request_id;

  perform public.append_admin_audit_event_v1(
    v_request.business_id,
    v_request.shop_id,
    null,
    'APPROVAL_COMMAND_FAILED',
    'APPROVAL_REQUEST',
    p_approval_request_id::text,
    jsonb_build_object('status', 'EXECUTING'),
    jsonb_build_object(
      'status', 'FAILED',
      'commandId', v_request.command_id,
      'errorCode', left(
        coalesce(nullif(btrim(p_error_code), ''), 'approval_execution_terminal_failure'),
        200
      )
    ),
    v_request.decision_reason,
    p_approval_request_id,
    null,
    jsonb_build_object('source', 'admin_approval_executor')
  );

  return jsonb_build_object('ok', true, 'status', 'FAILED');
end;
$$;

revoke all on function public.claim_admin_approval_execution_v1(
  text, timestamptz, integer, integer
) from public, anon, authenticated;
revoke all on function public.complete_admin_approval_execution_v1(
  uuid, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant execute on function public.claim_admin_approval_execution_v1(
      text, timestamptz, integer, integer
    ) to service_role;
    grant execute on function public.complete_admin_approval_execution_v1(
      uuid, text, text, text, jsonb, timestamptz
    ) to service_role;
  end if;
end $$;
