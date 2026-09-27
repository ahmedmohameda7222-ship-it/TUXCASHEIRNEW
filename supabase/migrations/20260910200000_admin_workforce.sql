-- TUX Admin Plan 6: Workforce.
-- Extends canonical business_employees / employee_shop_assignments and existing Operations workers.
-- Operations worker_sessions remain the live activity authority. Attendance is append-only projection/correction.
-- Credential material is service-only; raw entered credentials are never persisted by this schema.

alter table public.business_employees
  add column if not exists phone text,
  add column if not exists hire_date date,
  add column if not exists notes text,
  add column if not exists credential_version bigint not null default 1,
  add column if not exists profile_version bigint not null default 1;

alter table public.business_employees
  add constraint business_employees_credential_version_check
    check (credential_version > 0),
  add constraint business_employees_profile_version_check
    check (profile_version > 0),
  add constraint business_employees_phone_check
    check (phone is null or btrim(phone) <> '');

alter table public.workers
  add column if not exists pin_lookup_hash text,
  add column if not exists credential_version bigint not null default 1;

alter table public.workers
  add constraint workers_pin_lookup_hash_check
    check (pin_lookup_hash is null or pin_lookup_hash ~ '^[0-9a-f]{64}$'),
  add constraint workers_credential_version_check
    check (credential_version > 0);

create unique index if not exists workers_active_shop_pin_lookup_uq
  on public.workers (shop_id, pin_lookup_hash)
  where active and pin_lookup_hash is not null;

