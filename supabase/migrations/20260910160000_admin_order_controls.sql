-- TUX Admin Plan 5: order supervision, immutable refund/return events, and lifecycle convergence.
-- Repository migration only. Do not apply to a remote project during implementation Plans 5-9.

-- Preserve canonical Operations order history while allowing an Admin actor to be attributed
-- independently from the original Operations worker.
alter table public.orders
  add column if not exists cancelled_by_admin_employee_id uuid
    references public.business_employees(id) on delete restrict;

alter table public.order_status_events
  alter column worker_id drop not null;

alter table public.order_status_events
  add column if not exists admin_employee_id uuid
    references public.business_employees(id) on delete restrict,
  add column if not exists worker_name_snapshot text,
  add column if not exists operational_revision bigint not null default 0
    check (operational_revision >= 0),
  add column if not exists from_status text,
  add column if not exists to_status text,
  add column if not exists food_prepared boolean,
  add column if not exists reason_code_id uuid
    references public.admin_reason_codes(id) on delete restrict,
  add column if not exists reason_code_key text,
  add column if not exists reason_label_snapshot text,
  add column if not exists reason_family_snapshot text,
  add column if not exists reason_config_version bigint,
  add column if not exists note text;

alter table public.order_status_events
  drop constraint if exists order_status_events_admin_actor_ck,
  drop constraint if exists order_status_events_reason_snapshot_ck;

alter table public.order_status_events
  add constraint order_status_events_admin_actor_ck check (
    worker_id is not null or admin_employee_id is not null
  ),
  add constraint order_status_events_reason_snapshot_ck check (
    (
      reason_code_id is null
      and reason_code_key is null
      and reason_label_snapshot is null
      and reason_family_snapshot is null
      and reason_config_version is null
    )
    or
    (
      reason_code_id is not null
      and reason_code_key is not null
      and reason_label_snapshot is not null
      and reason_family_snapshot is not null
      and reason_config_version is not null
    )
  );

-- The same feed carries Operations and Admin lifecycle facts. The event row remains the
-- immutable canonical history; this table only supplies a monotonic cursor.
create table public.order_lifecycle_feed (
  sequence bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  status_event_id uuid not null unique references public.order_status_events(id) on delete restrict,
  operational_revision bigint not null check (operational_revision >= 0),
  captured_at timestamptz not null default now()
);
create index order_lifecycle_feed_shop_sequence_idx
  on public.order_lifecycle_feed(shop_id, sequence);
create index order_lifecycle_feed_order_revision_idx
  on public.order_lifecycle_feed(order_id, operational_revision);

insert into public.order_lifecycle_feed(
  shop_id, order_id, status_event_id, operational_revision, captured_at
)
select
  e.shop_id,
  e.order_id,
  e.id,
  coalesce(e.operational_revision, 0),
  coalesce(e.created_at, now())
from public.order_status_events e
order by e.created_at, e.id
on conflict (status_event_id) do nothing;

create or replace function private.capture_order_lifecycle_feed_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $capture_order_lifecycle_feed$
begin
  insert into public.order_lifecycle_feed(
    shop_id, order_id, status_event_id, operational_revision
  ) values (
    new.shop_id, new.order_id, new.id, coalesce(new.operational_revision, 0)
  )
  on conflict (status_event_id) do nothing;
  return new;
end;
$capture_order_lifecycle_feed$;

revoke all on function private.capture_order_lifecycle_feed_v1()
  from public, anon, authenticated;

drop trigger if exists order_status_events_capture_lifecycle_feed
  on public.order_status_events;
create trigger order_status_events_capture_lifecycle_feed
after insert on public.order_status_events
for each row execute function private.capture_order_lifecycle_feed_v1();

