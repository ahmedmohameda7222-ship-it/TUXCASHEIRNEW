-- P1 Orders financial guard: reject paid ACTIVE cancellation before inventory release.
-- Unpaid ACTIVE orders keep their prior CAS, receipts, reason, audit, and inventory rules.
-- Money must be settled through separately authorized workflows; neither a status change
-- nor a posted accounting record proves payment-provider reversal or customer payout.
-- Do not apply during uncoordinated parallel Catalog production migrations.
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

  -- A recorded payment must not be silently stranded by Admin lifecycle cancellation.
  -- The ordinary refund RPC excludes CANCELLED orders. Require a separately
  -- authorized financial settlement; this status change never moves money.
  if exists (
    select 1
    from public.payments payment
    where payment.shop_id = p_shop_id
      and payment.order_id = p_order_id
      and payment.allocated_minor > 0
  ) then
    return jsonb_build_object(
      'ok', false,
      'code', 'paid_active_order_requires_settlement',
      'canonicalStatus', v_order.status,
      'canonicalOperationalRevision', v_order.operational_revision
    );
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
         cancellation_food_prepared = false,
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