create table public.employee_worker_links (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  shop_id uuid not null,
  worker_id uuid not null,
  active boolean not null default true,
  linked_by_employee_id uuid not null,
  linked_at timestamptz not null default now(),
  unlinked_at timestamptz,
  link_command_id text not null check (btrim(link_command_id) <> ''),
  created_at timestamptz not null default now(),
  constraint employee_worker_links_business_employee_fkey
    foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint employee_worker_links_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint employee_worker_links_assignment_fkey
    foreign key (employee_id, shop_id)
    references public.employee_shop_assignments(employee_id, shop_id) on delete restrict,
  constraint employee_worker_links_worker_fkey
    foreign key (shop_id, worker_id)
    references public.workers(shop_id, id) on delete restrict,
  constraint employee_worker_links_actor_fkey
    foreign key (business_id, linked_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint employee_worker_links_unlinked_shape_check
    check ((active and unlinked_at is null) or (not active and unlinked_at is not null))
);

create unique index employee_worker_links_worker_id_unique on public.employee_worker_links (worker_id);
create unique index employee_worker_links_active_employee_shop_uq
  on public.employee_worker_links (employee_id, shop_id)
  where active;
create unique index employee_worker_links_business_command_uq
  on public.employee_worker_links (business_id, link_command_id);

create table public.employee_compensation (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  compensation_type text not null check (compensation_type in ('HOURLY', 'MONTHLY')),
  rate_minor bigint not null check (rate_minor >= 0),
  effective_from date not null,
  version bigint not null check (version > 0),
  created_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  constraint employee_compensation_business_employee_fkey
    foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint employee_compensation_actor_fkey
    foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint employee_compensation_employee_version_uq unique (employee_id, version),
  constraint employee_compensation_employee_effective_uq unique (employee_id, effective_from)
);

create index employee_compensation_current_idx
  on public.employee_compensation (business_id, employee_id, effective_from desc, version desc);

create table public.employee_shifts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  shop_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  planned_break_minutes integer not null default 0 check (planned_break_minutes >= 0),
  status text not null default 'SCHEDULED'
    check (status in ('SCHEDULED', 'CANCELLED', 'COMPLETED')),
  version bigint not null default 1 check (version > 0),
  source_shift_id uuid references public.employee_shifts(id) on delete restrict,
  created_by_employee_id uuid not null,
  updated_by_employee_id uuid not null,
  create_command_id text not null check (btrim(create_command_id) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  constraint employee_shifts_interval_check check (ends_at > starts_at),
  constraint employee_shifts_cancel_shape_check
    check ((status = 'CANCELLED' and cancelled_at is not null) or (status <> 'CANCELLED' and cancelled_at is null)),
  constraint employee_shifts_business_employee_fkey
    foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint employee_shifts_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint employee_shifts_assignment_fkey
    foreign key (employee_id, shop_id)
    references public.employee_shop_assignments(employee_id, shop_id) on delete restrict,
  constraint employee_shifts_created_by_fkey
    foreign key (business_id, created_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint employee_shifts_updated_by_fkey
    foreign key (business_id, updated_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint employee_shifts_business_id_id_uq unique (business_id, id),
  constraint employee_shifts_create_command_uq unique (business_id, create_command_id)
);

create unique index employee_shifts_copy_identity_uq
  on public.employee_shifts (source_shift_id, starts_at)
  where source_shift_id is not null;
create index employee_shifts_week_idx
  on public.employee_shifts (business_id, shop_id, employee_id, starts_at);

create table public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  shop_id uuid not null,
  worker_id uuid not null,
  worker_session_id uuid not null,
  event_type text not null check (event_type in ('SESSION_START', 'SESSION_END')),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint attendance_events_business_employee_fkey
    foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint attendance_events_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint attendance_events_worker_fkey
    foreign key (shop_id, worker_id)
    references public.workers(shop_id, id) on delete restrict,
  constraint attendance_events_worker_session_fkey
    foreign key (shop_id, worker_session_id)
    references public.worker_sessions(shop_id, id) on delete restrict,
  constraint attendance_events_session_event_uq unique (worker_session_id, event_type),
  constraint attendance_events_business_id_id_uq unique (business_id, id)
);

create index attendance_events_employee_time_idx
  on public.attendance_events (business_id, employee_id, occurred_at desc);

create table public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  shop_id uuid not null,
  attendance_event_id uuid not null,
  original_occurred_at timestamptz not null,
  corrected_occurred_at timestamptz not null,
  reason text not null check (btrim(reason) <> ''),
  corrected_by_employee_id uuid not null,
  command_id text not null check (btrim(command_id) <> ''),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint attendance_corrections_event_fkey
    foreign key (business_id, attendance_event_id)
    references public.attendance_events(business_id, id) on delete restrict,
  constraint attendance_corrections_employee_fkey
    foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint attendance_corrections_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint attendance_corrections_actor_fkey
    foreign key (business_id, corrected_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint attendance_corrections_command_unique unique (business_id, command_id)
);

create index attendance_corrections_event_idx
  on public.attendance_corrections (business_id, attendance_event_id, created_at);

create table public.leave_requests (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  shop_id uuid,
  leave_type text not null check (leave_type in ('VACATION', 'SICK', 'UNPAID', 'OTHER')),
  starts_on date not null,
  ends_on date not null,
  note text,
  status text not null default 'PENDING' check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  requester_employee_id uuid not null,
  decided_by_employee_id uuid,
  decision_reason text,
  decided_at timestamptz,
  version bigint not null default 1 check (version > 0),
  request_command_id text not null check (btrim(request_command_id) <> ''),
  decision_command_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leave_requests_date_range_check check (ends_on >= starts_on),
  constraint leave_requests_decision_shape_check check (
    (status = 'PENDING' and decided_by_employee_id is null and decided_at is null and decision_command_id is null)
    or
    (status in ('APPROVED', 'REJECTED') and decided_by_employee_id is not null and decided_at is not null and decision_command_id is not null)
  ),
  constraint leave_requests_business_employee_fkey
    foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint leave_requests_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint leave_requests_requester_fkey
    foreign key (business_id, requester_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint leave_requests_decider_fkey
    foreign key (business_id, decided_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint leave_requests_business_id_id_uq unique (business_id, id),
  constraint leave_requests_request_command_uq unique (business_id, request_command_id),
  constraint leave_requests_decision_command_uq unique (business_id, decision_command_id)
);

create index leave_requests_employee_dates_idx
  on public.leave_requests (business_id, employee_id, starts_on, ends_on);

create table public.staff_payment_records (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  employee_id uuid not null,
  shop_id uuid not null,
  pay_period_start date not null,
  pay_period_end date not null,
  expected_amount_minor bigint not null check (expected_amount_minor >= 0),
  paid_amount_minor bigint not null check (paid_amount_minor > 0),
  finance_account_id uuid not null,
  finance_movement_id uuid not null unique,
  payment_date date not null,
  note text,
  reference text,
  actor_employee_id uuid not null,
  command_id text not null check (btrim(command_id) <> ''),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint staff_payment_records_period_check check (pay_period_end >= pay_period_start),
  constraint staff_payment_records_business_employee_fkey
    foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint staff_payment_records_business_shop_fkey
    foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict,
  constraint staff_payment_records_assignment_fkey
    foreign key (employee_id, shop_id)
    references public.employee_shop_assignments(employee_id, shop_id) on delete restrict,
  constraint staff_payment_records_account_fkey
    foreign key (business_id, finance_account_id)
    references public.finance_accounts(business_id, id) on delete restrict,
  constraint staff_payment_records_movement_fkey
    foreign key (finance_movement_id)
    references public.finance_movements(id) on delete restrict,
  constraint staff_payment_records_actor_fkey
    foreign key (business_id, actor_employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint staff_payment_records_command_unique unique (business_id, command_id),
  constraint staff_payment_records_scope_id_uq unique (business_id, shop_id, employee_id, id)
);

create index staff_payment_records_employee_period_idx
  on public.staff_payment_records (business_id, employee_id, pay_period_end desc, payment_date desc);

create table public.staff_payment_expense_events (
  staff_payment_record_id uuid primary key,
  business_id uuid not null,
  employee_id uuid not null,
  shop_id uuid not null,
  command_id text not null check (btrim(command_id) <> ''),
  paid_amount_minor bigint not null check (paid_amount_minor > 0),
  pay_period_start date not null,
  pay_period_end date not null,
  created_at timestamptz not null default now(),
  constraint staff_payment_expense_events_period_check check (pay_period_end >= pay_period_start),
  constraint staff_payment_expense_events_payment_scope_fkey
    foreign key (business_id, shop_id, employee_id, staff_payment_record_id)
    references public.staff_payment_records(business_id, shop_id, employee_id, id) on delete restrict,
  constraint staff_payment_expense_events_command_unique unique (business_id, command_id)
);

create index staff_payment_expense_events_period_idx
  on public.staff_payment_expense_events (business_id, pay_period_start, pay_period_end);

create table private.admin_workforce_command_receipts (
  business_id uuid not null,
  command_id text not null check (btrim(command_id) <> ''),
  action_type text not null check (btrim(action_type) <> ''),
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result_payload jsonb not null check (jsonb_typeof(result_payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (business_id, command_id),
  foreign key (business_id) references public.businesses(id) on delete restrict
);

create table private.admin_employee_pin_change_commands (
  command_ref uuid primary key default gen_random_uuid(),
  command_id uuid not null unique,
  business_id uuid not null,
  employee_id uuid not null,
  target_shop_ids uuid[] not null,
  pin_verifier_hash text not null,
  pin_lookup_hash text not null check (pin_lookup_hash ~ '^[0-9a-f]{64}$'),
  expected_credential_version bigint not null check (expected_credential_version > 0),
  worker_state_fingerprint text not null check (worker_state_fingerprint ~ '^[0-9a-f]{64}$'),
  staged_by_employee_id uuid not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  constraint admin_employee_pin_change_commands_expiry_check check (expires_at > created_at),
  constraint admin_employee_pin_change_commands_verifier_check
    check (pin_verifier_hash ~ '^pbkdf2-sha256\$[0-9]+\$[0-9a-f]+\$[0-9a-f]+$'),
  constraint admin_employee_pin_change_commands_target_shops_check
    check (cardinality(target_shop_ids) > 0),
  constraint admin_employee_pin_change_commands_business_employee_fkey
    foreign key (business_id, employee_id)
    references public.business_employees(business_id, id) on delete restrict,
  constraint admin_employee_pin_change_commands_actor_fkey
    foreign key (business_id, staged_by_employee_id)
    references public.business_employees(business_id, id) on delete restrict
);

revoke all on private.admin_workforce_command_receipts from public, anon, authenticated;
revoke all on private.admin_employee_pin_change_commands from public, anon, authenticated;

create or replace function private.workforce_fingerprint_v1(p_value jsonb)
returns text
language sql
immutable
set search_path = pg_catalog, extensions
as $$
  select encode(extensions.digest(convert_to(coalesce(p_value, '{}'::jsonb)::text, 'UTF8'), 'sha256'), 'hex')
$$;

create or replace function private.workforce_command_replay_v1(
  p_business_id uuid,
  p_command_id text,
  p_action_type text,
  p_request_fingerprint text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_row private.admin_workforce_command_receipts%rowtype;
begin
  select * into v_row
  from private.admin_workforce_command_receipts
  where business_id = p_business_id
    and command_id = p_command_id;

  if not found then
    return null;
  end if;
  if v_row.action_type <> p_action_type
     or v_row.request_fingerprint <> p_request_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'workforce_command_conflict');
  end if;
  return v_row.result_payload || jsonb_build_object('replayed', true);
end;
$$;

create or replace function private.store_workforce_command_receipt_v1(
  p_business_id uuid,
  p_command_id text,
  p_action_type text,
  p_request_fingerprint text,
  p_result_payload jsonb
)
returns void
language sql
security definer
set search_path = pg_catalog, public, private
as $$
  insert into private.admin_workforce_command_receipts(
    business_id, command_id, action_type, request_fingerprint, result_payload
  ) values (
    p_business_id, p_command_id, p_action_type, p_request_fingerprint, p_result_payload
  )
  on conflict (business_id, command_id) do nothing
$$;

create or replace function private.workforce_worker_state_fingerprint_v1(
  p_employee_id uuid,
  p_target_shop_ids uuid[]
)
returns text
language sql
stable
security definer
set search_path = pg_catalog, public, private, extensions
as $$
  select encode(
    extensions.digest(
      convert_to(
        coalesce(
          string_agg(
            concat_ws(
              ':',
              w.shop_id::text,
              w.id::text,
              w.active::text,
              w.pin_hash,
              coalesce(w.pin_lookup_hash, ''),
              w.credential_version::text,
              coalesce(l.employee_id::text, '')
            ),
            '|' order by w.shop_id, w.id
          ),
          ''
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  from public.workers w
  left join public.employee_worker_links l
    on l.worker_id = w.id
   and l.active
  where w.shop_id = any(p_target_shop_ids)
    and w.active
$$;

create or replace function private.prevent_workforce_immutable_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  raise exception using errcode = '55000', message = 'TUX_WORKFORCE_HISTORY_IMMUTABLE';
end;
$$;

create trigger employee_compensation_immutable
before update or delete on public.employee_compensation
for each row execute function private.prevent_workforce_immutable_mutation_v1();

create trigger attendance_events_immutable
before update or delete on public.attendance_events
for each row execute function private.prevent_workforce_immutable_mutation_v1();

create trigger attendance_corrections_immutable
before update or delete on public.attendance_corrections
for each row execute function private.prevent_workforce_immutable_mutation_v1();

create trigger staff_payment_records_immutable
before update or delete on public.staff_payment_records
for each row execute function private.prevent_workforce_immutable_mutation_v1();

create trigger staff_payment_expense_events_immutable
before update or delete on public.staff_payment_expense_events
for each row execute function private.prevent_workforce_immutable_mutation_v1();

create or replace function public.assign_employee_to_shop_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_auth record;
  v_business_id uuid;
  v_employee public.business_employees%rowtype;
  v_payload jsonb;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_actor_employee_id is null or p_employee_id is null or p_shop_id is null
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_assignment');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_business_id := v_auth.business_id;

  select * into v_employee
  from public.business_employees
  where id = p_employee_id
    and business_id = v_business_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'employee_not_found');
  end if;
  if not v_employee.active then
    return jsonb_build_object('ok', false, 'code', 'employee_inactive');
  end if;

  v_payload := jsonb_build_object('employeeId', p_employee_id, 'shopId', p_shop_id);
  v_fingerprint := private.workforce_fingerprint_v1(v_payload);
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_business_id, p_command_id, 'ASSIGN_EMPLOYEE_TO_SHOP', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  if exists (
    select 1 from public.employee_shop_assignments
    where employee_id = p_employee_id and shop_id = p_shop_id
  ) then
    v_result := jsonb_build_object('ok', true, 'replayed', true, 'employeeId', p_employee_id, 'shopId', p_shop_id);
    perform private.store_workforce_command_receipt_v1(
      v_business_id, p_command_id, 'ASSIGN_EMPLOYEE_TO_SHOP', v_fingerprint, v_result
    );
    return v_result;
  end if;

  insert into public.employee_shop_assignments(business_id, employee_id, shop_id)
  values (v_business_id, p_employee_id, p_shop_id);

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_SHOP_ASSIGNED',
    'BUSINESS_EMPLOYEE', p_employee_id::text, null,
    jsonb_build_object('employeeId', p_employee_id, 'shopId', p_shop_id),
    null, null, null, jsonb_build_object('source', 'workforce')
  );

  v_result := jsonb_build_object('ok', true, 'replayed', false, 'employeeId', p_employee_id, 'shopId', p_shop_id);
  perform private.store_workforce_command_receipt_v1(
    v_business_id, p_command_id, 'ASSIGN_EMPLOYEE_TO_SHOP', v_fingerprint, v_result
  );
  return v_result;
end;
$$;

create or replace function public.link_employee_worker_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_worker_id uuid,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_auth record;
  v_business_id uuid;
  v_worker public.workers%rowtype;
  v_existing public.employee_worker_links%rowtype;
  v_payload jsonb;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_actor_employee_id is null or p_employee_id is null or p_shop_id is null
     or p_worker_id is null or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_worker_link');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_business_id := v_auth.business_id;

  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required');
  end if;

  select * into v_worker from public.workers where id = p_worker_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'worker_not_found'); end if;
  if v_worker.shop_id <> p_shop_id then
    return jsonb_build_object('ok', false, 'code', 'worker_shop_mismatch');
  end if;

  v_payload := jsonb_build_object('employeeId', p_employee_id, 'shopId', p_shop_id, 'workerId', p_worker_id);
  v_fingerprint := private.workforce_fingerprint_v1(v_payload);
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_business_id, p_command_id, 'LINK_EMPLOYEE_WORKER', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  select * into v_existing
  from public.employee_worker_links
  where worker_id = p_worker_id;

  if found then
    if v_existing.employee_id = p_employee_id and v_existing.shop_id = p_shop_id then
      v_result := jsonb_build_object('ok', true, 'replayed', true, 'linkId', v_existing.id);
      perform private.store_workforce_command_receipt_v1(
        v_business_id, p_command_id, 'LINK_EMPLOYEE_WORKER', v_fingerprint, v_result
      );
      return v_result;
    end if;
    return jsonb_build_object('ok', false, 'code', 'worker_already_linked');
  end if;

  if exists (
    select 1 from public.employee_worker_links
    where employee_id = p_employee_id and shop_id = p_shop_id and active
  ) then
    return jsonb_build_object('ok', false, 'code', 'employee_shop_already_linked');
  end if;

  insert into public.employee_worker_links(
    business_id, employee_id, shop_id, worker_id, linked_by_employee_id, link_command_id
  ) values (
    v_business_id, p_employee_id, p_shop_id, p_worker_id, p_actor_employee_id, p_command_id
  )
  returning id into v_existing.id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_WORKER_LINKED',
    'BUSINESS_EMPLOYEE', p_employee_id::text, null,
    jsonb_build_object('employeeId', p_employee_id, 'shopId', p_shop_id, 'workerId', p_worker_id),
    null, null, null, jsonb_build_object('source', 'workforce')
  );

  v_result := jsonb_build_object('ok', true, 'replayed', false, 'linkId', v_existing.id);
  perform private.store_workforce_command_receipt_v1(
    v_business_id, p_command_id, 'LINK_EMPLOYEE_WORKER', v_fingerprint, v_result
  );
  return v_result;
end;
$$;

create or replace function public.project_worker_session_attendance_v1(p_worker_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_session public.worker_sessions%rowtype;
  v_link public.employee_worker_links%rowtype;
  v_inserted integer := 0;
begin
  if p_worker_session_id is null then
    return jsonb_build_object('ok', false, 'code', 'worker_session_required');
  end if;

  select * into v_session
  from public.worker_sessions
  where id = p_worker_session_id;

  if not found then return jsonb_build_object('ok', false, 'code', 'worker_session_not_found'); end if;

  select * into v_link
  from public.employee_worker_links
  where worker_id = v_session.worker_id
    and shop_id = v_session.shop_id
    and active;

  if not found then return jsonb_build_object('ok', false, 'code', 'employee_worker_link_missing'); end if;

  insert into public.attendance_events(
    business_id, employee_id, shop_id, worker_id, worker_session_id, event_type, occurred_at
  ) values (
    v_link.business_id, v_link.employee_id, v_session.shop_id, v_session.worker_id,
    v_session.id, 'SESSION_START', v_session.started_at
  )
  on conflict (worker_session_id, event_type) do nothing;
  get diagnostics v_inserted = row_count;

  if v_session.ended_at is not null then
    insert into public.attendance_events(
      business_id, employee_id, shop_id, worker_id, worker_session_id, event_type, occurred_at
    ) values (
      v_link.business_id, v_link.employee_id, v_session.shop_id, v_session.worker_id,
      v_session.id, 'SESSION_END', v_session.ended_at
    )
    on conflict (worker_session_id, event_type) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'workerSessionId', v_session.id,
    'employeeId', v_link.employee_id
  );
end;
$$;

create or replace function public.correct_attendance_v1(
  p_actor_employee_id uuid,
  p_attendance_event_id uuid,
  p_corrected_occurred_at timestamptz,
  p_reason text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_event public.attendance_events%rowtype;
  v_auth record;
  v_existing public.attendance_corrections%rowtype;
  v_fingerprint text;
  v_id uuid;
begin
  if p_actor_employee_id is null or p_attendance_event_id is null
     or p_corrected_occurred_at is null or nullif(btrim(p_reason), '') is null
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_attendance_correction');
  end if;

  select * into v_event
  from public.attendance_events
  where id = p_attendance_event_id;

  if not found then return jsonb_build_object('ok', false, 'code', 'attendance_event_not_found'); end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, v_event.shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_event.business_id then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'eventId', p_attendance_event_id,
    'correctedAt', p_corrected_occurred_at,
    'reason', btrim(p_reason)
  ));

  perform pg_advisory_xact_lock(hashtextextended(v_event.business_id::text || ':attendance:' || p_command_id, 0));

  select * into v_existing
  from public.attendance_corrections
  where business_id = v_event.business_id
    and command_id = p_command_id;

  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'attendance_correction_command_conflict');
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'correctionId', v_existing.id);
  end if;

  insert into public.attendance_corrections(
    business_id, employee_id, shop_id, attendance_event_id,
    original_occurred_at, corrected_occurred_at, reason,
    corrected_by_employee_id, command_id, request_fingerprint
  ) values (
    v_event.business_id, v_event.employee_id, v_event.shop_id, v_event.id,
    v_event.occurred_at, p_corrected_occurred_at, btrim(p_reason),
    p_actor_employee_id, p_command_id, v_fingerprint
  )
  returning id into v_id;

  perform public.append_admin_audit_event_v1(
    v_event.business_id, v_event.shop_id, p_actor_employee_id, 'ATTENDANCE_CORRECTED',
    'ATTENDANCE_EVENT', v_event.id::text,
    jsonb_build_object('occurredAt', v_event.occurred_at),
    jsonb_build_object('correctedAt', p_corrected_occurred_at, 'correctionId', v_id),
    btrim(p_reason), null, null, jsonb_build_object('source', 'workforce')
  );

  return jsonb_build_object('ok', true, 'replayed', false, 'correctionId', v_id);
end;
$$;

create or replace function public.create_employee_shift_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_planned_break_minutes integer,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_auth record;
  v_business_id uuid;
  v_existing public.employee_shifts%rowtype;
  v_fingerprint text;
  v_id uuid;
begin
  if p_actor_employee_id is null or p_employee_id is null or p_shop_id is null
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_planned_break_minutes is null or p_planned_break_minutes < 0
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_shift');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_business_id := v_auth.business_id;

  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required');
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'shopId', p_shop_id, 'startsAt', p_starts_at,
    'endsAt', p_ends_at, 'breakMinutes', p_planned_break_minutes
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':shift-create:' || p_command_id, 0));

  select * into v_existing
  from public.employee_shifts
  where business_id = v_business_id and create_command_id = p_command_id;

  if found then
    if private.workforce_fingerprint_v1(jsonb_build_object(
      'employeeId', v_existing.employee_id, 'shopId', v_existing.shop_id,
      'startsAt', v_existing.starts_at, 'endsAt', v_existing.ends_at,
      'breakMinutes', v_existing.planned_break_minutes
    )) <> v_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'shift_command_conflict');
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'shiftId', v_existing.id, 'version', v_existing.version);
  end if;

  insert into public.employee_shifts(
    business_id, employee_id, shop_id, starts_at, ends_at, planned_break_minutes,
    created_by_employee_id, updated_by_employee_id, create_command_id
  ) values (
    v_business_id, p_employee_id, p_shop_id, p_starts_at, p_ends_at, p_planned_break_minutes,
    p_actor_employee_id, p_actor_employee_id, p_command_id
  )
  returning id into v_id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_SHIFT_CREATED',
    'EMPLOYEE_SHIFT', v_id::text, null,
    jsonb_build_object('employeeId', p_employee_id, 'startsAt', p_starts_at, 'endsAt', p_ends_at),
    null, null, null, jsonb_build_object('source', 'workforce')
  );

  return jsonb_build_object('ok', true, 'replayed', false, 'shiftId', v_id, 'version', 1);