create table public.admin_order_command_receipts (
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  command_id text not null check (btrim(command_id) <> ''),
  command_type text not null check (command_type in ('CANCEL', 'REFUND', 'RETURN')),
  order_id uuid not null references public.orders(id) on delete restrict,
  request_fingerprint text not null check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  result_json jsonb not null check (jsonb_typeof(result_json) = 'object'),
  created_at timestamptz not null default now(),
  primary key (shop_id, command_id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);

create table public.admin_order_refunds (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  payment_id uuid not null references public.payments(id) on delete restrict,
  amount_minor bigint not null check (amount_minor > 0),
  reason_code_id uuid not null references public.admin_reason_codes(id) on delete restrict,
  reason_code_key text not null,
  reason_label_snapshot text not null,
  reason_family_snapshot text not null check (reason_family_snapshot = 'REFUND_RETURN'),
  reason_config_version bigint not null check (reason_config_version > 0),
  note text,
  state text not null default 'POSTED' check (state in ('PENDING_APPROVAL', 'POSTED')),
  approval_request_id uuid references public.admin_approval_requests(id) on delete restrict,
  command_id text not null check (btrim(command_id) <> ''),
  created_by_employee_id uuid not null references public.business_employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (shop_id, command_id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);
create index admin_order_refunds_order_idx
  on public.admin_order_refunds(order_id, created_at, id);
create index admin_order_refunds_payment_idx
  on public.admin_order_refunds(payment_id, created_at, id);

create table public.admin_order_returns (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete restrict,
  shop_id uuid not null references public.shops(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  reason_code_id uuid not null references public.admin_reason_codes(id) on delete restrict,
  reason_code_key text not null,
  reason_label_snapshot text not null,
  reason_family_snapshot text not null check (reason_family_snapshot = 'REFUND_RETURN'),
  reason_config_version bigint not null check (reason_config_version > 0),
  note text,
  state text not null default 'POSTED' check (state in ('PENDING_APPROVAL', 'POSTED')),
  approval_request_id uuid references public.admin_approval_requests(id) on delete restrict,
  command_id text not null check (btrim(command_id) <> ''),
  created_by_employee_id uuid not null references public.business_employees(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (shop_id, command_id),
  foreign key (business_id, shop_id)
    references public.business_shops(business_id, shop_id) on delete restrict
);

create table public.admin_order_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.admin_order_returns(id) on delete restrict,
  order_item_id uuid not null references public.order_items(id) on delete restrict,
  quantity integer not null check (quantity > 0),
  amount_minor bigint not null check (amount_minor >= 0),
  created_at timestamptz not null default now(),
  unique (return_id, order_item_id)
);
create index admin_order_return_items_order_item_idx
  on public.admin_order_return_items(order_item_id, created_at, id);

alter table public.order_lifecycle_feed enable row level security;
alter table public.admin_order_command_receipts enable row level security;
alter table public.admin_order_refunds enable row level security;
alter table public.admin_order_returns enable row level security;
alter table public.admin_order_return_items enable row level security;

revoke all on public.order_lifecycle_feed from public, anon, authenticated;
revoke all on public.admin_order_command_receipts from public, anon, authenticated;
revoke all on public.admin_order_refunds from public, anon, authenticated;
revoke all on public.admin_order_returns from public, anon, authenticated;
revoke all on public.admin_order_return_items from public, anon, authenticated;

grant select on public.order_lifecycle_feed to service_role;
grant usage, select on sequence public.order_lifecycle_feed_sequence_seq to service_role;
grant select, insert, update on public.admin_order_command_receipts to service_role;
grant select, insert on public.admin_order_refunds to service_role;
grant select, insert on public.admin_order_returns to service_role;
grant select, insert on public.admin_order_return_items to service_role;

create or replace function private.admin_order_authority_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_permission text
)
returns table(
  business_id uuid,
  employee_role text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $admin_order_authority$
declare
  v_authorized boolean;
  v_business_id uuid;
  v_role text;
begin
  select a.authorized, a.business_id, a.employee_role
    into v_authorized, v_business_id, v_role
  from public.resolve_admin_authorization_v1(
    p_employee_id,
    p_shop_id,
    p_permission
  ) a
  limit 1;

  if not coalesce(v_authorized, false) or v_business_id is null then
    raise exception 'TUX_ADMIN_ORDER_PERMISSION_REQUIRED';
  end if;

  return query select v_business_id, v_role;
end;
$admin_order_authority$;

revoke all on function private.admin_order_authority_v1(uuid, uuid, text)
  from public, anon, authenticated;

create or replace function private.admin_order_reason_snapshot_v1(
  p_business_id uuid,
  p_shop_id uuid,
  p_reason_code_id uuid,
  p_family text
)
returns table(
  reason_code_key text,
  reason_label text,
  reason_family text,
  reason_version bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $admin_order_reason$
begin
  return query
  select r.reason_key, r.label, r.family, r.version
  from public.admin_reason_codes r
  where r.id = p_reason_code_id
    and r.business_id = p_business_id
    and (r.shop_id is null or r.shop_id = p_shop_id)
    and r.active
    and r.family = p_family
  limit 1;

  if not found then
    raise exception 'TUX_ADMIN_ORDER_REASON_INVALID:%', p_family;
  end if;
end;
$admin_order_reason$;

revoke all on function private.admin_order_reason_snapshot_v1(uuid, uuid, uuid, text)
  from public, anon, authenticated;

create or replace function private.admin_order_command_fingerprint_v1(
  p_command_type text,
  p_order_id uuid,
  p_payload jsonb
)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $fingerprint$
  select encode(
    digest(
      p_command_type || ':' || p_order_id::text || ':' ||
        coalesce(p_payload, '{}'::jsonb)::text,
      'sha256'
    ),
    'hex'
  );
$fingerprint$;

revoke all on function private.admin_order_command_fingerprint_v1(text, uuid, jsonb)
  from public, anon, authenticated;

create or replace function public.cancel_admin_order_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_order_id uuid,
  p_reason_code_id uuid,
  p_expected_operational_revision bigint,
  p_note text,
  p_command_id text,
  p_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $cancel_admin_order$
declare
  v_business_id uuid;
  v_order public.orders%rowtype;
  v_reason record;
  v_existing public.admin_order_command_receipts%rowtype;
  v_fingerprint text;
  v_status_event_id uuid;
  v_result jsonb;
  v_reservation public.inventory_reservations%rowtype;
  v_movement_id uuid;
  v_audit_id uuid;
begin
  if p_employee_id is null
     or p_shop_id is null
     or p_order_id is null
     or p_reason_code_id is null
     or p_expected_operational_revision is null
     or p_expected_operational_revision < 0
     or p_command_id is null
     or btrim(p_command_id) = ''
     or p_business_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_cancel_command');
  end if;

  select a.business_id into v_business_id
  from private.admin_order_authority_v1(
    p_employee_id, p_shop_id, 'orders.cancel'
  ) a;

  if v_business_id is distinct from p_business_id then
    raise exception 'TUX_ADMIN_ORDER_BUSINESS_FORBIDDEN';
  end if;

  select * into v_reason
  from private.admin_order_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id, 'CANCELLATION'
  );

  v_fingerprint := private.admin_order_command_fingerprint_v1(
    'CANCEL',
    p_order_id,
    jsonb_build_object(
      'reasonCodeId', p_reason_code_id,
      'expectedOperationalRevision', p_expected_operational_revision,
      'note', nullif(btrim(p_note), '')
    )
  );

  select * into v_existing
  from public.admin_order_command_receipts r
  where r.shop_id = p_shop_id
    and r.command_id = p_command_id
  for update;

  if found then
    if v_existing.business_id = v_business_id
       and v_existing.command_type = 'CANCEL'
       and v_existing.order_id = p_order_id
       and v_existing.request_fingerprint = v_fingerprint then
      return v_existing.result_json || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'command_id_conflict');
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id
    and o.shop_id = p_shop_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'code', 'order_not_found');
  end if;

  if v_order.status <> 'ACTIVE' then
    return jsonb_build_object(
      'ok', false,
      'code', 'order_not_active',
      'canonicalStatus', v_order.status,
      'canonicalOperationalRevision', v_order.operational_revision
    );
  end if;

  if v_order.operational_revision <> p_expected_operational_revision then
    raise exception 'TUX_ORDER_STALE_OPERATIONAL_REVISION:%:%',
      v_order.status, v_order.operational_revision;
  end if;

  -- Serialize and settle the canonical reservation rows before exposing CANCELLED.
  for v_reservation in
    select *
    from public.inventory_reservations r
    where r.shop_id = p_shop_id
      and r.order_id = p_order_id
      and r.status = 'ACTIVE'
    order by r.inventory_item_id
    for update
  loop
    v_movement_id := gen_random_uuid();
    insert into public.inventory_movements(
      id,
      shop_id,
      business_day_id,
      inventory_item_id,
      movement_type,
      quantity_delta_micros,
      reserved_delta_micros,
      admin_employee_id,
      source_kind,
      command_id,
      unit_cost_minor,
      order_id,
      compensates_movement_id,
      idempotency_key,
      created_at
    ) values (
      v_movement_id,
      p_shop_id,
      v_reservation.business_day_id,
      v_reservation.inventory_item_id,
      'ORDER_RESERVATION_RELEASE',
      0,
      -v_reservation.quantity_micros,
      p_employee_id,
      'ADMIN',
      p_command_id,
      null,
      p_order_id,
      null,
      'admin-cancel-reservation-release:' || p_command_id || ':' ||
        v_reservation.inventory_item_id::text,
      now()
    );

    update public.inventory_reservations
       set status = 'RELEASED',
           last_command_id = p_command_id,
           updated_at = now()
     where id = v_reservation.id;
  end loop;

  -- The assignment spelling below is intentional: operational_revision is incremented
  -- exactly once while the row remains locked by this transaction.
  update public.orders
     set status = 'CANCELLED',
         updated_at = now(),
         operational_revision = operational_revision + 1,
         cancelled_at = now(),
         cancelled_by_admin_employee_id = p_employee_id,
         cancellation_reason = v_reason.reason_label,
         cancellation_stock_restored = false
   where id = p_order_id
     and shop_id = p_shop_id
     and status = 'ACTIVE'
     and operational_revision = p_expected_operational_revision
  returning * into v_order;

  if not found then
    raise exception 'TUX_ORDER_STALE_OPERATIONAL_REVISION';
  end if;

  v_status_event_id := gen_random_uuid();
  insert into public.order_status_events(
    id,
    shop_id,
    business_day_id,
    order_id,
    event_type,
    worker_id,
    admin_employee_id,
    worker_name_snapshot,
    reason,
    restore_stock,
    food_prepared,
    operational_revision,
    from_status,
    to_status,
    idempotency_key,
    reason_code_id,
    reason_code_key,
    reason_label_snapshot,
    reason_family_snapshot,
    reason_config_version,
    note,
    created_at
  ) values (
    v_status_event_id,
    p_shop_id,
    v_order.business_day_id,
    p_order_id,
    'CANCELLED',
    null,
    p_employee_id,
    'Admin',
    v_reason.reason_label,
    false,
    false,
    v_order.operational_revision,
    'ACTIVE',
    'CANCELLED',
    'admin-cancel:' || p_command_id,
    p_reason_code_id,
    v_reason.reason_code_key,
    v_reason.reason_label,
    v_reason.reason_family,
    v_reason.reason_version,
    nullif(btrim(p_note), ''),
    now()
  );

  v_audit_id := public.append_admin_audit_event_v1(
    v_business_id,
    p_shop_id,
    p_employee_id,
    'ORDER_CANCELLED',
    'ORDER',
    p_order_id::text,
    jsonb_build_object(
      'status', 'ACTIVE',
      'operationalRevision', p_expected_operational_revision
    ),
    jsonb_build_object(
      'status', 'CANCELLED',
      'operationalRevision', v_order.operational_revision,
      'reasonCodeId', p_reason_code_id,
      'reasonCodeKey', v_reason.reason_code_key,
      'reasonLabel', v_reason.reason_label,
      'reasonFamily', v_reason.reason_family,
      'reasonConfigVersion', v_reason.reason_version
    ),
    nullif(btrim(p_note), ''),
    null,
    null,
    jsonb_build_object('commandId', p_command_id)
  );

  v_result := jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'status', 'CANCELLED',
    'operationalRevision', v_order.operational_revision,
    'statusEventId', v_status_event_id,
    'auditEventId', v_audit_id,
    'replayed', false
  );

  insert into public.admin_order_command_receipts(
    business_id,
    shop_id,
    command_id,
    command_type,
    order_id,
    request_fingerprint,
    result_json
  ) values (
    v_business_id,
    p_shop_id,
    p_command_id,
    'CANCEL',
    p_order_id,
    v_fingerprint,
    v_result
  );

  return v_result;
