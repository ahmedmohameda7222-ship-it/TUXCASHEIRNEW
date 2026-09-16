-- TUX Admin Plan 3 approvals, durable execution, and immutable audit foundation.
-- Repository migration only. Production application is not authorized during Plan 3.

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
begin
  if p_value is null then
    return false;
  end if;

  if jsonb_typeof(p_value) = 'object' then
    for v_key, v_child in select key, value from jsonb_each(p_value)
    loop
      v_normalized_key := replace(replace(lower(v_key), '-', '_'), ' ', '_');
      if v_normalized_key ~ '(^|_)(pin|password|passcode|verifier|salt|lookup)(_|$)'
         or v_normalized_key in (
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

create table if not exists public.admin_approval_rules (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid,
  action_type text not null check (btrim(action_type) <> ''),
  requester_permission text not null references public.admin_permissions(permission_key) on delete restrict,
  approver_permission text not null default 'approvals.review'
    references public.admin_permissions(permission_key) on delete restrict,
  requires_second_person boolean not null default true,
  requires_requester_repin boolean not null default false,
  expires_after_seconds integer not null default 86400
    check (expires_after_seconds between 60 and 604800),
  threshold_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(threshold_context) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);

create unique index if not exists admin_approval_rules_global_action_uq
  on public.admin_approval_rules(business_id, action_type)
  where shop_id is null;

create unique index if not exists admin_approval_rules_shop_action_uq
  on public.admin_approval_rules(business_id, shop_id, action_type)
  where shop_id is not null;

create table if not exists public.admin_approval_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid,
  approval_rule_id uuid not null,
  requester_employee_id uuid not null,
  requester_session_id uuid references public.admin_sessions(id) on delete restrict,
  action_type text not null check (btrim(action_type) <> ''),
  command_id uuid not null,
  command_payload jsonb not null
    check (
      jsonb_typeof(command_payload) = 'object'
      and not private.admin_json_contains_secret_key_v1(command_payload)
    ),
  threshold_context jsonb not null default '{}'::jsonb
    check (jsonb_typeof(threshold_context) = 'object'),
  reason text,
  required_approver_permission text not null
    references public.admin_permissions(permission_key) on delete restrict,
  requires_second_person boolean not null default true,
  status text not null default 'PENDING'
    check (status in ('PENDING', 'APPROVED', 'REJECTED', 'EXECUTING', 'EXECUTED', 'FAILED')),
  approver_employee_id uuid,
  approver_session_id uuid references public.admin_sessions(id) on delete restrict,
  decision_reason text,
  decided_at timestamptz,
  expires_at timestamptz not null,
  executed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (business_id, id),
  unique (business_id, command_id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, approval_rule_id)
    references public.admin_approval_rules(business_id, id) on delete restrict,
  foreign key (business_id, requester_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  foreign key (business_id, approver_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint admin_approval_requests_distinct_approver_ck
    check (approver_employee_id is null or approver_employee_id <> requester_employee_id),
  constraint admin_approval_requests_decision_shape_ck check (
    (status = 'PENDING'
      and approver_employee_id is null
      and decided_at is null)
    or
    (status in ('APPROVED', 'REJECTED', 'EXECUTING', 'EXECUTED', 'FAILED')
      and approver_employee_id is not null
      and decided_at is not null)
  ),
  constraint admin_approval_requests_terminal_time_ck check (
    (status <> 'EXECUTED' or executed_at is not null)
    and (status <> 'FAILED' or failed_at is not null)
  )
);

create index if not exists admin_approval_requests_pending_idx
  on public.admin_approval_requests(business_id, shop_id, created_at, id)
  where status = 'PENDING';

create table if not exists public.admin_approval_execution_jobs (
  approval_request_id uuid primary key,
  business_id uuid not null references public.businesses(id) on delete restrict,
  command_id uuid not null unique,
  state text not null default 'READY'
    check (state in ('READY', 'CLAIMED', 'RETRYABLE', 'EXECUTED', 'FAILED')),
  claim_token_hash text check (
    claim_token_hash is null or claim_token_hash ~ '^[0-9a-f]{64}$'
  ),
  completed_claim_token_hash text check (
    completed_claim_token_hash is null or completed_claim_token_hash ~ '^[0-9a-f]{64}$'
  ),
  claimed_by text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count between 0 and 5),
  next_attempt_at timestamptz,
  last_error_code text,
  result_metadata jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  foreign key (business_id, approval_request_id)
    references public.admin_approval_requests(business_id, id) on delete restrict,
  constraint admin_approval_execution_jobs_claim_shape_ck check (
    (state = 'CLAIMED'
      and claim_token_hash is not null
      and claimed_by is not null
      and lease_expires_at is not null)
    or
    (state <> 'CLAIMED'
      and claim_token_hash is null
      and claimed_by is null
      and lease_expires_at is null)
  ),
  constraint admin_approval_execution_jobs_retry_shape_ck check (
    (state = 'RETRYABLE' and next_attempt_at is not null)
    or
    (state <> 'RETRYABLE' and next_attempt_at is null)
  ),
  constraint admin_approval_execution_jobs_terminal_shape_ck check (
    (state in ('EXECUTED', 'FAILED') and completed_at is not null)
    or
    (state not in ('EXECUTED', 'FAILED') and completed_at is null)
  ),
  constraint admin_approval_execution_jobs_result_shape_ck check (
    result_metadata is null or state = 'EXECUTED'
  ),
  constraint admin_approval_execution_jobs_secret_safe_result_ck check (
    result_metadata is null
    or not private.admin_json_contains_secret_key_v1(result_metadata)
  )
);

create index if not exists admin_approval_execution_jobs_due_idx
  on public.admin_approval_execution_jobs(
    (case when state = 'RETRYABLE' then next_attempt_at else created_at end),
    approval_request_id
  )
  where state in ('READY', 'RETRYABLE');

create index if not exists admin_approval_execution_jobs_lease_idx
  on public.admin_approval_execution_jobs(lease_expires_at, approval_request_id)
  where state = 'CLAIMED';

create table if not exists public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid,
  actor_kind text not null default 'HUMAN' check (actor_kind in ('HUMAN', 'SYSTEM')),
  actor_employee_id uuid,
  actor_role text,
  requester_employee_id uuid,
  approver_employee_id uuid,
  action_type text not null check (btrim(action_type) <> ''),
  entity_type text,
  entity_id text,
  before_value jsonb,
  after_value jsonb,
  reason text,
  approval_request_id uuid references public.admin_approval_requests(id) on delete restrict,
  session_id uuid references public.admin_sessions(id) on delete restrict,
  context_metadata jsonb not null default '{}'::jsonb
    check (
      jsonb_typeof(context_metadata) = 'object'
      and not private.admin_json_contains_secret_key_v1(context_metadata)
    ),
  created_at timestamptz not null default now(),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  foreign key (business_id, actor_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  foreign key (business_id, requester_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  foreign key (business_id, approver_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint admin_audit_events_actor_shape_ck check (
    (actor_kind = 'HUMAN' and actor_employee_id is not null and actor_role is not null)
    or
    (actor_kind = 'SYSTEM' and actor_employee_id is null and actor_role = 'SYSTEM')
  ),
  constraint admin_audit_events_secret_safe_values_ck check (
    not private.admin_json_contains_secret_key_v1(before_value)
    and not private.admin_json_contains_secret_key_v1(after_value)
  )
);

create index if not exists admin_audit_events_business_created_idx
  on public.admin_audit_events(business_id, created_at desc, id);

create index if not exists admin_audit_events_shop_created_idx
  on public.admin_audit_events(business_id, shop_id, created_at desc, id);

create index if not exists admin_audit_events_approval_idx
  on public.admin_audit_events(approval_request_id, created_at, id)
  where approval_request_id is not null;

create or replace function private.prepare_admin_audit_event_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  if new.actor_employee_id is null then
    new.actor_kind := 'SYSTEM';
    new.actor_role := 'SYSTEM';
  else
    select e.role into new.actor_role
    from public.business_employees e
    where e.business_id = new.business_id
      and e.id = new.actor_employee_id;

    if not found then
      raise exception 'admin_audit_actor_invalid';
    end if;
    new.actor_kind := 'HUMAN';
  end if;

  if private.admin_json_contains_secret_key_v1(new.before_value)
     or private.admin_json_contains_secret_key_v1(new.after_value)
     or private.admin_json_contains_secret_key_v1(new.context_metadata) then
    raise exception 'admin_audit_secret_metadata_forbidden';
  end if;

  return new;
end;
$$;

drop trigger if exists admin_audit_events_prepare on public.admin_audit_events;
create trigger admin_audit_events_prepare
before insert on public.admin_audit_events
for each row execute function private.prepare_admin_audit_event_v1();

revoke all on function private.prepare_admin_audit_event_v1()
  from public, anon, authenticated;

create or replace function private.block_admin_audit_event_mutation_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, public, private
as $$
begin
  raise exception 'admin_audit_immutable' using errcode = '55000';
end;
$$;

drop trigger if exists admin_audit_events_immutable on public.admin_audit_events;
create trigger admin_audit_events_immutable
before update or delete on public.admin_audit_events
for each row execute function private.block_admin_audit_event_mutation_v1();

revoke all on function private.block_admin_audit_event_mutation_v1()
  from public, anon, authenticated;

create or replace function public.append_admin_audit_event_v1(
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
  v_actor_role text;
  v_event_id uuid;
  v_requester_employee_id uuid;
  v_approver_employee_id uuid;
begin
  if p_business_id is null or nullif(btrim(p_action_type), '') is null then
    raise exception 'admin_audit_invalid_request';
  end if;

  if private.admin_json_contains_secret_key_v1(p_before_value)
     or private.admin_json_contains_secret_key_v1(p_after_value)
     or private.admin_json_contains_secret_key_v1(coalesce(p_context_metadata, '{}'::jsonb)) then
    raise exception 'admin_audit_secret_metadata_forbidden';
  end if;

  if jsonb_typeof(coalesce(p_context_metadata, '{}'::jsonb)) <> 'object' then
    raise exception 'admin_audit_context_invalid';
  end if;

  if p_shop_id is not null and not exists (
    select 1 from public.business_shops bs
    where bs.business_id = p_business_id and bs.shop_id = p_shop_id
  ) then
    raise exception 'admin_audit_shop_outside_business';
  end if;

  if p_actor_employee_id is not null then
    select e.role into v_actor_role
    from public.business_employees e
    where e.business_id = p_business_id
      and e.id = p_actor_employee_id
      and e.active;

    if not found then
      raise exception 'admin_audit_actor_invalid';
    end if;

    if p_session_id is not null and not exists (
      select 1 from public.admin_sessions s
      where s.id = p_session_id
        and s.business_id = p_business_id
        and s.employee_id = p_actor_employee_id
    ) then
      raise exception 'admin_audit_session_invalid';
    end if;
  else
    v_actor_role := 'SYSTEM';
    if p_session_id is not null then
      raise exception 'admin_audit_system_session_invalid';
    end if;
  end if;

  if p_approval_request_id is not null then
    select r.requester_employee_id, r.approver_employee_id
      into v_requester_employee_id, v_approver_employee_id
    from public.admin_approval_requests r
    where r.id = p_approval_request_id
      and r.business_id = p_business_id;

    if not found then
      raise exception 'admin_audit_approval_invalid';
    end if;
  end if;

  insert into public.admin_audit_events(
    business_id,
    shop_id,
    actor_kind,
    actor_employee_id,
    actor_role,
    requester_employee_id,
    approver_employee_id,
    action_type,
    entity_type,
    entity_id,
    before_value,
    after_value,
    reason,
    approval_request_id,
    session_id,
    context_metadata
  ) values (
    p_business_id,
    p_shop_id,
    case when p_actor_employee_id is null then 'SYSTEM' else 'HUMAN' end,
    p_actor_employee_id,
    v_actor_role,
    v_requester_employee_id,
    v_approver_employee_id,
    btrim(p_action_type),
    nullif(btrim(p_entity_type), ''),
    nullif(btrim(p_entity_id), ''),
    p_before_value,
    p_after_value,
    nullif(btrim(p_reason), ''),
    p_approval_request_id,
    p_session_id,
    coalesce(p_context_metadata, '{}'::jsonb)
  )
  returning id into v_event_id;

  return v_event_id;
end;
$$;

create or replace function public.create_admin_approval_request_v1(
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
declare
  v_rule public.admin_approval_rules%rowtype;
  v_auth record;
  v_existing public.admin_approval_requests%rowtype;
  v_request_id uuid;
begin
  if p_business_id is null
     or p_requester_employee_id is null
     or p_rule_id is null
     or p_command_id is null
     or nullif(btrim(p_action_type), '') is null
     or p_command_payload is null
     or jsonb_typeof(p_command_payload) <> 'object' then
    return jsonb_build_object('ok', false, 'code', 'invalid_approval_request');
  end if;

  if private.admin_json_contains_secret_key_v1(p_command_payload) then
    return jsonb_build_object('ok', false, 'code', 'secret_payload_forbidden');
  end if;

  select * into v_rule
  from public.admin_approval_rules r
  where r.id = p_rule_id
    and r.business_id = p_business_id
    and r.active
  for update;

  if not found
     or v_rule.action_type <> btrim(p_action_type)
     or (v_rule.shop_id is not null and v_rule.shop_id is distinct from p_shop_id) then
    return jsonb_build_object('ok', false, 'code', 'approval_rule_missing_or_mismatched');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(
    p_requester_employee_id,
    p_shop_id,
    v_rule.requester_permission
  );

  if not coalesce(v_auth.authorized, false)
     or v_auth.business_id is distinct from p_business_id then
    return jsonb_build_object(
      'ok', false,
      'code', coalesce(v_auth.denial_code, 'requester_not_authorized')
    );
  end if;

  if p_requester_session_id is not null and not exists (
    select 1 from public.admin_sessions s
    where s.id = p_requester_session_id
      and s.business_id = p_business_id
      and s.employee_id = p_requester_employee_id
      and s.revoked_at is null
      and s.expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'code', 'requester_session_invalid');
  end if;

  select * into v_existing
  from public.admin_approval_requests r
  where r.business_id = p_business_id
    and r.command_id = p_command_id
  for update;

  if found then
    if v_existing.shop_id is not distinct from p_shop_id
       and v_existing.approval_rule_id = p_rule_id
       and v_existing.requester_employee_id = p_requester_employee_id
       and v_existing.action_type = btrim(p_action_type)
       and v_existing.command_payload = p_command_payload then
      return jsonb_build_object(
        'ok', true,
        'requestId', v_existing.id,
        'status', v_existing.status,
        'idempotentReplay', true
      );
    end if;

    return jsonb_build_object('ok', false, 'code', 'command_id_conflict');
  end if;

  insert into public.admin_approval_requests(
    business_id,
    shop_id,
    approval_rule_id,
    requester_employee_id,
    requester_session_id,
    action_type,
    command_id,
    command_payload,
    threshold_context,
    reason,
    required_approver_permission,
    requires_second_person,
    status,
    expires_at
  ) values (
    p_business_id,
    p_shop_id,
    p_rule_id,
    p_requester_employee_id,
    p_requester_session_id,
    btrim(p_action_type),
    p_command_id,
    p_command_payload,
    v_rule.threshold_context,
    nullif(btrim(p_reason), ''),
    v_rule.approver_permission,
    v_rule.requires_second_person,
    'PENDING',
    now() + make_interval(secs => v_rule.expires_after_seconds)
  )
  returning id into v_request_id;

  perform public.append_admin_audit_event_v1(
    p_business_id,
    p_shop_id,
    p_requester_employee_id,
    'APPROVAL_REQUESTED',
    'APPROVAL_REQUEST',
    v_request_id::text,
    null,
    jsonb_build_object(
      'status', 'PENDING',
      'actionType', btrim(p_action_type),
      'commandId', p_command_id
    ),
    p_reason,
    v_request_id,
    p_requester_session_id,
    jsonb_build_object('source', 'admin_bff')
  );

  return jsonb_build_object(
    'ok', true,
    'requestId', v_request_id,
    'status', 'PENDING',
    'idempotentReplay', false
  );
end;
$$;

create or replace function public.decide_admin_approval_request_v1(
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

  -- Distinct human approval is mandatory even when the requester is OWNER.
  if p_approver_employee_id = v_request.requester_employee_id then
    return jsonb_build_object('ok', false, 'code', 'self_approval_forbidden');
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

  update public.admin_approval_requests r
  set status = 'FAILED',
      failed_at = p_now,
      updated_at = p_now
  where r.status = 'EXECUTING'
    and exists (
      select 1
      from public.admin_approval_execution_jobs j
      where j.approval_request_id = r.id
        and j.state = 'CLAIMED'
        and j.attempt_count >= 5
        and j.lease_expires_at <= p_now
    );

  update public.admin_approval_execution_jobs j
  set state = 'FAILED',
      claim_token_hash = null,
      claimed_by = null,
      lease_expires_at = null,
      next_attempt_at = null,
      last_error_code = coalesce(j.last_error_code, 'approval_execution_retry_limit_exhausted'),
      completed_claim_token_hash = j.claim_token_hash,
      updated_at = p_now,
      completed_at = p_now
  where j.state = 'CLAIMED'
    and j.attempt_count >= 5
    and j.lease_expires_at <= p_now;

  return query
  with candidates as (
    select
      j.approval_request_id,
      gen_random_uuid()::text as issued_claim_token
    from public.admin_approval_execution_jobs j
    join public.admin_approval_requests r
      on r.id = j.approval_request_id
     and r.business_id = j.business_id
    where r.status in ('APPROVED', 'EXECUTING')
      and j.attempt_count < 5
      and (
        j.state = 'READY'
        or (
          j.state = 'RETRYABLE'
          and j.next_attempt_at is not null
          and j.next_attempt_at <= p_now
        )
        or (
          j.state = 'CLAIMED'
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
        attempt_count = j.attempt_count + 1,
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
  v_will_retry boolean;
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

  v_will_retry := v_outcome = 'RETRYABLE' and v_job.attempt_count < 5;
  v_backoff_seconds := least(
    900,
    (30 * power(2, greatest(v_job.attempt_count - 1, 0)))::integer
  );

  if v_will_retry then
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

alter table public.admin_approval_rules enable row level security;
alter table public.admin_approval_requests enable row level security;
alter table public.admin_approval_execution_jobs enable row level security;
alter table public.admin_audit_events enable row level security;

revoke all on table public.admin_approval_rules from public, anon, authenticated;
revoke all on table public.admin_approval_requests from public, anon, authenticated;
revoke all on table public.admin_approval_execution_jobs from public, anon, authenticated;
revoke all on table public.admin_audit_events from public, anon, authenticated;

revoke all on function public.append_admin_audit_event_v1(
  uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.create_admin_approval_request_v1(
  uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text
) from public, anon, authenticated;
revoke all on function public.decide_admin_approval_request_v1(
  uuid, uuid, uuid, text, text
) from public, anon, authenticated;
revoke all on function public.claim_admin_approval_execution_v1(
  text, timestamptz, integer, integer
) from public, anon, authenticated;
revoke all on function public.complete_admin_approval_execution_v1(
  uuid, text, text, text, jsonb, timestamptz
) from public, anon, authenticated;

do $$
begin
  if to_regrole('service_role') is not null then
    grant select on table public.admin_approval_rules to service_role;
    grant select on table public.admin_approval_requests to service_role;
    grant select on table public.admin_approval_execution_jobs to service_role;
    grant select on table public.admin_audit_events to service_role;

    grant execute on function public.append_admin_audit_event_v1(
      uuid, uuid, uuid, text, text, text, jsonb, jsonb, text, uuid, uuid, jsonb
    ) to service_role;
    grant execute on function public.create_admin_approval_request_v1(
      uuid, uuid, uuid, uuid, uuid, text, uuid, jsonb, text
    ) to service_role;
    grant execute on function public.decide_admin_approval_request_v1(
      uuid, uuid, uuid, text, text
    ) to service_role;
    grant execute on function public.claim_admin_approval_execution_v1(
      text, timestamptz, integer, integer
    ) to service_role;
    grant execute on function public.complete_admin_approval_execution_v1(
      uuid, text, text, text, jsonb, timestamptz
    ) to service_role;
  end if;
end $$;