end;
$$;

create or replace function public.update_employee_shift_v1(
  p_actor_employee_id uuid,
  p_shift_id uuid,
  p_expected_version bigint,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_planned_break_minutes integer,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_shift public.employee_shifts%rowtype;
  v_auth record;
  v_payload jsonb;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_actor_employee_id is null or p_shift_id is null or p_expected_version is null
     or p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at
     or p_planned_break_minutes is null or p_planned_break_minutes < 0
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_shift');
  end if;

  select * into v_shift from public.employee_shifts where id = p_shift_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'shift_not_found'); end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, v_shift.shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_shift.business_id then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;

  v_payload := jsonb_build_object(
    'shiftId', p_shift_id, 'expectedVersion', p_expected_version,
    'startsAt', p_starts_at, 'endsAt', p_ends_at, 'breakMinutes', p_planned_break_minutes
  );
  v_fingerprint := private.workforce_fingerprint_v1(v_payload);
  perform pg_advisory_xact_lock(hashtextextended(v_shift.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_shift.business_id, p_command_id, 'UPDATE_EMPLOYEE_SHIFT', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  if v_shift.status <> 'SCHEDULED' then
    return jsonb_build_object('ok', false, 'code', 'shift_not_editable');
  end if;
  if v_shift.version <> p_expected_version then
    return jsonb_build_object('ok', false, 'code', 'stale_shift');
  end if;

  update public.employee_shifts
  set starts_at = p_starts_at,
      ends_at = p_ends_at,
      planned_break_minutes = p_planned_break_minutes,
      version = version + 1,
      updated_by_employee_id = p_actor_employee_id,
      updated_at = now()
  where id = p_shift_id;

  v_result := jsonb_build_object('ok', true, 'replayed', false, 'shiftId', p_shift_id, 'version', p_expected_version + 1);
  perform private.store_workforce_command_receipt_v1(
    v_shift.business_id, p_command_id, 'UPDATE_EMPLOYEE_SHIFT', v_fingerprint, v_result
  );

  perform public.append_admin_audit_event_v1(
    v_shift.business_id, v_shift.shop_id, p_actor_employee_id, 'EMPLOYEE_SHIFT_UPDATED',
    'EMPLOYEE_SHIFT', p_shift_id::text,
    jsonb_build_object('version', v_shift.version, 'startsAt', v_shift.starts_at, 'endsAt', v_shift.ends_at),
    jsonb_build_object('version', p_expected_version + 1, 'startsAt', p_starts_at, 'endsAt', p_ends_at),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.cancel_employee_shift_v1(
  p_actor_employee_id uuid,
  p_shift_id uuid,
  p_expected_version bigint,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_shift public.employee_shifts%rowtype;
  v_auth record;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_shift from public.employee_shifts where id = p_shift_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'shift_not_found'); end if;
  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, v_shift.shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_shift.business_id then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  if nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_shift_command');
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object('shiftId', p_shift_id, 'expectedVersion', p_expected_version));
  perform pg_advisory_xact_lock(hashtextextended(v_shift.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_shift.business_id, p_command_id, 'CANCEL_EMPLOYEE_SHIFT', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  if v_shift.version <> p_expected_version then return jsonb_build_object('ok', false, 'code', 'stale_shift'); end if;
  if v_shift.status = 'CANCELLED' then
    return jsonb_build_object('ok', true, 'replayed', true, 'shiftId', p_shift_id, 'version', v_shift.version);
  end if;

  update public.employee_shifts
  set status = 'CANCELLED',
      cancelled_at = now(),
      version = version + 1,
      updated_by_employee_id = p_actor_employee_id,
      updated_at = now()
  where id = p_shift_id;

  v_result := jsonb_build_object('ok', true, 'replayed', false, 'shiftId', p_shift_id, 'version', p_expected_version + 1);
  perform private.store_workforce_command_receipt_v1(
    v_shift.business_id, p_command_id, 'CANCEL_EMPLOYEE_SHIFT', v_fingerprint, v_result
  );
  perform public.append_admin_audit_event_v1(
    v_shift.business_id, v_shift.shop_id, p_actor_employee_id, 'EMPLOYEE_SHIFT_CANCELLED',
    'EMPLOYEE_SHIFT', p_shift_id::text,
    jsonb_build_object('status', v_shift.status, 'version', v_shift.version),
    jsonb_build_object('status', 'CANCELLED', 'version', p_expected_version + 1),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.copy_previous_week_shifts_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_target_week_start date,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_auth record;
  v_business_id uuid;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
  v_count integer;
begin
  if p_target_week_start is null or extract(isodow from p_target_week_start) <> 1
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_copy_week');
  end if;
  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_business_id := v_auth.business_id;
  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required');
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'shopId', p_shop_id, 'targetWeekStart', p_target_week_start
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_business_id, p_command_id, 'COPY_PREVIOUS_WEEK_SHIFTS', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  insert into public.employee_shifts(
    business_id, employee_id, shop_id, starts_at, ends_at, planned_break_minutes,
    status, source_shift_id, created_by_employee_id, updated_by_employee_id, create_command_id
  )
  select
    s.business_id, s.employee_id, s.shop_id,
    s.starts_at + interval '7 days', s.ends_at + interval '7 days',
    s.planned_break_minutes, 'SCHEDULED', s.id,
    p_actor_employee_id, p_actor_employee_id,
    p_command_id || ':' || s.id::text
  from public.employee_shifts s
  where s.business_id = v_business_id
    and s.employee_id = p_employee_id
    and s.shop_id = p_shop_id
    and s.status <> 'CANCELLED'
    and s.starts_at >= (p_target_week_start - 7)::timestamptz
    and s.starts_at < p_target_week_start::timestamptz
  on conflict (source_shift_id, starts_at) where source_shift_id is not null do nothing;

  get diagnostics v_count = row_count;
  v_result := jsonb_build_object('ok', true, 'replayed', false, 'copiedCount', v_count, 'targetWeekStart', p_target_week_start);
  perform private.store_workforce_command_receipt_v1(
    v_business_id, p_command_id, 'COPY_PREVIOUS_WEEK_SHIFTS', v_fingerprint, v_result
  );
  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_SHIFTS_COPIED',
    'BUSINESS_EMPLOYEE', p_employee_id::text, null,
    jsonb_build_object('targetWeekStart', p_target_week_start, 'copiedCount', v_count),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.create_leave_request_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_leave_type text,
  p_starts_on date,
  p_ends_on date,
  p_note text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_auth record;
  v_business_id uuid;
  v_existing public.leave_requests%rowtype;
  v_id uuid;
  v_fingerprint text;
begin
  if p_starts_on is null or p_ends_on is null or p_ends_on < p_starts_on then
    return jsonb_build_object('ok', false, 'code', 'invalid_leave_range');
  end if;
  if p_leave_type not in ('VACATION','SICK','UNPAID','OTHER')
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_leave_request');
  end if;
  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_business_id := v_auth.business_id;
  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required'); end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'shopId', p_shop_id, 'leaveType', p_leave_type,
    'startsOn', p_starts_on, 'endsOn', p_ends_on, 'note', p_note
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':leave:' || p_command_id, 0));
  select * into v_existing from public.leave_requests
  where business_id = v_business_id and request_command_id = p_command_id;
  if found then
    if private.workforce_fingerprint_v1(jsonb_build_object(
      'employeeId', v_existing.employee_id, 'shopId', v_existing.shop_id,
      'leaveType', v_existing.leave_type, 'startsOn', v_existing.starts_on,
      'endsOn', v_existing.ends_on, 'note', v_existing.note
    )) <> v_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'leave_command_conflict');
    end if;
    return jsonb_build_object('ok', true, 'replayed', true, 'leaveRequestId', v_existing.id, 'status', v_existing.status, 'version', v_existing.version);
  end if;

  insert into public.leave_requests(
    business_id, employee_id, shop_id, leave_type, starts_on, ends_on, note,
    requester_employee_id, request_command_id
  ) values (
    v_business_id, p_employee_id, p_shop_id, p_leave_type, p_starts_on, p_ends_on,
    nullif(btrim(p_note), ''), p_actor_employee_id, p_command_id
  ) returning id into v_id;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id, 'LEAVE_REQUEST_CREATED',
    'LEAVE_REQUEST', v_id::text, null,
    jsonb_build_object('employeeId', p_employee_id, 'leaveType', p_leave_type, 'startsOn', p_starts_on, 'endsOn', p_ends_on),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return jsonb_build_object('ok', true, 'replayed', false, 'leaveRequestId', v_id, 'status', 'PENDING', 'version', 1);
end;
$$;

create or replace function public.decide_leave_request_v1(
  p_actor_employee_id uuid,
  p_leave_request_id uuid,
  p_expected_version bigint,
  p_decision text,
  p_reason text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_request public.leave_requests%rowtype;
  v_auth record;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_request from public.leave_requests where id = p_leave_request_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'leave_request_not_found'); end if;
  if p_decision not in ('APPROVED','REJECTED') or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_leave_decision');
  end if;
  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, v_request.shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_request.business_id then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'leaveRequestId', p_leave_request_id, 'expectedVersion', p_expected_version,
    'decision', p_decision, 'reason', p_reason
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_request.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_request.business_id, p_command_id, 'DECIDE_LEAVE_REQUEST', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  if v_request.status <> 'PENDING' then return jsonb_build_object('ok', false, 'code', 'leave_already_decided'); end if;
  if v_request.version <> p_expected_version then return jsonb_build_object('ok', false, 'code', 'stale_leave_request'); end if;

  update public.leave_requests
  set status = p_decision,
      decided_by_employee_id = p_actor_employee_id,
      decision_reason = nullif(btrim(p_reason), ''),
      decided_at = now(),
      decision_command_id = p_command_id,
      version = version + 1,
      updated_at = now()
  where id = p_leave_request_id;

  v_result := jsonb_build_object(
    'ok', true, 'replayed', false, 'leaveRequestId', p_leave_request_id,
    'status', p_decision, 'version', p_expected_version + 1
  );
  perform private.store_workforce_command_receipt_v1(
    v_request.business_id, p_command_id, 'DECIDE_LEAVE_REQUEST', v_fingerprint, v_result
  );
  perform public.append_admin_audit_event_v1(
    v_request.business_id, v_request.shop_id, p_actor_employee_id, 'LEAVE_REQUEST_DECIDED',
    'LEAVE_REQUEST', p_leave_request_id::text,
    jsonb_build_object('status', v_request.status, 'version', v_request.version),
    jsonb_build_object('status', p_decision, 'version', p_expected_version + 1),
    nullif(btrim(p_reason), ''), null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.record_staff_payment_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_pay_period_start date,
  p_pay_period_end date,
  p_expected_amount_minor bigint,
  p_paid_amount_minor bigint,
  p_finance_account_id uuid,
  p_payment_date date,
  p_note text,
  p_reference text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_auth record;
  v_business_id uuid;
  v_account public.finance_accounts%rowtype;
  v_existing public.staff_payment_records%rowtype;
  v_payment_id uuid := gen_random_uuid();
  v_fingerprint text;
  v_finance jsonb;
  v_movement_id uuid;
begin
  if p_actor_employee_id is null or p_employee_id is null or p_shop_id is null
     or p_pay_period_start is null or p_pay_period_end is null
     or p_pay_period_end < p_pay_period_start
     or p_expected_amount_minor is null or p_expected_amount_minor < 0
     or p_paid_amount_minor is null or p_paid_amount_minor <= 0
     or p_finance_account_id is null or p_payment_date is null
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_staff_payment');
  end if;

  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.payments');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_business_id := v_auth.business_id;

  if not exists (
    select 1 from public.employee_shop_assignments
    where business_id = v_business_id and employee_id = p_employee_id and shop_id = p_shop_id
  ) then return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required'); end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'shopId', p_shop_id,
    'payPeriodStart', p_pay_period_start, 'payPeriodEnd', p_pay_period_end,
    'expectedAmountMinor', p_expected_amount_minor, 'paidAmountMinor', p_paid_amount_minor,
    'financeAccountId', p_finance_account_id, 'paymentDate', p_payment_date,
    'note', nullif(btrim(p_note), ''), 'reference', nullif(btrim(p_reference), '')
  ));

  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':staff-payment:' || p_command_id, 0));

  select * into v_existing
  from public.staff_payment_records
  where business_id = v_business_id and command_id = p_command_id;

  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      return jsonb_build_object('ok', false, 'code', 'staff_payment_command_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'replayed', true,
      'staffPaymentRecordId', v_existing.id,
      'financeMovementId', v_existing.finance_movement_id
    );
  end if;

  select * into v_account
  from public.finance_accounts
  where business_id = v_business_id and id = p_finance_account_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'finance_account_forbidden'); end if;
  if not v_account.active then return jsonb_build_object('ok', false, 'code', 'finance_account_inactive'); end if;
  if v_account.shop_id is not null and v_account.shop_id <> p_shop_id then
    return jsonb_build_object('ok', false, 'code', 'finance_account_shop_forbidden');
  end if;

  v_finance := public.post_finance_movement_v1(
    p_actor_employee_id,
    p_shop_id,
    p_finance_account_id,
    'STAFF_PAYMENT',
    -p_paid_amount_minor,
    p_command_id,
    'STAFF_PAYMENT',
    v_payment_id::text,
    'STAFF_PAYMENT',
    'PRIMARY'
  );
  if coalesce((v_finance->>'ok')::boolean, false) is not true then
    return v_finance;
  end if;
  v_movement_id := (v_finance->>'movementId')::uuid;

  insert into public.staff_payment_records(
    id, business_id, employee_id, shop_id,
    pay_period_start, pay_period_end, expected_amount_minor, paid_amount_minor,
    finance_account_id, finance_movement_id, payment_date, note, reference,
    actor_employee_id, command_id, request_fingerprint
  ) values (
    v_payment_id, v_business_id, p_employee_id, p_shop_id,
    p_pay_period_start, p_pay_period_end, p_expected_amount_minor, p_paid_amount_minor,
    p_finance_account_id, v_movement_id, p_payment_date,
    nullif(btrim(p_note), ''), nullif(btrim(p_reference), ''),
    p_actor_employee_id, p_command_id, v_fingerprint
  );

  insert into public.staff_payment_expense_events(
    staff_payment_record_id, business_id, employee_id, shop_id,
    command_id, paid_amount_minor, pay_period_start, pay_period_end
  ) values (
    v_payment_id, v_business_id, p_employee_id, p_shop_id,
    p_command_id, p_paid_amount_minor, p_pay_period_start, p_pay_period_end
  );

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id, 'STAFF_PAYMENT_RECORDED',
    'STAFF_PAYMENT', v_payment_id::text, null,
    jsonb_build_object(
      'employeeId', p_employee_id,
      'payPeriodStart', p_pay_period_start,
      'payPeriodEnd', p_pay_period_end,
      'expectedAmountMinor', p_expected_amount_minor,
      'paidAmountMinor', p_paid_amount_minor,
      'financeAccountId', p_finance_account_id,
      'paymentDate', p_payment_date
    ),
    null, null, null, jsonb_build_object('source', 'workforce')
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false,
    'staffPaymentRecordId', v_payment_id,
    'financeMovementId', v_movement_id
  );