end;
$cancel_admin_order$;

revoke all on function public.cancel_admin_order_v1(
  uuid, uuid, uuid, uuid, bigint, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.cancel_admin_order_v1(
  uuid, uuid, uuid, uuid, bigint, text, text, uuid
) to service_role;

create or replace function public.request_admin_order_refund_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_order_id uuid,
  p_payment_id uuid,
  p_amount_minor bigint,
  p_reason_code_id uuid,
  p_note text,
  p_command_id text,
  p_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $refund_admin_order$
declare
  v_business_id uuid;
  v_order public.orders%rowtype;
  v_payment public.payments%rowtype;
  v_reason record;
  v_existing public.admin_order_command_receipts%rowtype;
  v_fingerprint text;
  v_refunded bigint;
  v_refund_id uuid;
  v_result jsonb;
begin
  if p_employee_id is null or p_shop_id is null or p_order_id is null
     or p_payment_id is null or p_amount_minor is null or p_amount_minor <= 0
     or p_reason_code_id is null or p_command_id is null or btrim(p_command_id) = ''
     or p_business_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_refund_command');
  end if;

  select a.business_id into v_business_id
  from private.admin_order_authority_v1(
    p_employee_id, p_shop_id, 'orders.refund'
  ) a;
  if v_business_id is distinct from p_business_id then
    raise exception 'TUX_ADMIN_ORDER_BUSINESS_FORBIDDEN';
  end if;

  select * into v_reason
  from private.admin_order_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id, 'REFUND_RETURN'
  );

  v_fingerprint := private.admin_order_command_fingerprint_v1(
    'REFUND',
    p_order_id,
    jsonb_build_object(
      'paymentId', p_payment_id,
      'amountMinor', p_amount_minor,
      'reasonCodeId', p_reason_code_id,
      'note', nullif(btrim(p_note), '')
    )
  );

  select * into v_existing
  from public.admin_order_command_receipts r
  where r.shop_id = p_shop_id and r.command_id = p_command_id
  for update;
  if found then
    if v_existing.business_id = v_business_id
       and v_existing.command_type = 'REFUND'
       and v_existing.order_id = p_order_id
       and v_existing.request_fingerprint = v_fingerprint then
      return v_existing.result_json || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'command_id_conflict');
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'order_not_found');
  end if;
  if v_order.status not in ('DONE', 'RETURNED') then
    return jsonb_build_object('ok', false, 'code', 'order_not_refundable');
  end if;

  select * into v_payment
  from public.payments p
  where p.id = p_payment_id
    and p.order_id = p_order_id
    and p.shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'payment_not_found');
  end if;

  select coalesce(sum(r.amount_minor), 0)
    into v_refunded
  from public.admin_order_refunds r
  where r.payment_id = p_payment_id and r.state = 'POSTED';

  if v_refunded + p_amount_minor > v_payment.allocated_minor then
    return jsonb_build_object('ok', false, 'code', 'refund_exceeds_payment');
  end if;

  v_refund_id := gen_random_uuid();
  insert into public.admin_order_refunds(
    id, business_id, shop_id, order_id, payment_id, amount_minor,
    reason_code_id, reason_code_key, reason_label_snapshot,
    reason_family_snapshot, reason_config_version, note, state,
    command_id, created_by_employee_id
  ) values (
    v_refund_id, v_business_id, p_shop_id, p_order_id, p_payment_id, p_amount_minor,
    p_reason_code_id, v_reason.reason_code_key, v_reason.reason_label,
    v_reason.reason_family, v_reason.reason_version, nullif(btrim(p_note), ''), 'POSTED',
    p_command_id, p_employee_id
  );

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'ORDER_REFUND_POSTED', 'ORDER', p_order_id::text,
    null,
    jsonb_build_object(
      'refundId', v_refund_id,
      'paymentId', p_payment_id,
      'amountMinor', p_amount_minor,
      'reasonCodeId', p_reason_code_id,
      'reasonCodeKey', v_reason.reason_code_key,
      'reasonLabel', v_reason.reason_label,
      'reasonFamily', v_reason.reason_family,
      'reasonConfigVersion', v_reason.reason_version
    ),
    nullif(btrim(p_note), ''), null, null,
    jsonb_build_object('commandId', p_command_id)
  );

  v_result := jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'refundId', v_refund_id,
    'state', 'POSTED',
    'replayed', false
  );

  insert into public.admin_order_command_receipts(
    business_id, shop_id, command_id, command_type, order_id,
    request_fingerprint, result_json
  ) values (
    v_business_id, p_shop_id, p_command_id, 'REFUND', p_order_id,
    v_fingerprint, v_result
  );

  return v_result;