end;
$$;

create or replace function public.stage_employee_pin_change_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_target_shop_ids uuid[],
  p_pin_verifier_hash text,
  p_pin_lookup_hash text,
  p_expected_credential_version bigint,
  p_worker_state_fingerprint text,
  p_expires_at timestamptz,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, extensions
as $$
declare
  v_employee public.business_employees%rowtype;
  v_business_id uuid;
  v_shop_id uuid;
  v_auth record;
  v_normalized_shops uuid[];
  v_current_worker_fingerprint text;
  v_existing private.admin_employee_pin_change_commands%rowtype;
  v_ref uuid;
begin
  if p_actor_employee_id is null or p_employee_id is null
     or p_target_shop_ids is null or cardinality(p_target_shop_ids) = 0
     or p_pin_verifier_hash is null
     or p_pin_verifier_hash !~ '^pbkdf2-sha256\$[0-9]+\$[0-9a-f]+\$[0-9a-f]+$'
     or p_pin_lookup_hash is null or p_pin_lookup_hash !~ '^[0-9a-f]{64}$'
     or p_expected_credential_version is null or p_expected_credential_version <= 0
     or p_expires_at is null or p_expires_at <= now()
     or p_command_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_credential_command');
  end if;

  select array_agg(distinct s order by s) into v_normalized_shops
  from unnest(p_target_shop_ids) s
  where s is not null;
  if v_normalized_shops is null or cardinality(v_normalized_shops) = 0 then
    return jsonb_build_object('ok', false, 'code', 'target_shops_required');
  end if;

  select * into v_employee
  from public.business_employees
  where id = p_employee_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  if not v_employee.active then return jsonb_build_object('ok', false, 'code', 'employee_inactive'); end if;
  v_business_id := v_employee.business_id;

  foreach v_shop_id in array v_normalized_shops loop
    select * into v_auth
    from public.resolve_admin_authorization_v1(p_actor_employee_id, v_shop_id, 'staff.manage');
    if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_business_id then
      return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
    end if;
    if not exists (
      select 1 from public.employee_shop_assignments
      where business_id = v_business_id and employee_id = p_employee_id and shop_id = v_shop_id
    ) then
      return jsonb_build_object('ok', false, 'code', 'employee_shop_assignment_required');
    end if;
  end loop;

  if v_employee.credential_version <> p_expected_credential_version then
    return jsonb_build_object('ok', false, 'code', 'stale_credential');
  end if;

  if exists (
    select 1 from public.business_employees e
    where e.business_id = v_business_id
      and e.id <> p_employee_id
      and e.active
      and e.pin_lookup_hash = p_pin_lookup_hash
  ) then
    return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
  end if;

  v_current_worker_fingerprint :=
    private.workforce_worker_state_fingerprint_v1(p_employee_id, v_normalized_shops);
  if p_worker_state_fingerprint is not null
     and p_worker_state_fingerprint <> v_current_worker_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'worker_credential_state_changed');
  end if;

  select * into v_existing
  from private.admin_employee_pin_change_commands
  where command_id = p_command_id
  for update;

  if found then
    if v_existing.business_id <> v_business_id
       or v_existing.employee_id <> p_employee_id
       or v_existing.target_shop_ids <> v_normalized_shops
       or v_existing.pin_verifier_hash <> p_pin_verifier_hash
       or v_existing.pin_lookup_hash <> p_pin_lookup_hash
       or v_existing.expected_credential_version <> p_expected_credential_version then
      return jsonb_build_object('ok', false, 'code', 'credential_command_conflict');
    end if;
    return jsonb_build_object(
      'ok', true, 'replayed', true,
      'commandRef', v_existing.command_ref,
      'expectedCredentialVersion', v_existing.expected_credential_version
    );
  end if;

  insert into private.admin_employee_pin_change_commands(
    command_id, business_id, employee_id, target_shop_ids,
    pin_verifier_hash, pin_lookup_hash, expected_credential_version,
    worker_state_fingerprint, staged_by_employee_id, expires_at
  ) values (
    p_command_id, v_business_id, p_employee_id, v_normalized_shops,
    p_pin_verifier_hash, p_pin_lookup_hash, p_expected_credential_version,
    v_current_worker_fingerprint, p_actor_employee_id, p_expires_at
  )
  returning command_ref into v_ref;

  perform public.append_admin_audit_event_v1(
    v_business_id, null, p_actor_employee_id, 'EMPLOYEE_PIN_CHANGE_STAGED',
    'BUSINESS_EMPLOYEE', p_employee_id::text, null,
    jsonb_build_object(
      'employeeId', p_employee_id,
      'targetShopIds', v_normalized_shops,
      'expectedCredentialVersion', p_expected_credential_version,
      'credentialCommandRef', v_ref
    ),
    null, null, null, jsonb_build_object('source', 'workforce')
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false, 'commandRef', v_ref,
    'expectedCredentialVersion', p_expected_credential_version
  );