end;
$refund_admin_order$;

revoke all on function public.request_admin_order_refund_v1(
  uuid, uuid, uuid, uuid, bigint, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.request_admin_order_refund_v1(
  uuid, uuid, uuid, uuid, bigint, uuid, text, text, uuid
) to service_role;

create or replace function public.return_admin_order_items_v1(
  p_employee_id uuid,
  p_shop_id uuid,
  p_order_id uuid,
  p_items jsonb,
  p_reason_code_id uuid,
  p_note text,
  p_command_id text,
  p_business_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $return_admin_order$
declare
  v_business_id uuid;
  v_order public.orders%rowtype;
  v_reason record;
  v_existing public.admin_order_command_receipts%rowtype;
  v_fingerprint text;
  v_return_id uuid;
  v_item jsonb;
  v_order_item public.order_items%rowtype;
  v_quantity integer;
  v_prior_quantity bigint;
  v_amount bigint;
  v_result jsonb;
begin
  if p_employee_id is null or p_shop_id is null or p_order_id is null
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0
     or p_reason_code_id is null or p_command_id is null or btrim(p_command_id) = ''
     or p_business_id is null then
    return jsonb_build_object('ok', false, 'code', 'invalid_return_command');
  end if;

  select a.business_id into v_business_id
  from private.admin_order_authority_v1(
    p_employee_id, p_shop_id, 'orders.refund'
  ) a;
  if v_business_id is distinct from p_business_id then
    raise exception 'TUX_ADMIN_ORDER_BUSINESS_FORBIDDEN';
  end if;

  select * into v_reason
  from private.admin_order_reason_snapshot_v1(
    v_business_id, p_shop_id, p_reason_code_id, 'REFUND_RETURN'
  );

  v_fingerprint := private.admin_order_command_fingerprint_v1(
    'RETURN',
    p_order_id,
    jsonb_build_object(
      'items', p_items,
      'reasonCodeId', p_reason_code_id,
      'note', nullif(btrim(p_note), '')
    )
  );

  select * into v_existing
  from public.admin_order_command_receipts r
  where r.shop_id = p_shop_id and r.command_id = p_command_id
  for update;
  if found then
    if v_existing.business_id = v_business_id
       and v_existing.command_type = 'RETURN'
       and v_existing.order_id = p_order_id
       and v_existing.request_fingerprint = v_fingerprint then
      return v_existing.result_json || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object('ok', false, 'code', 'command_id_conflict');
  end if;

  select * into v_order
  from public.orders o
  where o.id = p_order_id and o.shop_id = p_shop_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'order_not_found');
  end if;
  if v_order.status not in ('DONE', 'RETURNED') then
    return jsonb_build_object('ok', false, 'code', 'order_not_returnable');
  end if;

  -- Lock all requested order-item rows in a stable order before validating quantities.
  for v_item in
    select value from jsonb_array_elements(p_items)
    order by value ->> 'orderItemId'
  loop
    begin
      v_quantity := (v_item ->> 'quantity')::integer;
      if v_quantity <= 0 then raise exception 'invalid'; end if;
    exception when others then
      return jsonb_build_object('ok', false, 'code', 'invalid_return_item');
    end;

    select * into v_order_item
    from public.order_items i
    where i.id = (v_item ->> 'orderItemId')::uuid
      and i.order_id = p_order_id
      and i.shop_id = p_shop_id
    for update;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'return_item_not_found');
    end if;

    select coalesce(sum(ri.quantity), 0)
      into v_prior_quantity
    from public.admin_order_return_items ri
    join public.admin_order_returns r on r.id = ri.return_id
    where ri.order_item_id = v_order_item.id and r.state = 'POSTED';

    if v_prior_quantity + v_quantity > v_order_item.quantity then
      return jsonb_build_object('ok', false, 'code', 'return_quantity_exceeded');
    end if;
  end loop;

  v_return_id := gen_random_uuid();
  insert into public.admin_order_returns(
    id, business_id, shop_id, order_id,
    reason_code_id, reason_code_key, reason_label_snapshot,
    reason_family_snapshot, reason_config_version, note, state,
    command_id, created_by_employee_id
  ) values (
    v_return_id, v_business_id, p_shop_id, p_order_id,
    p_reason_code_id, v_reason.reason_code_key, v_reason.reason_label,
    v_reason.reason_family, v_reason.reason_version, nullif(btrim(p_note), ''), 'POSTED',
    p_command_id, p_employee_id
  );

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_quantity := (v_item ->> 'quantity')::integer;
    select * into v_order_item
    from public.order_items i
    where i.id = (v_item ->> 'orderItemId')::uuid
      and i.order_id = p_order_id
      and i.shop_id = p_shop_id;

    v_amount := v_order_item.unit_price_minor * v_quantity;
    insert into public.admin_order_return_items(
      return_id, order_item_id, quantity, amount_minor
    ) values (
      v_return_id, v_order_item.id, v_quantity, v_amount
    );
  end loop;

  perform public.append_admin_audit_event_v1(
    v_business_id, p_shop_id, p_employee_id,
    'ORDER_ITEMS_RETURNED', 'ORDER', p_order_id::text,
    null,
    jsonb_build_object(
      'returnId', v_return_id,
      'items', p_items,
      'reasonCodeId', p_reason_code_id,
      'reasonCodeKey', v_reason.reason_code_key,
      'reasonLabel', v_reason.reason_label,
      'reasonFamily', v_reason.reason_family,
      'reasonConfigVersion', v_reason.reason_version
    ),
    nullif(btrim(p_note), ''), null, null,
    jsonb_build_object('commandId', p_command_id)
  );

  v_result := jsonb_build_object(
    'ok', true,
    'orderId', p_order_id,
    'returnId', v_return_id,
    'state', 'POSTED',
    'replayed', false
  );

  insert into public.admin_order_command_receipts(
    business_id, shop_id, command_id, command_type, order_id,
    request_fingerprint, result_json
  ) values (
    v_business_id, p_shop_id, p_command_id, 'RETURN', p_order_id,
    v_fingerprint, v_result
  );

  return v_result;