end;
$$;

create or replace function public.apply_employee_pin_change_v1(
  p_actor_employee_id uuid,
  p_command_ref uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_command private.admin_employee_pin_change_commands%rowtype;
  v_employee public.business_employees%rowtype;
  v_shop_id uuid;
  v_auth record;
  v_current_worker_fingerprint text;
  v_new_version bigint;
begin
  if p_actor_employee_id is null or p_command_ref is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_credential_command');
  end if;

  select * into v_command
  from private.admin_employee_pin_change_commands
  where command_ref = p_command_ref
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'credential_command_not_found'); end if;
  if v_command.consumed_at is not null then
    select * into v_employee
    from public.business_employees
    where id = v_command.employee_id and business_id = v_command.business_id;
    return jsonb_build_object(
      'ok', true, 'replayed', true, 'employeeId', v_command.employee_id,
      'credentialVersion', v_employee.credential_version
    );
  end if;
  if v_command.expires_at <= now() then
    return jsonb_build_object('ok', false, 'code', 'credential_command_expired');
  end if;

  foreach v_shop_id in array v_command.target_shop_ids loop
    select * into v_auth
    from public.resolve_admin_authorization_v1(p_actor_employee_id, v_shop_id, 'staff.manage');
    if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_command.business_id then
      return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
    end if;
  end loop;

  select * into v_employee
  from public.business_employees
  where id = v_command.employee_id
    and business_id = v_command.business_id
  for update;

  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  if not v_employee.active then return jsonb_build_object('ok', false, 'code', 'employee_inactive'); end if;
  if v_employee.credential_version <> v_command.expected_credential_version then
    return jsonb_build_object('ok', false, 'code', 'stale_credential');
  end if;

  v_current_worker_fingerprint :=
    private.workforce_worker_state_fingerprint_v1(v_command.employee_id, v_command.target_shop_ids);
  if v_current_worker_fingerprint <> v_command.worker_state_fingerprint then
    return jsonb_build_object('ok', false, 'code', 'worker_credential_state_changed');
  end if;

  if exists (
    select 1 from public.business_employees e
    where e.business_id = v_command.business_id
      and e.id <> v_command.employee_id
      and e.active
      and e.pin_lookup_hash = v_command.pin_lookup_hash
  ) then
    return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
  end if;

  if exists (
    select 1
    from public.workers w
    left join public.employee_worker_links l
      on l.worker_id = w.id
     and l.active
    where w.shop_id = any(v_command.target_shop_ids)
      and w.active
      and w.pin_lookup_hash = v_command.pin_lookup_hash
      and coalesce(l.employee_id, '00000000-0000-0000-0000-000000000000'::uuid) <> v_command.employee_id
  ) then
    return jsonb_build_object('ok', false, 'code', 'pin_already_in_use');
  end if;

  v_new_version := v_employee.credential_version + 1;

  update public.workers w
  set pin_hash = v_command.pin_verifier_hash,
      pin_lookup_hash = v_command.pin_lookup_hash,
      credential_version = credential_version + 1,
      updated_at = now()
  from public.employee_worker_links l
  where l.worker_id = w.id
    and l.employee_id = v_command.employee_id
    and l.business_id = v_command.business_id
    and l.shop_id = any(v_command.target_shop_ids)
    and l.active
    and w.active;

  update public.business_employees
  set pin_hash = v_command.pin_verifier_hash,
      pin_lookup_hash = v_command.pin_lookup_hash,
      credential_version = v_new_version,
      updated_at = now()
  where id = v_command.employee_id
    and business_id = v_command.business_id;

  update private.admin_employee_pin_change_commands
  set consumed_at = now()
  where command_ref = p_command_ref;

  perform public.append_admin_audit_event_v1(
    v_command.business_id, null, p_actor_employee_id, 'EMPLOYEE_PIN_CHANGED',
    'BUSINESS_EMPLOYEE', v_command.employee_id::text,
    jsonb_build_object('credentialVersion', v_command.expected_credential_version),
    jsonb_build_object(
      'credentialVersion', v_new_version,
      'targetShopIds', v_command.target_shop_ids,
      'credentialCommandRef', p_command_ref
    ),
    null, null, null, jsonb_build_object('source', 'workforce')
  );

  return jsonb_build_object(
    'ok', true, 'replayed', false,
    'employeeId', v_command.employee_id, 'credentialVersion', v_new_version
  );