end;
$return_admin_order$;

revoke all on function public.return_admin_order_items_v1(
  uuid, uuid, uuid, jsonb, uuid, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.return_admin_order_items_v1(
  uuid, uuid, uuid, jsonb, uuid, text, text, uuid
) to service_role;

-- Device-authenticated, shop-scoped feed read authority for proactive Operations convergence.
create or replace function public.read_order_lifecycle_feed_v1(
  p_auth_user_id uuid,
  p_device_id uuid,
  p_shop_id uuid,
  p_after_sequence bigint default 0,
  p_limit integer default 200
)
returns table(
  sequence bigint,
  order_id uuid,
  status_event_id uuid,
  operational_revision bigint,
  status text,
  from_status text,
  to_status text,
  event_type text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $read_order_lifecycle_feed$
begin
  if p_after_sequence is null or p_after_sequence < 0
     or p_limit is null or p_limit < 1 or p_limit > 500 then
    raise exception 'TUX_ORDER_LIFECYCLE_FEED_REQUEST_INVALID';
  end if;

  if not exists (
    select 1
    from public.shop_memberships membership
    join public.devices device
      on device.shop_id = membership.shop_id
     and device.auth_user_id = membership.auth_user_id
    where membership.shop_id = p_shop_id
      and membership.auth_user_id = p_auth_user_id
      and membership.role = 'OPERATIONS_DEVICE'
      and membership.active
      and device.id = p_device_id
      and device.auth_user_id = p_auth_user_id
      and device.active
  ) then
    raise exception 'TUX_DEVICE_NOT_AUTHORIZED';
  end if;

  return query
  select
    f.sequence,
    f.order_id,
    f.status_event_id,
    f.operational_revision,
    o.status,
    e.from_status,
    e.to_status,
    e.event_type,
    e.created_at
  from public.order_lifecycle_feed f
  join public.order_status_events e on e.id = f.status_event_id
  join public.orders o on o.id = f.order_id and o.shop_id = f.shop_id
  where f.shop_id = p_shop_id
    and f.sequence > p_after_sequence
  order by f.sequence
  limit p_limit;
end;
$read_order_lifecycle_feed$;

revoke all on function public.read_order_lifecycle_feed_v1(
  uuid, uuid, uuid, bigint, integer
) from public, anon, authenticated;
grant execute on function public.read_order_lifecycle_feed_v1(
  uuid, uuid, uuid, bigint, integer
) to service_role;