end;
$$;

create or replace function public.suspend_employee_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_expected_profile_version bigint,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_employee public.business_employees%rowtype;
  v_actor public.business_employees%rowtype;
  v_shop_id uuid;
  v_auth record;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_actor_employee_id is null or p_employee_id is null or p_expected_profile_version is null
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee_suspend');
  end if;

  select * into v_employee from public.business_employees where id = p_employee_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  select * into v_actor
  from public.business_employees
  where id = p_actor_employee_id and business_id = v_employee.business_id and active;
  if not found then return jsonb_build_object('ok', false, 'code', 'permission_forbidden'); end if;

  for v_shop_id in
    select shop_id from public.employee_shop_assignments
    where business_id = v_employee.business_id and employee_id = p_employee_id
  loop
    select * into v_auth
    from public.resolve_admin_authorization_v1(p_actor_employee_id, v_shop_id, 'staff.manage');
    if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_employee.business_id then
      return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
    end if;
  end loop;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'expectedProfileVersion', p_expected_profile_version
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_employee.business_id, p_command_id, 'SUSPEND_EMPLOYEE', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  if v_employee.profile_version <> p_expected_profile_version then
    return jsonb_build_object('ok', false, 'code', 'stale_employee');
  end if;

  update public.business_employees
  set active = false, profile_version = profile_version + 1, updated_at = now()
  where id = p_employee_id and business_id = v_employee.business_id;

  update public.admin_sessions
  set revoked_at = coalesce(revoked_at, now()), last_seen_at = now()
  where business_id = v_employee.business_id
    and employee_id = p_employee_id
    and revoked_at is null;

  update public.workers w
  set active = false, updated_at = now()
  from public.employee_worker_links l
  where l.business_id = v_employee.business_id
    and l.employee_id = p_employee_id
    and l.worker_id = w.id
    and l.active
    and w.active;

  v_result := jsonb_build_object(
    'ok', true, 'replayed', false, 'employeeId', p_employee_id,
    'active', false, 'profileVersion', p_expected_profile_version + 1
  );
  perform private.store_workforce_command_receipt_v1(
    v_employee.business_id, p_command_id, 'SUSPEND_EMPLOYEE', v_fingerprint, v_result
  );
  perform public.append_admin_audit_event_v1(
    v_employee.business_id, null, p_actor_employee_id, 'EMPLOYEE_SUSPENDED',
    'BUSINESS_EMPLOYEE', p_employee_id::text,
    jsonb_build_object('active', v_employee.active, 'profileVersion', v_employee.profile_version),
    jsonb_build_object('active', false, 'profileVersion', p_expected_profile_version + 1),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.reactivate_employee_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_expected_profile_version bigint,
  p_shop_id uuid,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_employee public.business_employees%rowtype;
  v_auth record;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_employee from public.business_employees where id = p_employee_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_employee.business_id then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'expectedProfileVersion', p_expected_profile_version, 'shopId', p_shop_id
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_employee.business_id, p_command_id, 'REACTIVATE_EMPLOYEE', v_fingerprint);
  if v_replay is not null then return v_replay; end if;
  if v_employee.profile_version <> p_expected_profile_version then return jsonb_build_object('ok', false, 'code', 'stale_employee'); end if;
  if v_employee.active then return jsonb_build_object('ok', true, 'replayed', true, 'employeeId', p_employee_id, 'active', true, 'profileVersion', v_employee.profile_version); end if;

  update public.business_employees
  set active = true, profile_version = profile_version + 1, updated_at = now()
  where id = p_employee_id and business_id = v_employee.business_id;

  -- Linked Operations identities remain inactive until an explicit authorized setup/reactivation action.
  v_result := jsonb_build_object(
    'ok', true, 'replayed', false, 'employeeId', p_employee_id,
    'active', true, 'profileVersion', p_expected_profile_version + 1,
    'operationsSetupRequired', true
  );
  perform private.store_workforce_command_receipt_v1(
    v_employee.business_id, p_command_id, 'REACTIVATE_EMPLOYEE', v_fingerprint, v_result
  );
  perform public.append_admin_audit_event_v1(
    v_employee.business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_REACTIVATED',
    'BUSINESS_EMPLOYEE', p_employee_id::text,
    jsonb_build_object('active', false, 'profileVersion', v_employee.profile_version),
    jsonb_build_object('active', true, 'profileVersion', p_expected_profile_version + 1, 'operationsSetupRequired', true),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.create_employee_v1(
  p_actor_employee_id uuid,
  p_shop_id uuid,
  p_display_name text,
  p_phone text,
  p_hire_date date,
  p_notes text,
  p_role text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_auth record;
  v_business_id uuid;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
  v_id uuid;
begin
  if nullif(btrim(p_display_name), '') is null or p_role not in ('OWNER','ADMIN','MANAGER','STAFF')
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee');
  end if;
  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_business_id := v_auth.business_id;
  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'shopId', p_shop_id, 'displayName', btrim(p_display_name), 'phone', nullif(btrim(p_phone), ''),
    'hireDate', p_hire_date, 'notes', nullif(btrim(p_notes), ''), 'role', p_role
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_business_id, p_command_id, 'CREATE_EMPLOYEE', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  insert into public.business_employees(business_id, display_name, phone, hire_date, notes, role, active)
  values (v_business_id, btrim(p_display_name), nullif(btrim(p_phone), ''), p_hire_date, nullif(btrim(p_notes), ''), p_role, true)
  returning id into v_id;
  insert into public.employee_shop_assignments(business_id, employee_id, shop_id)
  values (v_business_id, v_id, p_shop_id);

  v_result := jsonb_build_object('ok', true, 'replayed', false, 'employeeId', v_id, 'profileVersion', 1);
  perform private.store_workforce_command_receipt_v1(
    v_business_id, p_command_id, 'CREATE_EMPLOYEE', v_fingerprint, v_result
  );
  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_CREATED',
    'BUSINESS_EMPLOYEE', v_id::text, null,
    jsonb_build_object('displayName', btrim(p_display_name), 'role', p_role, 'active', true),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.update_employee_profile_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_expected_profile_version bigint,
  p_display_name text,
  p_phone text,
  p_hire_date date,
  p_notes text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_employee public.business_employees%rowtype;
  v_auth record;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  select * into v_employee from public.business_employees where id = p_employee_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  if nullif(btrim(p_display_name), '') is null or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee');
  end if;
  select * into v_auth
  from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_employee.business_id then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'expectedProfileVersion', p_expected_profile_version,
    'displayName', btrim(p_display_name), 'phone', nullif(btrim(p_phone), ''),
    'hireDate', p_hire_date, 'notes', nullif(btrim(p_notes), '')
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_employee.business_id, p_command_id, 'UPDATE_EMPLOYEE_PROFILE', v_fingerprint);
  if v_replay is not null then return v_replay; end if;
  if v_employee.profile_version <> p_expected_profile_version then return jsonb_build_object('ok', false, 'code', 'stale_employee'); end if;

  update public.business_employees
  set display_name = btrim(p_display_name),
      phone = nullif(btrim(p_phone), ''),
      hire_date = p_hire_date,
      notes = nullif(btrim(p_notes), ''),
      profile_version = profile_version + 1,
      updated_at = now()
  where id = p_employee_id;

  v_result := jsonb_build_object('ok', true, 'replayed', false, 'employeeId', p_employee_id, 'profileVersion', p_expected_profile_version + 1);
  perform private.store_workforce_command_receipt_v1(v_employee.business_id, p_command_id, 'UPDATE_EMPLOYEE_PROFILE', v_fingerprint, v_result);
  perform public.append_admin_audit_event_v1(
    v_employee.business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_PROFILE_UPDATED',
    'BUSINESS_EMPLOYEE', p_employee_id::text,
    jsonb_build_object('displayName', v_employee.display_name, 'phone', v_employee.phone, 'hireDate', v_employee.hire_date, 'notes', v_employee.notes),
    jsonb_build_object('displayName', btrim(p_display_name), 'phone', nullif(btrim(p_phone), ''), 'hireDate', p_hire_date, 'notes', nullif(btrim(p_notes), '')),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.set_employee_role_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_expected_profile_version bigint,
  p_role text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_employee public.business_employees%rowtype;
  v_auth record;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_role not in ('OWNER','ADMIN','MANAGER','STAFF') then return jsonb_build_object('ok', false, 'code', 'invalid_employee_role'); end if;
  select * into v_employee from public.business_employees where id = p_employee_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  select * into v_auth from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_employee.business_id then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'expectedProfileVersion', p_expected_profile_version, 'role', p_role
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_employee.business_id, p_command_id, 'SET_EMPLOYEE_ROLE', v_fingerprint);
  if v_replay is not null then return v_replay; end if;
  if v_employee.profile_version <> p_expected_profile_version then return jsonb_build_object('ok', false, 'code', 'stale_employee'); end if;

  update public.business_employees
  set role = p_role, profile_version = profile_version + 1, updated_at = now()
  where id = p_employee_id;
  v_result := jsonb_build_object('ok', true, 'replayed', false, 'employeeId', p_employee_id, 'role', p_role, 'profileVersion', p_expected_profile_version + 1);
  perform private.store_workforce_command_receipt_v1(v_employee.business_id, p_command_id, 'SET_EMPLOYEE_ROLE', v_fingerprint, v_result);
  perform public.append_admin_audit_event_v1(
    v_employee.business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_ROLE_CHANGED',
    'BUSINESS_EMPLOYEE', p_employee_id::text,
    jsonb_build_object('role', v_employee.role), jsonb_build_object('role', p_role),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.set_employee_permission_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_permission_key text,
  p_effect text,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_employee public.business_employees%rowtype;
  v_auth record;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
begin
  if p_effect not in ('ALLOW','DENY') or nullif(btrim(p_permission_key), '') is null
     or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_employee_permission');
  end if;
  select * into v_employee from public.business_employees where id = p_employee_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  select * into v_auth from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_employee.business_id then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;
  if not exists (select 1 from public.admin_permissions where permission_key = p_permission_key) then
    return jsonb_build_object('ok', false, 'code', 'permission_key_invalid');
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'permissionKey', p_permission_key, 'effect', p_effect
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_employee.business_id, p_command_id, 'SET_EMPLOYEE_PERMISSION', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  insert into public.admin_employee_permissions(business_id, employee_id, permission_key, effect)
  values (v_employee.business_id, p_employee_id, p_permission_key, p_effect)
  on conflict (employee_id, permission_key)
  do update set effect = excluded.effect, updated_at = now();

  v_result := jsonb_build_object('ok', true, 'replayed', false, 'employeeId', p_employee_id, 'permissionKey', p_permission_key, 'effect', p_effect);
  perform private.store_workforce_command_receipt_v1(v_employee.business_id, p_command_id, 'SET_EMPLOYEE_PERMISSION', v_fingerprint, v_result);
  perform public.append_admin_audit_event_v1(
    v_employee.business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_PERMISSION_CHANGED',
    'BUSINESS_EMPLOYEE', p_employee_id::text, null,
    jsonb_build_object('permissionKey', p_permission_key, 'effect', p_effect),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

create or replace function public.set_employee_compensation_v1(
  p_actor_employee_id uuid,
  p_employee_id uuid,
  p_shop_id uuid,
  p_compensation_type text,
  p_rate_minor bigint,
  p_effective_from date,
  p_command_id text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  v_employee public.business_employees%rowtype;
  v_auth record;
  v_fingerprint text;
  v_replay jsonb;
  v_result jsonb;
  v_version bigint;
  v_id uuid;
begin
  if p_compensation_type not in ('HOURLY','MONTHLY') or p_rate_minor is null or p_rate_minor < 0
     or p_effective_from is null or nullif(btrim(p_command_id), '') is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_compensation');
  end if;
  select * into v_employee from public.business_employees where id = p_employee_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'employee_not_found'); end if;
  select * into v_auth from public.resolve_admin_authorization_v1(p_actor_employee_id, p_shop_id, 'staff.manage');
  if not coalesce(v_auth.authorized, false) or v_auth.business_id <> v_employee.business_id then
    return jsonb_build_object('ok', false, 'code', coalesce(v_auth.denial_code, 'permission_forbidden'));
  end if;

  v_fingerprint := private.workforce_fingerprint_v1(jsonb_build_object(
    'employeeId', p_employee_id, 'compensationType', p_compensation_type,
    'rateMinor', p_rate_minor, 'effectiveFrom', p_effective_from
  ));
  perform pg_advisory_xact_lock(hashtextextended(v_employee.business_id::text || ':workforce:' || p_command_id, 0));
  v_replay := private.workforce_command_replay_v1(v_employee.business_id, p_command_id, 'SET_EMPLOYEE_COMPENSATION', v_fingerprint);
  if v_replay is not null then return v_replay; end if;

  select coalesce(max(version), 0) + 1 into v_version
  from public.employee_compensation where employee_id = p_employee_id;

  insert into public.employee_compensation(
    business_id, employee_id, compensation_type, rate_minor, effective_from,
    version, created_by_employee_id
  ) values (
    v_employee.business_id, p_employee_id, p_compensation_type, p_rate_minor,
    p_effective_from, v_version, p_actor_employee_id
  ) returning id into v_id;

  v_result := jsonb_build_object('ok', true, 'replayed', false, 'compensationId', v_id, 'version', v_version);
  perform private.store_workforce_command_receipt_v1(v_employee.business_id, p_command_id, 'SET_EMPLOYEE_COMPENSATION', v_fingerprint, v_result);
  perform public.append_admin_audit_event_v1(
    v_employee.business_id, p_shop_id, p_actor_employee_id, 'EMPLOYEE_COMPENSATION_CHANGED',
    'BUSINESS_EMPLOYEE', p_employee_id::text, null,
    jsonb_build_object('compensationType', p_compensation_type, 'rateMinor', p_rate_minor, 'effectiveFrom', p_effective_from, 'version', v_version),
    null, null, null, jsonb_build_object('source', 'workforce')
  );
  return v_result;
end;
$$;

alter table public.employee_worker_links enable row level security;
alter table public.employee_compensation enable row level security;
alter table public.employee_shifts enable row level security;
alter table public.attendance_events enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.leave_requests enable row level security;
alter table public.staff_payment_records enable row level security;
alter table public.staff_payment_expense_events enable row level security;

revoke all on public.employee_worker_links from public, anon, authenticated;
revoke all on public.employee_compensation from public, anon, authenticated;
revoke all on public.employee_shifts from public, anon, authenticated;
revoke all on public.attendance_events from public, anon, authenticated;
revoke all on public.attendance_corrections from public, anon, authenticated;
revoke all on public.leave_requests from public, anon, authenticated;
revoke all on public.staff_payment_records from public, anon, authenticated;
revoke all on public.staff_payment_expense_events from public, anon, authenticated;

grant select on public.employee_worker_links to service_role;
grant select on public.employee_compensation to service_role;
grant select on public.employee_shifts to service_role;
grant select on public.attendance_events to service_role;
grant select on public.attendance_corrections to service_role;
grant select on public.leave_requests to service_role;
grant select on public.staff_payment_records to service_role;
grant select on public.staff_payment_expense_events to service_role;

revoke all on function private.workforce_fingerprint_v1(jsonb) from public, anon, authenticated;
revoke all on function private.workforce_command_replay_v1(uuid, text, text, text) from public, anon, authenticated;
revoke all on function private.store_workforce_command_receipt_v1(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function private.workforce_worker_state_fingerprint_v1(uuid, uuid[]) from public, anon, authenticated;
revoke all on function private.prevent_workforce_immutable_mutation_v1() from public, anon, authenticated;

revoke all on function public.assign_employee_to_shop_v1(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.link_employee_worker_v1(uuid, uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.project_worker_session_attendance_v1(uuid) from public, anon, authenticated;
revoke all on function public.correct_attendance_v1(uuid, uuid, timestamptz, text, text) from public, anon, authenticated;
revoke all on function public.create_employee_shift_v1(uuid, uuid, uuid, timestamptz, timestamptz, integer, text) from public, anon, authenticated;
revoke all on function public.update_employee_shift_v1(uuid, uuid, bigint, timestamptz, timestamptz, integer, text) from public, anon, authenticated;
revoke all on function public.cancel_employee_shift_v1(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.copy_previous_week_shifts_v1(uuid, uuid, uuid, date, text) from public, anon, authenticated;
revoke all on function public.create_leave_request_v1(uuid, uuid, uuid, text, date, date, text, text) from public, anon, authenticated;
revoke all on function public.decide_leave_request_v1(uuid, uuid, bigint, text, text, text) from public, anon, authenticated;
revoke all on function public.record_staff_payment_v1(uuid, uuid, uuid, date, date, bigint, bigint, uuid, date, text, text, text) from public, anon, authenticated;
revoke all on function public.stage_employee_pin_change_v1(uuid, uuid, uuid[], text, text, bigint, text, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.apply_employee_pin_change_v1(uuid, uuid) from public, anon, authenticated;
revoke all on function public.suspend_employee_v1(uuid, uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.reactivate_employee_v1(uuid, uuid, bigint, uuid, text) from public, anon, authenticated;
revoke all on function public.create_employee_v1(uuid, uuid, text, text, date, text, text, text) from public, anon, authenticated;
revoke all on function public.update_employee_profile_v1(uuid, uuid, uuid, bigint, text, text, date, text, text) from public, anon, authenticated;
revoke all on function public.set_employee_role_v1(uuid, uuid, uuid, bigint, text, text) from public, anon, authenticated;
revoke all on function public.set_employee_permission_v1(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.set_employee_compensation_v1(uuid, uuid, uuid, text, bigint, date, text) from public, anon, authenticated;

grant execute on function public.assign_employee_to_shop_v1(uuid, uuid, uuid, text) to service_role;
grant execute on function public.link_employee_worker_v1(uuid, uuid, uuid, uuid, text) to service_role;
grant execute on function public.project_worker_session_attendance_v1(uuid) to service_role;
grant execute on function public.correct_attendance_v1(uuid, uuid, timestamptz, text, text) to service_role;
grant execute on function public.create_employee_shift_v1(uuid, uuid, uuid, timestamptz, timestamptz, integer, text) to service_role;
grant execute on function public.update_employee_shift_v1(uuid, uuid, bigint, timestamptz, timestamptz, integer, text) to service_role;
grant execute on function public.cancel_employee_shift_v1(uuid, uuid, bigint, text) to service_role;
grant execute on function public.copy_previous_week_shifts_v1(uuid, uuid, uuid, date, text) to service_role;
grant execute on function public.create_leave_request_v1(uuid, uuid, uuid, text, date, date, text, text) to service_role;
grant execute on function public.decide_leave_request_v1(uuid, uuid, bigint, text, text, text) to service_role;
grant execute on function public.record_staff_payment_v1(uuid, uuid, uuid, date, date, bigint, bigint, uuid, date, text, text, text) to service_role;
grant execute on function public.stage_employee_pin_change_v1(uuid, uuid, uuid[], text, text, bigint, text, timestamptz, uuid) to service_role;
grant execute on function public.apply_employee_pin_change_v1(uuid, uuid) to service_role;
grant execute on function public.suspend_employee_v1(uuid, uuid, bigint, text) to service_role;
grant execute on function public.reactivate_employee_v1(uuid, uuid, bigint, uuid, text) to service_role;
grant execute on function public.create_employee_v1(uuid, uuid, text, text, date, text, text, text) to service_role;
grant execute on function public.update_employee_profile_v1(uuid, uuid, uuid, bigint, text, text, date, text, text) to service_role;
grant execute on function public.set_employee_role_v1(uuid, uuid, uuid, bigint, text, text) to service_role;
grant execute on function public.set_employee_permission_v1(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.set_employee_compensation_v1(uuid, uuid, uuid, text, bigint, date, text) to service_role;

comment on table public.employee_worker_links is
  'Explicit business employee to shop-scoped Operations worker identity. No heuristic auto-linking.';
comment on table public.attendance_events is
  'Immutable projection of canonical Operations worker_session start/end facts.';
comment on table public.attendance_corrections is
  'Append-only Admin corrections; original attendance facts remain unchanged.';
comment on table public.staff_payment_expense_events is
  'Exactly one immutable paid salary/wage reporting fact per posted staff payment.';
comment on table private.admin_employee_pin_change_commands is
  'Service-only one-way credential command material for approval-safe employee credential changes.';
